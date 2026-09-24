import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const home = mkdtempSync(path.join(tmpdir(), "pithagoras-steer-"));
process.env.DATA_DIR = home;
process.env.SESSION_DIR = path.join(home, "sessions");
process.env.WORKSPACE_ROOT = path.join(home, "ws");
process.env.PI_CODING_AGENT_DIR = path.join(home, "agent");
mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });

const { SdkPiClient } = await import("../dist/pi/sdk-client.js");
const { createSession, eventsSince, sentMessages, getDb } = await import("../dist/db.js");
const { sessions } = await import("../dist/session-manager.js");
test.after(() => { getDb().close(); rmSync(home, { recursive: true, force: true }); });

test("a typed message is answered once pi has taken it, not once the run it starts is over", async () => {
  let finish;
  const session = {
    getAllTools: () => [],
    getActiveToolNames: () => [],
    setActiveToolsByName() {},
    // pi's own shape: the preflight says it was accepted, and the promise
    // holds on until the whole run is done.
    prompt: (_text, options) => {
      options.preflightResult?.(true);
      return new Promise((resolve) => (finish = resolve));
    },
  };
  const client = new SdkPiClient(session, {}, () => {});
  let answered = false;
  const sent = client.prompt("go").then(() => (answered = true));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(answered, true, "the request is answered while the run goes on");
  finish();
  await sent;
});

test("a run that fails after taking the message says so in the chat", async () => {
  const session = {
    getAllTools: () => [],
    getActiveToolNames: () => [],
    setActiveToolsByName() {},
    prompt: async (_text, options) => {
      options.preflightResult?.(true);
      await new Promise((resolve) => setImmediate(resolve));
      throw new Error("model went away");
    },
  };
  const client = new SdkPiClient(session, {}, () => {});
  const notices = [];
  client.on("event", (e) => notices.push(e));
  await client.prompt("go");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(notices.some((e) => e.type === "portal_notice" && e.error && /model went away/.test(e.text)));
});

/** A pi in the middle of a run: whatever is sent now waits in its queue. */
function busyClient() {
  const client = {
    running: true,
    cleared: 0,
    sent: [],
    prompt: async (message, options) => void client.sent.push({ message, options }),
    getState: async () => ({ model: { id: "m", name: "M", provider: "p", input: ["text"] }, thinkingLevel: "off" }),
    getCommands: async () => [],
    isIdle: () => false,
    clearQueue: () => void client.cleared++,
    abort: async () => {},
  };
  return client;
}

const payloads = (id, type) => eventsSince(id).filter((e) => e.type === type).map((e) => ({ seq: e.seq, ...JSON.parse(e.payload) }));

test("a message sent mid-run waits, and is placed where pi takes it in", async () => {
  createSession({ id: "steer", title: "steer", workspace: home, executor: "host" });
  const client = busyClient();
  sessions.ensureClient = async () => client;
  await sessions.prompt("steer", "use the other file", { steer: true });
  const [prompt] = payloads("steer", "portal_prompt");
  assert.equal(prompt.queued, true);
  assert.equal(client.sent[0].options.steer, true);

  // pi starts a message of its own first — the one that began the run — and
  // then the steer, with the note a spoken turn would carry.
  sessions.takeIn("steer", "the first question");
  assert.deepEqual(payloads("steer", "portal_taken"), []);
  sessions.takeIn("steer", [{ type: "text", text: "use the other file" }]);
  assert.deepEqual(payloads("steer", "portal_taken").map((p) => p.seq), [prompt.seq]);
});

test("Stop takes what is still waiting out of pi's queue, and it never counts as sent", async () => {
  createSession({ id: "stopped", title: "stopped", workspace: home, executor: "host" });
  const client = busyClient();
  sessions.ensureClient = async () => client;
  await sessions.prompt("stopped", "actually, stop and do X");
  const [prompt] = payloads("stopped", "portal_prompt");
  sessions.live.set("stopped", { client, executor: {} });
  try {
    await sessions.abort("stopped");
  } finally {
    sessions.live.delete("stopped");
  }
  assert.equal(client.cleared, 1);
  assert.deepEqual(payloads("stopped", "portal_unsent").map((p) => p.seqs), [[prompt.seq]]);
  // Edits count the messages pi has: this one would put every later one out.
  assert.ok(!sentMessages("stopped").some((m) => m.seq === prompt.seq));
});
