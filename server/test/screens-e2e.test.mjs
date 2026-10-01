import { test, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A todo-list extension on a screen, against pi itself: a made-up extension and
 * the skill's glue template, each loaded from the agent's own extensions folder
 * as pi loads anyone's, a model that calls the extension's tool, and what the
 * portal's client then holds for the page to draw.
 */
const repo = fileURLToPath(new URL("../..", import.meta.url));
const home = mkdtempSync(path.join(tmpdir(), "pithagoras-screens-"));
process.env.DATA_DIR = home;
process.env.WORKSPACE_ROOT = path.join(home, "ws");
process.env.PI_CODING_AGENT_DIR = path.join(home, "agent");
process.env.SESSION_DIR = path.join(home, "sessions");
mkdirSync(process.env.WORKSPACE_ROOT, { recursive: true });
mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });
const agent = process.env.PI_CODING_AGENT_DIR;

/** The model: asked to "add X" or "complete N" it calls the todo tool; once the tool has answered it says so. */
const model = createServer((req, res) => {
  let body = "";
  req.on("data", (d) => { body += d; });
  req.on("end", () => {
    const { messages } = JSON.parse(body);
    const last = messages.at(-1);
    const chunk = (delta, finish = null) =>
      `data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const asked = /^(add|complete) (.+)$/.exec(typeof last.content === "string" ? last.content : last.content?.map((c) => c.text).join("") ?? "");
    if (last.role !== "tool" && asked) {
      const args = asked[1] === "add" ? { action: "add", text: asked[2] } : { action: "complete", id: Number(asked[2]) };
      const call = { index: 0, id: "call_1", type: "function", function: { name: "todo", arguments: JSON.stringify(args) } };
      res.end(chunk({ role: "assistant", tool_calls: [call] }) + chunk({}, "tool_calls") + "data: [DONE]\n\n");
    } else {
      res.end(chunk({ role: "assistant", content: "Done." }) + chunk({}, "stop") + "data: [DONE]\n\n");
    }
  });
});
model.listen(0, "127.0.0.1");
await once(model, "listening");
after(() => model.close());
writeFileSync(path.join(agent, "models.json"), JSON.stringify({
  providers: {
    fake: {
      baseUrl: `http://127.0.0.1:${model.address().port}/v1`, api: "openai-completions", apiKey: "none",
      models: [{ id: "m", name: "M", reasoning: false, input: ["text"], contextWindow: 10000, maxTokens: 100 }],
    },
  },
}));

// The extension, and the glue put where the skill says: $HOME/.pi/agent/extensions/screen-<name>/index.ts.
mkdirSync(path.join(agent, "extensions", "todo"), { recursive: true });
writeFileSync(
  path.join(agent, "extensions", "todo", "index.ts"),
  `import { todoExtension } from ${JSON.stringify(path.join(repo, "tests/fixtures/todo-extension.mts"))};\nexport default (pi: any) => todoExtension(pi);\n`,
);
mkdirSync(path.join(agent, "extensions", "screen-todo"), { recursive: true });
cpSync(path.join(repo, "skills/extension-screens/templates/glue.mts"), path.join(agent, "extensions", "screen-todo", "index.ts"));

const { SdkPiClient } = await import("../dist/pi/sdk-client.js");

let chats = 0;
const open = (sessionFile) => {
  const dir = path.join(home, "chats", String(++chats));
  mkdirSync(dir, { recursive: true });
  return SdkPiClient.create({ cwd: process.env.WORKSPACE_ROOT, sessionDir: dir, sessionFile, provider: "fake", modelId: "m" });
};
const settled = (client) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { client.off("event", on); reject(new Error("the run did not settle within 20 s")); }, 20_000);
  const on = (e) => { if (e?.type === "agent_settled") { clearTimeout(timer); client.off("event", on); resolve(); } };
  client.on("event", on);
});
async function say(client, text) {
  const done = settled(client);
  await client.prompt(text);
  await done;
}
const items = (client) => client.screens()[0].blocks.find((b) => b.type === "checklist").items;

test("a todo list is on screen from what the extension keeps, as the agent uses it, and when the chat is opened again", async () => {
  const client = await open();
  const heard = [];
  client.on("event", (e) => { if (e?.type === "portal_screen") heard.push(e); });
  let file;
  try {
    assert.deepEqual(client.screens(), [], "nothing in the conversation, no screen");
    await say(client, "add Write the docs");
    await say(client, "add Ship it");
    await say(client, "complete 1");
    assert.equal(client.screens().length, 1);
    assert.equal(client.screens()[0].title, "Todos");
    assert.deepEqual(client.screens()[0].blocks[0], { type: "status", label: "Done", text: "1 of 2" });
    assert.deepEqual(items(client), [{ text: "Write the docs", state: "done" }, { text: "Ship it", state: "todo" }]);
    // What the page is told as it happens: each change, whole.
    assert.deepEqual(heard.map((e) => e.op), ["set", "set", "set"]);
    assert.deepEqual(heard.at(-1).blocks, client.screens()[0].blocks);
    file = client.sessionFile;
  } finally {
    client.dispose();
  }
  // Opened again after a restart, the extension rebuilds its list from the conversation, and so does the glue —
  // as pi starts, before anything has listened to the client.
  const reopened = await open(file);
  try {
    assert.deepEqual(items(reopened), [{ text: "Write the docs", state: "done" }, { text: "Ship it", state: "todo" }]);
  } finally {
    reopened.dispose();
  }
});

test("the portal's own command and skill for connecting an extension are there in every chat", async () => {
  const client = await open();
  try {
    const commands = await client.getCommands();
    const screen = commands.find((c) => c.name === "screen");
    assert.equal(screen?.source, "prompt");
    assert.match(screen.description, /Screens panel/);
    assert.ok(commands.some((c) => c.name === "skill:extension-screens"), "the skill is a command of pi's own too");
  } finally {
    client.dispose();
  }
});
