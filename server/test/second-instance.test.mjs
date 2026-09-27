import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { ENTRY, freePort, serverEnv, startServer, testHome } from "./server-harness.mjs";

/**
 * The server's entry file started a second time: by an extension that starts
 * pi as pi's examples do, with this runtime and `process.argv[1]` — which here
 * is the server — or as a second server, by hand or by the agent in a chat.
 */
const home = testHome("pithagoras-second-");

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
writeFileSync(path.join(home, "agent", "models.json"), JSON.stringify({
  providers: {
    fake: {
      baseUrl: `http://127.0.0.1:${model.address().port}/v1`, api: "openai-completions", apiKey: "none",
      models: [{ id: "m", name: "M", reasoning: false, input: ["text"], contextWindow: 10000, maxTokens: 100 }],
    },
  },
}));

const port = await freePort();
const env = serverEnv(home, port);
/** What the running server hands everything it starts, extensions' children too. */
const fromServer = { ...env, PITHAGORAS_SERVER: "1" };

/** Runs the entry file to its end, with what it printed. */
function run(args, withEnv) {
  const child = spawn(process.execPath, [ENTRY, ...args], { env: withEnv, cwd: home, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { err += d; });
  return new Promise((resolve) => child.on("exit", (code) => resolve({ code, out, err })));
}

process.env.DATA_DIR = home;
const db = await import("../dist/db.js");

let base;
before(async () => {
  ({ base } = await startServer(env));
});

/** A chat the first server has running, as far as the database says. */
async function runningChat() {
  const chat = await (await fetch(`${base}/api/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json();
  db.updateSession(chat.id, { status: "running" });
  return chat.id;
}
/** Still running, and nothing in the chat says it was interrupted. */
function untouched(id) {
  assert.equal(db.getSession(id).status, "running");
  assert.equal(db.eventsSince(id, 0).filter((e) => e.type === "portal_status").length, 0);
}

test("pi started through the server's entry file is pi, and answers", async () => {
  // As @forecastx/deep-research does it. It used to get a second server, which
  // failed on the port, and its research came back empty.
  const { code, out, err } = await run(["--mode", "json", "-p", "--no-session", "--provider", "fake", "--model", "m", "Look it up"], fromServer);
  assert.equal(code, 0, err);
  assert.match(out, /Found it in the archive\./);
  assert.doesNotMatch(out + err, /EADDRINUSE|PORTAL_ALLOW_NO_PASSWORD/);
});

test("a second server on the same data says so, and leaves the first one's chats running", async () => {
  const id = await runningChat();
  // The same port, and another one: the agent in a chat starting the server
  // to try it, with the environment it was given, a PORT of its own and none.
  for (const second of [env, { ...fromServer, PORT: String(await freePort()) }, fromServer]) {
    const { code, out, err } = await run([], second);
    assert.equal(code, 1);
    assert.match(err, new RegExp(`already running on ${home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.doesNotMatch(out + err, /EADDRINUSE|at Server\./, "no stack trace");
    // It marked them interrupted before it found out, and said so in each.
    untouched(id);
  }
});

test("the server is the server when given an argument by anyone but itself", async () => {
  const id = await runningChat();
  const { code, err } = await run(["--version"], env);
  assert.equal(code, 1);
  assert.match(err, /already running on/);
  untouched(id);
});

test("a server whose port is taken says so, without a stack trace", async () => {
  const other = testHome("pithagoras-second-other-");
  const { code, out, err } = await run([], serverEnv(other, port));
  assert.equal(code, 1);
  assert.match(err, new RegExp(`Port ${port} is already in use`));
  assert.doesNotMatch(out + err, /EADDRINUSE|at Server\./);
});
