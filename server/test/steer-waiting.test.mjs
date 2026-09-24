import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const home = mkdtempSync(path.join(tmpdir(), "pithagoras-steer-"));
process.env.DATA_DIR = home;
process.env.SESSION_DIR = path.join(home, "sessions");
process.env.WORKSPACE_ROOT = path.join(home, "ws");
process.env.PI_CODING_AGENT_DIR = path.join(home, "agent");
mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });

const { SdkPiClient } = await import("../dist/pi/sdk-client.js");
const { createSession, eventsSince, sentMessages, getDb, getSession, appendEvent, deleteEventsBetween, updateSession } =
  await import("../dist/db.js");
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

test("a run that fails after taking the message says so before it settles", async () => {
  let client;
  const session = {
    getAllTools: () => [],
    getActiveToolNames: () => [],
    setActiveToolsByName() {},
    // pi's order: the run settles in its finally, and only then does prompt() throw.
    prompt: async (_text, options) => {
      options.preflightResult?.(true);
      await new Promise((resolve) => setImmediate(resolve));
      try {
        throw new Error("model went away");
      } finally {
        client.forward({ type: "agent_settled" });
      }
    },
  };
  client = new SdkPiClient(session, {}, () => {});
  const seen = [];
  client.on("event", (e) => seen.push(e));
  await client.prompt("go");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(seen.map((e) => e.type), ["portal_failed", "agent_settled"]);
  assert.match(seen[0].error, /model went away/);
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

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("a picture on its own, or a short word, is not taken for another message", async () => {
  createSession({ id: "match", title: "match", workspace: home, executor: "host" });
  sessions.waiting.set("match", [
    { seq: 1, message: "", images: 1 },
    { seq: 2, message: "ok", images: 0 },
  ]);
  // Words that merely end the same way are somebody else's message.
  sessions.takeIn("match", [{ type: "text", text: "that looks ok" }]);
  assert.deepEqual(payloads("match", "portal_taken"), []);
  // A typed steer overtaking a picture sent before it is still itself.
  sessions.takeIn("match", [{ type: "text", text: "ok" }]);
  assert.deepEqual(payloads("match", "portal_taken").map((p) => p.seq), [2]);
  sessions.takeIn("match", [{ type: "text", text: "" }, { type: "image", data: "", mimeType: "image/png" }]);
  assert.deepEqual(payloads("match", "portal_taken").map((p) => p.seq), [2, 1]);
});

test("a message pi refuses mid-run leaves the transcript, and the run goes on", async () => {
  createSession({ id: "refused", title: "refused", workspace: home, executor: "host" });
  const client = busyClient();
  client.prompt = async () => {
    throw new Error("Extension command cannot be queued");
  };
  sessions.ensureClient = async () => client;
  sessions.live.set("refused", { client, executor: {} });
  try {
    await assert.rejects(sessions.prompt("refused", "/thing", { steer: true }), /cannot be queued/);
  } finally {
    sessions.live.delete("refused");
  }
  assert.deepEqual(payloads("refused", "portal_prompt"), []);
  assert.equal(sessions.waiting.get("refused"), undefined);
  assert.equal(getSession("refused").status, "running");
});

test("a second message sent while the first is still in pi's preflight is queued behind it", async () => {
  createSession({ id: "preflight", title: "preflight", workspace: home, executor: "host" });
  let idle = true;
  let accept;
  const client = {
    ...busyClient(),
    isIdle: () => idle,
    prompt: async (message) => {
      client.sent.push(message);
      if (message === "first") {
        await new Promise((resolve) => (accept = resolve));
        idle = false;
      }
    },
  };
  client.sent = [];
  sessions.ensureClient = async () => client;
  const first = sessions.prompt("preflight", "first");
  await tick();
  const second = sessions.prompt("preflight", "second", { steer: true });
  for (let i = 0; i < 5; i++) await tick();
  assert.deepEqual(client.sent, ["first"], "the second waits for the first to be accepted");
  accept();
  await Promise.all([first, second]);
  assert.deepEqual(client.sent, ["first", "second"]);
  const [p1, p2] = payloads("preflight", "portal_prompt");
  assert.equal(p1.queued, undefined);
  assert.equal(p2.queued, true);
  assert.equal(p2.steer, true);
});

test("Stop reaches a message still on its way to pi", async () => {
  createSession({ id: "transit", title: "transit", workspace: home, executor: "host" });
  // One being handed over: in pi's preflight, not yet in its queue.
  const client = busyClient();
  const queue = [];
  client.prompt = async (message) => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    queue.push(message);
  };
  client.clearQueue = () => void queue.splice(0);
  sessions.ensureClient = async () => client;
  sessions.live.set("transit", { client, executor: {} });
  try {
    const sending = sessions.prompt("transit", "on its way", { steer: true });
    await tick();
    await sessions.abort("transit");
    await sending;
  } finally {
    sessions.live.delete("transit");
  }
  assert.deepEqual(queue, [], "cleared once it had landed");
  assert.equal(payloads("transit", "portal_unsent").length, 1);
});

test("a message behind one still being accepted is never sent once Stop has dropped it", async () => {
  createSession({ id: "behind", title: "behind", workspace: home, executor: "host" });
  let accept;
  const client = {
    ...busyClient(),
    isIdle: () => true,
    prompt: async (message) => {
      client.sent.push(message);
      if (message === "first") await new Promise((resolve) => (accept = resolve));
    },
  };
  client.sent = [];
  sessions.ensureClient = async () => client;
  sessions.live.set("behind", { client, executor: {} });
  try {
    const first = sessions.prompt("behind", "first");
    await tick();
    const second = sessions.prompt("behind", "second");
    for (let i = 0; i < 5; i++) await tick();
    await sessions.abort("behind");
    accept();
    await Promise.all([first, second]);
  } finally {
    sessions.live.delete("behind");
  }
  assert.deepEqual(client.sent, ["first"]);
  const second = payloads("behind", "portal_prompt").find((p) => p.message === "second");
  assert.deepEqual(payloads("behind", "portal_unsent").map((p) => p.seqs), [[second.seq]]);
});

test("after a restart, what was waiting is settled by what pi's file holds", () => {
  createSession({ id: "restart", title: "restart", workspace: home, executor: "host" });
  const file = path.join(home, "restart.jsonl");
  const entry = (id, parentId, text) =>
    JSON.stringify({ type: "message", id, parentId, message: { role: "user", content: [{ type: "text", text }] } });
  writeFileSync(file, [JSON.stringify({ type: "session", id: "s" }), entry("a", null, "go"), entry("b", "a", "ok")].join("\n") + "\n");
  updateSession("restart", { pi_session_file: file });
  appendEvent("restart", "portal_prompt", { message: "go" });
  const read = appendEvent("restart", "portal_prompt", { message: "ok", queued: true });
  const lost = appendEvent("restart", "portal_prompt", { message: "ok", queued: true });
  sessions.recoverOrphans();
  assert.deepEqual(payloads("restart", "portal_taken").map((p) => p.seq), [read.seq]);
  assert.deepEqual(payloads("restart", "portal_unsent").map((p) => [p.seqs, p.restarted]), [[[lost.seq], true]]);
});

test("a message sent into a run is edited where the agent read it", () => {
  createSession({ id: "placed", title: "placed", workspace: home, executor: "host" });
  const ev = (type, payload = {}) => appendEvent("placed", type, payload).seq;
  const p = ev("portal_prompt", { message: "P" });
  const p1 = ev("message_end", { message: { role: "assistant" } });
  const a = ev("portal_prompt", { message: "A", queued: true });
  const b = ev("portal_prompt", { message: "B", queued: true, steer: true });
  const p2 = ev("message_end", { message: { role: "assistant" } });
  const takenB = ev("portal_taken", { seq: b });
  const b1 = ev("message_end", { message: { role: "assistant" } });
  const takenA = ev("portal_taken", { seq: a });
  const a1 = ev("message_end", { message: { role: "assistant" } });

  // In the order pi's file has them: the steer overtook the follow-up.
  assert.deepEqual(sentMessages("placed").map((m) => [m.message, m.at]), [["P", p], ["B", takenB], ["A", takenA]]);

  // P's turn is P and its reply, up to where B was read — not the messages
  // typed while it ran, and not what the agent did before reading them.
  const turn = deleteEventsBetween("placed", p, takenB);
  assert.deepEqual(turn.rows.map((r) => r.seq), [p, p1, p2]);
  assert.deepEqual(turn.kept, [a, b]);
  assert.deepEqual(turn.also, []);

  // A's tail is A from where it was read on, and its own line from earlier.
  const tail = deleteEventsBetween("placed", takenA, null);
  assert.deepEqual(tail.rows.map((r) => r.seq), [a, takenA, a1]);
  assert.deepEqual(tail.also, [a]);
  assert.deepEqual(eventsSince("placed").map((e) => e.seq), [b, takenB, b1]);
});

test("a settle that comes after the next prompt has started a run is not held behind that run", async () => {
  const session = {
    getAllTools: () => [],
    getActiveToolNames: () => [],
    setActiveToolsByName() {},
    // The next prompt: accepted with pi reading as idle, and its run goes on.
    prompt: (_text, options) => {
      options.preflightResult?.(true);
      return new Promise(() => {});
    },
  };
  const client = new SdkPiClient(session, {}, () => {});
  const seen = [];
  client.on("event", (e) => seen.push(e.type));
  await client.prompt("next");
  // The last run's settle, late, and then the new run's own events.
  client.forward({ type: "agent_settled" });
  client.forward({ type: "agent_start" });
  client.forward({ type: "message_update" });
  await tick();
  await tick();
  assert.deepEqual(seen, ["agent_settled", "agent_start", "message_update"]);
});

test("a message sent while Stop is winding the run down waits for it, and starts a run of its own", async () => {
  createSession({ id: "winding", title: "winding", workspace: home, executor: "host" });
  const client = busyClient();
  let aborted;
  client.abort = () => new Promise((resolve) => (aborted = resolve));
  sessions.ensureClient = async () => client;
  sessions.live.set("winding", { client, executor: {} });
  try {
    const stopping = sessions.abort("winding");
    await tick();
    const sending = sessions.prompt("winding", "and now this", { steer: true });
    for (let i = 0; i < 5; i++) await tick();
    assert.deepEqual(client.sent, [], "not queued into the run being stopped");
    client.isIdle = () => true;
    aborted();
    await stopping;
    await sending;
  } finally {
    sessions.live.delete("winding");
  }
  assert.deepEqual(client.sent.map((s) => s.message), ["and now this"]);
  assert.deepEqual(payloads("winding", "portal_unsent"), [], "not dropped by the Stop it waited for");
  assert.equal(sessions.waiting.get("winding")?.length, 1, "placed when pi takes it in");
  sessions.waiting.delete("winding");
});

test("a pi whose queue cannot be cleared keeps what it holds, and it is placed where pi reads it", async () => {
  createSession({ id: "noclear", title: "noclear", workspace: home, executor: "container" });
  const client = busyClient();
  delete client.clearQueue;
  sessions.ensureClient = async () => client;
  await sessions.prompt("noclear", "keep going with this");
  const [prompt] = payloads("noclear", "portal_prompt");
  sessions.live.set("noclear", { client, executor: {} });
  try {
    await sessions.abort("noclear");
  } finally {
    sessions.live.delete("noclear");
  }
  assert.deepEqual(payloads("noclear", "portal_unsent"), [], "not shown as never sent: pi still has it");
  // pi says it still holds it when the stopped run settles: not taken in yet.
  sessions.piQueue.set("noclear", ["keep going with this"]);
  sessions.settleWaiting("noclear");
  assert.deepEqual(payloads("noclear", "portal_taken"), []);
  sessions.piQueue.delete("noclear");
  sessions.takeIn("noclear", "keep going with this");
  assert.deepEqual(payloads("noclear", "portal_taken").map((p) => [p.seq, p.prompt?.message]), [[prompt.seq, "keep going with this"]]);
});

test("a message's own start is not taken for a waiting one with the same words", async () => {
  createSession({ id: "twice", title: "twice", workspace: home, executor: "host" });
  let idle = true;
  const client = { ...busyClient(), isIdle: () => idle };
  client.sent = [];
  client.prompt = async (message) => {
    client.sent.push(message);
    idle = false;
  };
  sessions.ensureClient = async () => client;
  await sessions.prompt("twice", "yes");
  await sessions.prompt("twice", "yes");
  const [, queued] = payloads("twice", "portal_prompt");
  assert.equal(queued.queued, true);
  sessions.takeIn("twice", "yes");
  assert.deepEqual(payloads("twice", "portal_taken"), [], "that was the first one, starting its run");
  sessions.takeIn("twice", "yes");
  assert.deepEqual(payloads("twice", "portal_taken").map((p) => p.seq), [queued.seq]);
});

test("an edit whose run fails before answering puts the conversation back", async () => {
  createSession({ id: "editfail", title: "editfail", workspace: home, executor: "host" });
  const file = path.join(home, "editfail.jsonl");
  const entry = (id, parentId, role, text) =>
    JSON.stringify({ type: "message", id, parentId, message: { role, content: [{ type: "text", text }] } });
  const original =
    [JSON.stringify({ type: "session", id: "s" }), entry("a", null, "user", "first"), entry("b", "a", "assistant", "an answer")].join("\n") + "\n";
  writeFileSync(file, original);
  updateSession("editfail", { pi_session_file: file, status: "idle" });
  const asked = appendEvent("editfail", "portal_prompt", { message: "first" });
  appendEvent("editfail", "message_end", { message: { role: "assistant", content: [{ type: "text", text: "an answer" }] } });
  const client = {
    ...busyClient(),
    isIdle: () => false,
    // Accepted, and then the run fails before any answer.
    prompt: async () => {
      setImmediate(() => sessions.record("editfail", "portal_status", { status: "error", error: "The run failed: gone" }));
    },
  };
  sessions.ensureClient = async () => client;
  await assert.rejects(sessions.editMessage("editfail", asked.seq, "second"), /gone/);
  assert.equal(readFileSync(file, "utf8"), original);
  assert.deepEqual(sentMessages("editfail").map((m) => m.message), ["first"]);
  assert.ok(eventsSince("editfail").some((e) => e.type === "message_end"), "the old answer is back");
});

test("after a restart, a torn last line in pi's file does not hide what it took in", () => {
  createSession({ id: "torn", title: "torn", workspace: home, executor: "host" });
  const file = path.join(home, "torn.jsonl");
  const entry = (id, parentId, text) =>
    JSON.stringify({ type: "message", id, parentId, message: { role: "user", content: [{ type: "text", text }] } });
  writeFileSync(file, [JSON.stringify({ type: "session", id: "s" }), entry("a", null, "go"), entry("b", "a", "and this"), '{"type":"mess'].join("\n"));
  updateSession("torn", { pi_session_file: file });
  appendEvent("torn", "portal_prompt", { message: "go" });
  const read = appendEvent("torn", "portal_prompt", { message: "and this", queued: true });
  sessions.recoverOrphans();
  assert.deepEqual(payloads("torn", "portal_taken").map((p) => p.seq), [read.seq]);
  assert.deepEqual(payloads("torn", "portal_unsent"), []);
});

test("after a restart, a container's file is read from the session's folder, and one that cannot be read is not called unsent", () => {
  createSession({ id: "boxed", title: "boxed", workspace: home, executor: "container" });
  const folder = path.join(process.env.SESSION_DIR, "boxed");
  mkdirSync(folder, { recursive: true });
  const entry = (id, parentId, text) =>
    JSON.stringify({ type: "message", id, parentId, message: { role: "user", content: [{ type: "text", text }] } });
  writeFileSync(path.join(folder, "run.jsonl"), [entry("a", null, "go"), entry("b", "a", "in the box")].join("\n") + "\n");
  updateSession("boxed", { pi_session_file: "/sessions/run.jsonl" });
  appendEvent("boxed", "portal_prompt", { message: "go" });
  const read = appendEvent("boxed", "portal_prompt", { message: "in the box", queued: true });

  createSession({ id: "unread", title: "unread", workspace: home, executor: "host" });
  updateSession("unread", { pi_session_file: path.join(home, "not-there.jsonl") });
  const unknown = appendEvent("unread", "portal_prompt", { message: "who knows", queued: true });

  sessions.recoverOrphans();
  assert.deepEqual(payloads("boxed", "portal_taken").map((p) => p.seq), [read.seq]);
  assert.deepEqual(payloads("unread", "portal_unsent").map((p) => [p.seqs, p.unsure, p.prompts[unknown.seq].message]), [[[unknown.seq], true, "who knows"]]);
});
