import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

const home = mkdtempSync(path.join(tmpdir(), "pithagoras-term-"));
process.env.DATA_DIR = home;
process.env.WORKSPACE_ROOT = path.join(home, "ws");
process.env.PI_CODING_AGENT_DIR = path.join(home, "agent");
// `script` runs its command through $SHELL, so it has to be a lone path.
process.env.SHELL = "/bin/sh";
mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });

const { default: express } = await import("express");
const { terminalRouter } = await import("../dist/api/terminal.js");
const { createSession } = await import("../dist/db.js");

const app = express();
app.use(express.json());
app.use("/api", terminalRouter());
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}/api`;
const post = (url, body) =>
  fetch(base + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) }).then((r) => r.json());

/** Reads the terminal's stream until `until` shows up in it. */
async function read(id, until) {
  const controller = new AbortController();
  const res = await fetch(`${base}/terminal/${id}/stream`, { signal: controller.signal });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  // An event can be longer than what one read returns: the line ends with the next newline.
  let pending = "";
  const deadline = Date.now() + 5000;
  while (!until.test(text) && Date.now() < deadline) {
    const timeout = new Promise((resolve) => setTimeout(() => resolve({ done: true }), deadline - Date.now()));
    const { value, done } = await Promise.race([reader.read(), timeout]);
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop();
    for (const line of lines) {
      if (line.startsWith("data: ")) text += JSON.parse(line.slice(6));
    }
  }
  controller.abort();
  return text;
}

test("a shell that cannot start says so instead of taking the portal down", async () => {
  createSession({ id: "gone", title: "gone", workspace: path.join(home, "no-such-folder"), executor: "host" });
  const { id } = await post("/terminal", { sessionId: "gone" });
  const text = await read(id, /Could not start a shell/);
  assert.match(text, /Could not start a shell/);
  await fetch(`${base}/terminal/${id}`, { method: "DELETE" });
});

test("a resize reaches the shell without being typed into it", async () => {
  const { id } = await post("/terminal", {});
  await new Promise((resolve) => setTimeout(resolve, 300));
  await post(`/terminal/${id}/resize`, { rows: 33, cols: 111 });
  await new Promise((resolve) => setTimeout(resolve, 300));
  await post(`/terminal/${id}/input`, { data: "stty size\n" });
  const text = await read(id, /33 111/);
  assert.match(text, /33 111/);
  // The old way left the command itself on the screen.
  assert.doesNotMatch(text, /stty rows/);
  await fetch(`${base}/terminal/${id}`, { method: "DELETE" });
});

test("what the person starts in their terminal is not marked as the agent's", async () => {
  // The portal marks everything it starts, for the background list to find.
  process.env.PITHAGORAS_AGENT = "1";
  const { id } = await post("/terminal", {});
  await new Promise((resolve) => setTimeout(resolve, 300));
  await post(`/terminal/${id}/input`, { data: 'echo "mark:[${PITHAGORAS_AGENT:-none}]"\n' });
  const text = await read(id, /mark:\[(none|1)\]/);
  assert.match(text, /mark:\[none\]/);
  await fetch(`${base}/terminal/${id}`, { method: "DELETE" });
});

test("a command that writes faster than the client reads is held back, not queued in the portal, and goes on when the client reads", async () => {
  const { id } = await post("/terminal", {});
  await new Promise((resolve) => setTimeout(resolve, 300));
  const counter = path.join(home, "written");
  // 256 KiB a time, counted after each: how much the shell has been let to write.
  await post(`/terminal/${id}/input`, { data: `n=0; while :; do printf '%0262144d\\n' 0; n=$((n+1)); echo $n > ${counter}; done\n` });
  const written = () => { try { return Number(readFileSync(counter, "utf8")) || 0; } catch { return 0; } };
  // A client that is connected and does not read.
  const res = await new Promise((resolve) => http.get(`${base}/terminal/${id}/stream`, { agent: false }, (r) => { r.pause(); resolve(r); }));
  try {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const held = written();
    // What the connection and the pipes hold, and nowhere near what a shell writes in that time when nothing holds it back.
    assert.ok(held > 0 && held < 256, `${held} pieces of 256 KiB were written to a client that was not reading`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.ok(written() - held < 8, "and it does not go on");
    // Reading again lets it write.
    res.on("data", () => {});
    res.resume();
    const deadline = Date.now() + 5000;
    while (written() < held + 100 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(written() >= held + 100, "it goes on once the client reads");
  } finally {
    res.destroy();
    await fetch(`${base}/terminal/${id}`, { method: "DELETE" });
  }
});

test("a client that goes away while the shell is held back for it does not leave the shell waiting", async () => {
  const { id } = await post("/terminal", {});
  await new Promise((resolve) => setTimeout(resolve, 300));
  const counter = path.join(home, "written-away");
  await post(`/terminal/${id}/input`, { data: `n=0; while :; do printf '%0262144d\\n' 0; n=$((n+1)); echo $n > ${counter}; done\n` });
  const written = () => { try { return Number(readFileSync(counter, "utf8")) || 0; } catch { return 0; } };
  const res = await new Promise((resolve) => http.get(`${base}/terminal/${id}/stream`, { agent: false }, (r) => { r.pause(); resolve(r); }));
  try {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const held = written();
    assert.ok(held > 0 && held < 256, "the shell is held back");
    res.destroy();
    // The shell is not ended for a while with nobody there, and nothing holds it back any more.
    const deadline = Date.now() + 5000;
    while (written() < held + 100 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(written() >= held + 100, "it goes on");
  } finally {
    res.destroy();
    await fetch(`${base}/terminal/${id}`, { method: "DELETE" });
  }
});

test("the scrollback a client that connects late is given is the end of what was written, cut to its size", async () => {
  const { id } = await post("/terminal", {});
  await new Promise((resolve) => setTimeout(resolve, 300));
  // 300,000 characters in pieces, then a line to look for: the first of them cannot all be there.
  await post(`/terminal/${id}/input`, { data: "i=0; while [ $i -lt 30 ]; do printf '%010000d' $i; i=$((i+1)); done; echo; echo DONE-WRITING\n" });
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    const text = await read(id, /DONE-WRITING/);
    assert.match(text, /00029\r?\nDONE-WRITING/);
    assert.equal(text.length, 200_000);
  } finally {
    await fetch(`${base}/terminal/${id}`, { method: "DELETE" });
  }
});

test("closing a terminal ends what it started, even what ignores the hangup", async () => {
  const { id } = await post("/terminal", {});
  await new Promise((resolve) => setTimeout(resolve, 300));
  await post(`/terminal/${id}/input`, { data: "nohup sleep 300 >/dev/null 2>&1 & echo job=$!\n" });
  const pid = Number(/job=(\d+)/.exec(await read(id, /job=\d+/))?.[1]);
  assert.ok(pid > 0, "the job started");
  await fetch(`${base}/terminal/${id}`, { method: "DELETE" });
  const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const deadline = Date.now() + 5000;
  while (alive() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(!alive(), "the nohup job is gone");
  server.close();
});
