import { test, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The rule for spoken replies, against pi itself: which conversations have it
 * in the system prompt the model is sent.
 */
const home = mkdtempSync(path.join(tmpdir(), "pithagoras-audio-rule-"));
process.env.DATA_DIR = home;
process.env.WORKSPACE_ROOT = path.join(home, "ws");
process.env.PI_CODING_AGENT_DIR = path.join(home, "agent");
process.env.SESSION_DIR = path.join(home, "sessions");
mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });
mkdirSync(process.env.WORKSPACE_ROOT, { recursive: true });

/** Each request's system prompt, in the order they came. */
const sent = [];
/** Held until let go, for a run that is still going when the next message comes. */
let hold;
const model = createServer((req, res) => {
  let body = "";
  req.on("data", (d) => { body += d; });
  req.on("end", async () => {
    const system = JSON.parse(body).messages.find((m) => m.role === "system" || m.role === "developer");
    sent.push(typeof system?.content === "string" ? system.content : system?.content?.map((c) => c.text).join("") ?? "");
    if (hold) await hold;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const chunk = (delta, finish = null) =>
      `data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    res.end(chunk({ role: "assistant", content: "Sure." }) + chunk({}, "stop") + "data: [DONE]\n\n");
  });
});
model.listen(0, "127.0.0.1");
await once(model, "listening");
after(() => model.close());
writeFileSync(path.join(process.env.PI_CODING_AGENT_DIR, "models.json"), JSON.stringify({
  providers: {
    fake: {
      baseUrl: `http://127.0.0.1:${model.address().port}/v1`, api: "openai-completions", apiKey: "none",
      models: [{ id: "m", name: "M", reasoning: false, input: ["text"], contextWindow: 10000, maxTokens: 100 }],
    },
  },
}));

const { SdkPiClient } = await import("../dist/pi/sdk-client.js");
const { AUDIO_SYSTEM_RULE } = await import("../dist/pi/voice-first.js");

let chats = 0;
const open = (sessionFile) => {
  const dir = path.join(home, "chats", String(++chats));
  mkdirSync(dir, { recursive: true });
  return SdkPiClient.create({ cwd: process.env.WORKSPACE_ROOT, sessionDir: dir, sessionFile, provider: "fake", modelId: "m" });
};
const settled = (client) => new Promise((resolve) => {
  const on = (e) => { if (e?.type === "agent_settled") { client.off("event", on); resolve(); } };
  client.on("event", on);
});
/** Sends one message, and gives the system prompt its run was answered with. */
async function say(client, text, voice) {
  const before = sent.length;
  const done = settled(client);
  await client.prompt(text, voice ? { voice: true } : undefined);
  await done;
  assert.equal(sent.length, before + 1);
  return sent.at(-1);
}

test("a typed conversation's system prompt says nothing of [Audio mode]", async () => {
  // The model read the rule there as the message having the marker, and gave
  // a typed question a spoken answer: issue #26.
  const client = await open();
  try {
    assert.doesNotMatch(await say(client, "How do image models work?"), /Audio mode/);
    assert.doesNotMatch(await say(client, "And video ones?"), /Audio mode/);
  } finally {
    client.dispose();
  }
});

test("a conversation keeps the rule from its first spoken message on, reopened too", async () => {
  const client = await open();
  let file;
  try {
    assert.doesNotMatch(await say(client, "Typed first"), /Audio mode/);
    const spoken = await say(client, "Now spoken", true);
    assert.ok(spoken.includes(AUDIO_SYSTEM_RULE));
    // Typed again: the same prompt, so what the model cached of it still counts.
    assert.equal(await say(client, "Typed again"), spoken);
    file = client.sessionFile;
  } finally {
    client.dispose();
  }
  // After a restart, from what the conversation holds.
  const reopened = await open(file);
  try {
    assert.ok((await say(reopened, "Typed after a restart")).includes(AUDIO_SYSTEM_RULE));
  } finally {
    reopened.dispose();
  }
});

test("a spoken message sent while a typed run is going is answered with the rule", async () => {
  // Voice switched on while the agent works: the message waits for the run,
  // and is taken in by it without a new one starting.
  const client = await open();
  let release;
  hold = new Promise((resolve) => { release = resolve; });
  try {
    const before = sent.length;
    const done = settled(client);
    await client.prompt("Typed, and slow");
    while (sent.length === before) await new Promise((r) => setTimeout(r, 10));
    await client.prompt("Spoken meanwhile", { voice: true });
    hold = undefined;
    release();
    await done;
    assert.equal(sent.length, before + 2, "one run, two answers");
    assert.doesNotMatch(sent[before], /Audio mode/);
    assert.ok(sent[before + 1].includes(AUDIO_SYSTEM_RULE));
  } finally {
    hold = undefined;
    release?.();
    client.dispose();
  }
});

test("a spoken conversation's prompt follows its tools during a run, and keeps the rule", async () => {
  const client = await open();
  let release;
  try {
    assert.match(await say(client, "Spoken", true), /- bash:/);
    hold = new Promise((resolve) => { release = resolve; });
    const before = sent.length;
    const done = settled(client);
    await client.prompt("Typed, and slow");
    while (sent.length === before) await new Promise((r) => setTimeout(r, 10));
    // Mid-run, as an MCP server connecting or an extension's tool going away
    // does it; the next turn of the same run is the one that must know.
    client.session.setActiveToolsByName(["read"]);
    await client.prompt("And one more");
    hold = undefined;
    release();
    await done;
    assert.equal(sent.length, before + 2, "one run, two answers");
    assert.doesNotMatch(sent[before + 1], /- bash:/);
    assert.ok(sent[before + 1].includes(AUDIO_SYSTEM_RULE));
  } finally {
    hold = undefined;
    release?.();
    client.dispose();
  }
});

test("with VOICE_RESPONSE_INSTRUCTIONS=false no conversation has the rule", async () => {
  process.env.VOICE_RESPONSE_INSTRUCTIONS = "false";
  const client = await open();
  try {
    assert.doesNotMatch(await say(client, "Spoken", true), /Audio mode/);
  } finally {
    client.dispose();
    delete process.env.VOICE_RESPONSE_INSTRUCTIONS;
  }
});
