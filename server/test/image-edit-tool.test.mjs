import { test, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The edit_image tool as pi runs it: a model that calls it, an endpoint that
 * answers, and what the chat sees come back. Registered through the portal's
 * own client, so the tool's parameters are checked by pi as they are for a
 * real model.
 */
const home = mkdtempSync(path.join(tmpdir(), "pithagoras-edit-image-"));
process.env.DATA_DIR = home;
process.env.WORKSPACE_ROOT = path.join(home, "ws");
process.env.PI_CODING_AGENT_DIR = path.join(home, "agent");
process.env.SESSION_DIR = path.join(home, "sessions");
mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });
mkdirSync(process.env.WORKSPACE_ROOT, { recursive: true });

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);

/** What the model does at its next request: the arguments of a call to edit_image. */
let call;
/** The tools each request offered. */
const offered = [];
const model = createServer((req, res) => {
  let body = "";
  req.on("data", (d) => { body += d; });
  req.on("end", () => {
    const request = JSON.parse(body);
    offered.push((request.tools ?? []).map((t) => t.function?.name));
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const chunk = (delta, finish = null) =>
      `data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    // A call first; once its result is in the conversation, an answer.
    const answered = request.messages.some((m) => m.role === "tool");
    res.end(answered
      ? chunk({ role: "assistant", content: "Done." }) + chunk({}, "stop") + "data: [DONE]\n\n"
      : chunk({ role: "assistant", tool_calls: [{ index: 0, id: "call-1", type: "function", function: { name: "edit_image", arguments: JSON.stringify(call) } }] }) + chunk({}, "tool_calls") + "data: [DONE]\n\n");
  });
});
model.listen(0, "127.0.0.1");
await once(model, "listening");

/** The image endpoint: what it was asked, and what it answers with. */
const asked = [];
let answer = { status: 200, body: () => ({ data: [{ b64_json: JPEG.toString("base64") }] }) };
const endpoint = createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    asked.push({ url: req.url, auth: req.headers.authorization, type: req.headers["content-type"], body: Buffer.concat(chunks) });
    res.writeHead(answer.status, { "Content-Type": "application/json" }).end(JSON.stringify(answer.body()));
  });
});
endpoint.listen(0, "127.0.0.1");
await once(endpoint, "listening");
after(() => { model.close(); endpoint.close(); });

writeFileSync(path.join(process.env.PI_CODING_AGENT_DIR, "models.json"), JSON.stringify({
  providers: {
    fake: {
      baseUrl: `http://127.0.0.1:${model.address().port}/v1`, api: "openai-completions", apiKey: "none",
      models: [{ id: "m", name: "M", reasoning: false, input: ["text"], contextWindow: 10000, maxTokens: 100 }],
    },
  },
}));

const { SdkPiClient } = await import("../dist/pi/sdk-client.js");
const { saveImageGeneration } = await import("../dist/image-generation.js");

/** One message to a conversation in `folder`, and the results of the tool calls it led to. */
async function run(folder) {
  const client = await SdkPiClient.create({
    cwd: folder, sessionDir: mkdtempSync(path.join(home, "chat-")), provider: "fake", modelId: "m", sessionId: `edit-${path.basename(folder)}`,
  });
  const results = [];
  const settled = new Promise((resolve) => client.on("event", (e) => {
    if (e?.type === "tool_execution_end") results.push(e);
    if (e?.type === "agent_settled") resolve();
  }));
  try {
    await client.prompt("Change the picture");
    await settled;
    return results;
  } finally {
    client.dispose();
  }
}

const chat = () => {
  const folder = mkdtempSync(path.join(process.env.WORKSPACE_ROOT, "chat-"));
  writeFileSync(path.join(folder, "photo.png"), PNG);
  return folder;
};

test("a model that calls edit_image gets a new picture in the chat's folder, shown as a generated one is", async () => {
  const folder = chat();
  saveImageGeneration({ baseUrl: `http://127.0.0.1:${endpoint.address().port}/v1`, apiKey: "sk-test-1", editEnabled: true, editModel: "edit-model" });
  try {
    call = { path: "photo.png", prompt: "make it red", title: "Red" };
    const [result, ...more] = await run(folder);
    assert.equal(more.length, 0);
    assert.ok(offered.at(-1).includes("edit_image") && !offered.at(-1).includes("generate_image"), "the edit tool alone is offered");
    assert.equal(result.isError, false);
    assert.deepEqual(result.result.details, { path: "generated-images/photo-edited.jpg", title: "Red", portalImage: true });
    assert.deepEqual(readFileSync(path.join(folder, "generated-images", "photo-edited.jpg")), JPEG);
    assert.deepEqual(readFileSync(path.join(folder, "photo.png")), PNG, "the original stays");
    assert.equal(asked.length, 1);
    assert.equal(asked[0].url, "/v1/images/edits");
    assert.equal(asked[0].auth, "Bearer sk-test-1");
    assert.match(asked[0].type, /^multipart\/form-data/);
    assert.ok(asked[0].body.includes(PNG), "the picture's bytes went with it");
    assert.ok(asked[0].body.includes("make it red") && asked[0].body.includes("edit-model"));
  } finally {
    saveImageGeneration({ baseUrl: "", apiKey: "", editEnabled: false, editModel: "" });
  }
});

test("an edit that fails is an error the model sees, and leaves nothing in the chat's folder", async () => {
  const folder = chat();
  saveImageGeneration({ baseUrl: `http://127.0.0.1:${endpoint.address().port}/v1`, editEnabled: true });
  answer = { status: 400, body: () => ({ error: { message: "This model cannot edit pictures" } }) };
  try {
    call = { path: "photo.png", prompt: "make it red" };
    const [result] = await run(folder);
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.result), /answered 400: This model cannot edit pictures/);
    assert.deepEqual(readdirSync(folder), ["photo.png"]);

    // A picture that is not one of the chat's folder never reaches the endpoint.
    answer = { status: 200, body: () => ({ data: [{ b64_json: JPEG.toString("base64") }] }) };
    const before = asked.length;
    call = { path: "/etc/hostname", prompt: "make it red" };
    const [outside] = await run(chat());
    assert.equal(outside.isError, true);
    assert.equal(asked.length, before, "nothing was sent");
    // Arguments that do not fit the tool's parameters are pi's to refuse.
    call = { prompt: "make it red" };
    const [bad] = await run(chat());
    assert.equal(bad.isError, true);
    assert.equal(asked.length, before);
  } finally {
    saveImageGeneration({ baseUrl: "", apiKey: "", editEnabled: false });
    answer = { status: 200, body: () => ({ data: [{ b64_json: JPEG.toString("base64") }] }) };
  }
});

test("with editing off there is no tool for the model to call", async () => {
  saveImageGeneration({ baseUrl: `http://127.0.0.1:${endpoint.address().port}/v1`, enabled: false, editEnabled: false });
  try {
    const folder = chat();
    call = { path: "photo.png", prompt: "x" };
    await run(folder).catch(() => {});
    assert.ok(!offered.at(-1).includes("edit_image"));
    assert.ok(!existsSync(path.join(folder, "generated-images")));
  } finally {
    saveImageGeneration({ baseUrl: "" });
  }
});
