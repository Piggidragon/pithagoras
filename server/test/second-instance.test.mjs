import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The server's entry file started a second time: by an extension that starts
 * pi as pi's examples do, with this runtime and `process.argv[1]` — which here
 * is the server — or by hand while the server is up.
 */
const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const home = mkdtempSync(path.join(tmpdir(), "pithagoras-second-"));
const agentDir = path.join(home, "agent");
mkdirSync(agentDir, { recursive: true });
mkdirSync(path.join(home, "agent-home"), { recursive: true });

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
writeFileSync(path.join(agentDir, "models.json"), JSON.stringify({
  providers: {
    fake: {
      baseUrl: `http://127.0.0.1:${model.address().port}/v1`, api: "openai-completions", apiKey: "none",
      models: [{ id: "m", name: "M", reasoning: false, input: ["text"], contextWindow: 10000, maxTokens: 100 }],
    },
  },
}));

const freePort = () => new Promise((resolve) => {
  const s = createServer().listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  PORT: String(port), DATA_DIR: home, BIN_DIR: path.join(home, "bin"), SESSION_DIR: path.join(home, "sessions"), CHANNELS_DIR: path.join(home, "channels"),
  AGENT_HOME: path.join(home, "agent-home"), WORKSPACE_ROOT: path.join(home, "ws"), PI_CODING_AGENT_DIR: agentDir,
  PORTAL_PASSWORD: "", PORTAL_ALLOW_NO_PASSWORD: "1", EXECUTOR: "host", LLAMA_BASE_URL: "http://127.0.0.1:1",
};

/** Runs the entry file to its end, with what it printed. */
function run(args) {
  const child = spawn(process.execPath, [entry, ...args], { env, cwd: home, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { err += d; });
  return new Promise((resolve) => child.on("exit", (code) => resolve({ code, out, err })));
}

process.env.DATA_DIR = home;
const db = await import("../dist/db.js");

let server;
before(async () => {
  server = spawn(process.execPath, [entry], { env, stdio: "ignore" });
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${base}/api/auth/status`)).ok) break;
    } catch { /* not up yet */ }
    if (i > 200) throw new Error("the server did not start");
    await new Promise((r) => setTimeout(r, 50));
  }
});
after(() => {
  server?.kill();
  model.close();
});

test("pi started through the server's entry file is pi, and answers", async () => {
  // As @forecastx/deep-research does it. It used to get a second server, which
  // failed on the port, and its research came back empty.
  const { code, out, err } = await run(["--mode", "json", "-p", "--no-session", "--provider", "fake", "--model", "m", "Look it up"]);
  assert.equal(code, 0, err);
  assert.match(out, /Found it in the archive\./);
  assert.doesNotMatch(out + err, /EADDRINUSE|PORTAL_ALLOW_NO_PASSWORD/);
});

test("a second server says the port is taken, and leaves the first one's chats running", async () => {
  const chat = await (await fetch(`${base}/api/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json();
  db.updateSession(chat.id, { status: "running" });

  const { code, out, err } = await run([]);
  assert.equal(code, 1);
  assert.match(err, new RegExp(`already running on :${port}`));
  assert.doesNotMatch(out + err, /EADDRINUSE|at Server\./, "no stack trace");
  // It marked them interrupted before it found out, and said so in each.
  assert.equal(db.getSession(chat.id).status, "running");
  assert.equal(db.eventsSince(chat.id, 0).filter((e) => e.type === "portal_status").length, 0);
});
