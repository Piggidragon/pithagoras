import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { ENTRY, freePort, runToEnd, serverEnv, startServer, testHome } from "./server-harness.mjs";

/**
 * The server started a second time: by an extension that starts pi as pi's
 * examples do, with this runtime and `process.argv[1]`, or as a second server,
 * by hand or by the agent in a chat.
 */
const home = testHome("pithagoras-second-");
const agentDir = path.join(home, "agent");

/** A model that answers every request with the same words, streamed. */
const model = createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const chunk = (delta, finish = null) =>
      `data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    res.end(chunk({ role: "assistant", content: "Found it in the archive." }) + chunk({}, "stop") + "data: [DONE]\n\n");
  });
});
model.listen(0, "127.0.0.1");
await once(model, "listening");
after(() => model.close());
writeFileSync(path.join(agentDir, "models.json"), JSON.stringify({
  providers: {
    fake: {
      baseUrl: `http://127.0.0.1:${model.address().port}/v1`, api: "openai-completions", apiKey: "none",
      models: [{ id: "m", name: "M", reasoning: false, input: ["text"], contextWindow: 10000, maxTokens: 100 }],
    },
  },
}));
writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "fake", defaultModel: "m" }));

// An extension saying what pi is to extensions in the server: what the
// deep-research extension reads to start another.
const seen = path.join(home, "argv.json");
mkdirSync(path.join(agentDir, "extensions"), { recursive: true });
writeFileSync(path.join(agentDir, "extensions", "argv.ts"), `
import { existsSync, writeFileSync } from "node:fs";
export default function () {
  if (!existsSync(${JSON.stringify(seen)})) writeFileSync(${JSON.stringify(seen)}, JSON.stringify([process.execPath, process.argv[1]]));
}
`);

const port = await freePort();
const env = serverEnv(home, port);

process.env.DATA_DIR = home;
const db = await import("../dist/db.js");

let base;
before(async () => {
  ({ base } = await startServer(env));
});

const newChat = async () =>
  (await (await fetch(`${base}/api/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json()).id;
/** A chat the first server has running, as far as the database says. */
async function runningChat() {
  const id = await newChat();
  db.updateSession(id, { status: "running" });
  return id;
}
/** Still running, and nothing in the chat says it was interrupted. */
function untouched(id) {
  assert.equal(db.getSession(id).status, "running");
  assert.equal(db.eventsSince(id, 0).filter((e) => e.type === "portal_status").length, 0);
}

test("an extension in the server that starts pi as pi's examples do gets pi, and an answer", async () => {
  // As @forecastx/deep-research does it. It used to get a second server, which
  // failed on the port, and its research came back empty.
  const chat = await newChat();
  await fetch(`${base}/api/sessions/${chat}/prompt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "Hello" }) });
  for (let i = 0; !existsSync(seen); i++) {
    assert.ok(i < 200, "the extension was never loaded");
    await new Promise((r) => setTimeout(r, 50));
  }
  const [runtime, script] = JSON.parse(readFileSync(seen, "utf8"));
  assert.equal(runtime, process.execPath);
  assert.notEqual(script, ENTRY);
  // With an environment of its own: nothing the server set is needed.
  const { code, out, err } = await runToEnd([script, "--mode", "json", "-p", "--no-session", "Look it up"], {
    PATH: process.env.PATH, HOME: home, PI_CODING_AGENT_DIR: agentDir,
  }, { cwd: home });
  assert.equal(code, 0, err);
  assert.match(out, /Found it in the archive\./);
});

test("a second server on the same data says so, and leaves the first one's chats running", async () => {
  const id = await runningChat();
  // On the same port and on another: the agent in a chat starting the server
  // to try it has the same data, and a PORT of its own. Given an argument too.
  for (const [args, second] of [[[], env], [[], { ...env, PORT: String(await freePort()) }], [["--version"], env]]) {
    const { code, out, err } = await runToEnd([ENTRY, ...args], second, { cwd: home });
    assert.equal(code, 1, out + err);
    assert.match(err, new RegExp(`already running on ${home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.doesNotMatch(out + err, /at Server\.|at listen/, "no stack trace");
    // It marked them interrupted before it found out, and said so in each.
    untouched(id);
  }
});

test("a server that cannot listen says where and why, without a stack trace", async () => {
  const { code, out, err } = await runToEnd([ENTRY], serverEnv(testHome("pithagoras-second-other-"), port));
  assert.equal(code, 1, out + err);
  assert.match(err, new RegExp(`could not listen on 127\\.0\\.0\\.1:${port}: .*address already in use`));
  assert.doesNotMatch(out + err, /at Server\.|at listen/);
});
