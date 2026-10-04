import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { inProcessHome } from "./server-harness.mjs";

// How a chat's pi comes and goes: a Stop while it starts, an edit while it
// starts, a restart in the middle of a run, a pi nobody uses any more, a file
// that went missing, and what is kept of what pi says.

const home = inProcessHome("pithagoras-lifecycle-");
mkdirSync(path.join(home, "work"), { recursive: true });

const { appendEvent, createSession, eventsSince, getDb, getSession, pendingNotes, updateSession } = await import("../dist/db.js");
const { SdkPiClient } = await import("../dist/pi/sdk-client.js");
const { sessions, IMAGE_ROOT, SESSION_ROOT } = await import("../dist/session-manager.js");
const { channelSupervisor } = await import("../dist/channels/supervisor.js");
const { resolveChannelSession } = await import("../dist/agent.js");
const { findSessionFile } = await import("../dist/pi/session-file.js");
const { routineSupervisor } = await import("../dist/routines/supervisor.js");
const { beginCanvasWrite, createCanvas, listCanvases, markCanvasRead, saveCanvasPrefix } = await import("../dist/canvases.js");
const { proxyBaseUrl, startLlamaProxy } = await import("../dist/llama-progress.js");

test.after(() => getDb().close());

/** What stands in for pi: whatever a test needs of it, and a record of what it was asked. */
class FakePi extends EventEmitter {
  running = true;
  disposed = false;
  idle = true;
  dialogs = 0;
  prompts = [];
  aborted = 0;
  constructor(opts, file) {
    super();
    this.sessionFile = file ?? path.join(opts.sessionDir, "conversation.jsonl");
  }
  isIdle() { return this.idle; }
  dialogsOpen() { return this.dialogs; }
  async getTools() { return []; }
  async getCommands() { return []; }
  async getState() { return { model: { id: "m", name: "M", provider: "p", input: ["text"] }, thinkingLevel: "off" }; }
  async prompt(message) { this.prompts.push(message); return { outcome: "started" }; }
  clearQueue() { return []; }
  async abort() { this.aborted++; await this.onAbort?.(); }
  dispose() { this.disposed = true; this.emit("exit", { code: 0, signal: null }); }
}

/** Every pi started, and what holds the next launch back. */
const launched = [];
let gate;
let nextFile;
SdkPiClient.create = async (opts) => {
  await gate?.promise;
  const pi = new FakePi(opts, nextFile);
  launched.push(pi);
  return pi;
};
/** The next launch waits until `release()`. */
function hold() {
  let release;
  gate = { promise: new Promise((resolve) => (release = resolve)) };
  return () => {
    gate = undefined;
    release();
  };
}

let count = 0;
function chat(extra = {}) {
  const id = `life${++count}`;
  createSession({ id, title: id, workspace: path.join(home, "work"), executor: "host", ...extra });
  return id;
}
const events = (id) => eventsSince(id).map((r) => ({ type: r.type, payload: JSON.parse(r.payload) }));
const lastPi = () => launched.at(-1);
async function until(check, what = "the server to catch up") {
  for (let i = 0; i < 400; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`timed out waiting for ${what}`);
}

test("a Stop pressed while pi is still starting for a message keeps the message from being sent", async () => {
  const id = chat();
  const release = hold();
  const sent = sessions.prompt(id, "do the thing");
  await until(() => sessions.starting.has(id), "pi to be starting");
  await sessions.abort(id);
  release();

  assert.equal(await sent, false, "told it was not sent");
  assert.deepEqual(lastPi().prompts, [], "never handed to pi");
  assert.equal(getSession(id).status, "idle");
  const rows = events(id);
  const unsent = rows.find((r) => r.type === "portal_unsent");
  const said = rows.find((r) => r.type === "portal_prompt");
  assert.deepEqual(unsent.payload.seqs.length, 1, "the words go back to the person, as after any Stop");
  assert.equal(said.payload.message, "do the thing");
  assert.equal(said.payload.queued, true, "shown as waiting, and then as not sent");
  assert.deepEqual(rows.filter((r) => r.type === "portal_status").at(-1).payload, { status: "idle", aborted: true });

  // The next message is nobody's to cancel.
  assert.equal(await sessions.prompt(id, "again"), true);
  assert.deepEqual(lastPi().prompts, ["again"]);
});

test("every message waiting for pi to start is stopped by one Stop, and a Stop with nothing waiting stops nothing later", async () => {
  const id = chat();
  // Pressed with nothing on its way, and pi not even running.
  await sessions.abort(id);
  const release = hold();
  const first = sessions.prompt(id, "one");
  const second = sessions.prompt(id, "two");
  await until(() => sessions.starting.has(id), "pi to be starting");
  await sessions.abort(id);
  release();
  assert.deepEqual(await Promise.all([first, second]), [false, false]);
  assert.deepEqual(lastPi().prompts, []);
  assert.equal(await sessions.prompt(id, "three"), true);
  assert.deepEqual(lastPi().prompts, ["three"]);
});

test("a channel's message that a Stop got to is not answered, and what it carried is not used up", async () => {
  const id = chat();
  let accepted = false;
  const submit = sessions.submit;
  sessions.submit = async () => false;
  try {
    const reply = await sessions.ask(id, () => ({ message: "hello", onAccepted: () => (accepted = true) }), { timeoutMs: 300 });
    assert.equal(reply, "");
    assert.equal(accepted, false);
  } finally {
    sessions.submit = submit;
  }
});

test("a message that came through ask() and met a Stop while pi was starting is not sent either", async () => {
  const id = chat();
  const release = hold();
  let accepted = false;
  // As a channel's message is asked: pi is started for it before it is handed over.
  const asking = sessions.ask(id, () => ({ message: "delete the branches", onAccepted: () => (accepted = true) }), { timeoutMs: 2000 });
  await until(() => sessions.starting.has(id), "pi to be starting");
  assert.equal(sessions.isBusy(id), true, "so the channel's stop has something to stop");
  await sessions.abort(id);
  release();

  assert.equal(await asking, "", "nothing to answer");
  assert.equal(accepted, false, "and what the message carried is not used up");
  assert.deepEqual(lastPi().prompts, [], "never handed to pi");
  assert.equal(getSession(id).status, "idle");
  assert.ok(events(id).some((r) => r.type === "portal_unsent"), "the words go back as not sent");
});

/** A chat with two turns in pi's file and in the transcript, as an edit finds it. */
function chatWithFile() {
  const id = chat();
  const file = path.join(home, `${id}.jsonl`);
  const entry = (n, parent, role, text) => JSON.stringify({ type: "message", id: n, parentId: parent, message: { role, content: [{ type: "text", text }] } });
  writeFileSync(file, [JSON.stringify({ type: "session", id: "s" }), entry("u0", null, "user", "first"), entry("a0", "u0", "assistant", "one"), entry("u1", "a0", "user", "second"), entry("a1", "u1", "assistant", "two")].join("\n") + "\n");
  const seqs = ["first", "second"].map((message) => {
    const { seq } = appendEvent(id, "portal_prompt", { message });
    appendEvent(id, "message_end", { message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "ok" }] } });
    return seq;
  });
  updateSession(id, { pi_session_file: file, status: "idle" });
  return { id, seqs };
}

test("an edit made while pi is still starting waits for it, and stops it before the file is rewritten", async () => {
  const { id, seqs } = chatWithFile();
  const release = hold();
  // Launched by something that is not a run, as the model picker does.
  const starting = sessions.client(id);
  await until(() => sessions.starting.has(id), "pi to be starting");
  let released = false;
  setTimeout(() => {
    released = true;
    release();
  }, 60);
  await sessions.removeMessage(id, seqs[1], "turn");

  assert.equal(released, true, "the edit waited for the launch");
  assert.equal(lastPi().disposed, true, "the pi that read the old conversation is gone");
  assert.equal(sessions.isLoaded(id), false);
  await starting;
});

test("deleting a chat takes its pictures even when pi's folder cannot go", async () => {
  const id = chat();
  const pictures = path.join(IMAGE_ROOT, id);
  mkdirSync(pictures, { recursive: true });
  writeFileSync(path.join(pictures, "a.png"), "x");
  // Where pi's folders are is a file: looking inside it fails with something other than "not there".
  const root = SESSION_ROOT;
  rmSync(root, { recursive: true, force: true });
  writeFileSync(root, "");
  const log = console.error;
  console.error = () => {};
  try {
    sessions.removeFiles(id);
  } finally {
    console.error = log;
    rmSync(root, { force: true });
    mkdirSync(root, { recursive: true });
  }
  assert.equal(existsSync(pictures), false);
});

test("a deleted chat is let go of by the llama.cpp progress proxy, which would hold its address until a restart", async () => {
  const id = chat();
  startLlamaProxy(() => {});
  let base;
  await until(() => (base = proxyBaseUrl(id, "http://127.0.0.1:9")) !== undefined, "the proxy to listen");
  // Known: the request goes on to the server, which is not there, and says so.
  const known = await fetch(`${base}/v1/models`);
  assert.notEqual(await known.text(), "unknown session");
  await sessions.discard(id);
  const gone = await fetch(`${base}/v1/models`);
  assert.deepEqual([gone.status, await gone.text()], [502, "unknown session"]);
});

test("a restart aborts the run that is going first, so the answer written so far is kept", async () => {
  const { session } = resolveChannelSession({ channelSlug: "tg", key: "chat:9", executor: "host" });
  const id = session.id;
  const pi = await sessions.client(id);
  pi.idle = false;
  updateSession(id, { status: "running" });
  pi.onAbort = async () => {
    // As pi does when it is stopped: the message it was writing is closed with what there is of it, and the run settles.
    pi.emit("event", { type: "message_end", message: { role: "assistant", stopReason: "aborted", content: [{ type: "text", text: "Half of the repo" }] } });
    pi.emit("event", { type: "agent_settled" });
  };
  await sessions.shutdown();

  assert.equal(pi.aborted, 1);
  assert.equal(pi.disposed, true);
  const kept = events(id).filter((r) => r.type === "message_end").map((r) => r.payload.message.content[0].text);
  assert.deepEqual(kept, ["Half of the repo"]);
  assert.equal(getSession(id).status, "running", "left for the next start, which marks it interrupted");

  const cutOff = sessions.recoverOrphans();
  assert.deepEqual(cutOff, [id], "and tells the channel which conversation it cut off");
  assert.equal(getSession(id).status, "interrupted");
});

test("a restart does not wait for a pi that will not wind down", async () => {
  const id = chat();
  const pi = await sessions.client(id);
  pi.idle = false;
  updateSession(id, { status: "running" });
  pi.abort = () => new Promise(() => {});
  sessions.abortGraceMs = 40;
  try {
    await sessions.shutdown();
  } finally {
    sessions.abortGraceMs = 3_000;
  }
  assert.equal(pi.disposed, true);
});

test("the conversations a restart cut off are the ones on a channel, run or message lost, and each is told", async () => {
  const onChannel = (key) => resolveChannelSession({ channelSlug: "tg", key, executor: "host" }).session.id;
  const mid = onChannel("chat:20");
  const unsent = onChannel("chat:21");
  const quiet = onChannel("chat:22");
  const web = chat();
  updateSession(mid, { status: "running" });
  updateSession(web, { status: "running" });
  // Sent into a run, never read: the server went before it was taken in or dropped.
  appendEvent(unsent, "portal_prompt", { message: "are you there", queued: true });

  const cutOff = sessions.recoverOrphans();
  assert.deepEqual([...cutOff].sort(), [mid, unsent].sort());
  assert.ok(!cutOff.includes(quiet) && !cutOff.includes(web));

  const spoken = [];
  channelSupervisor.running.set("tg-fake", {
    slug: "tg",
    state: "running",
    since: "",
    signature: "",
    controller: new AbortController(),
    send: async (target, text) => void spoken.push({ target, text }),
  });
  try {
    // A chat that is not on a channel is skipped, whatever it is given.
    await channelSupervisor.tellRestart([...cutOff, web]);
  } finally {
    channelSupervisor.running.delete("tg-fake");
  }
  assert.deepEqual(spoken.map((s) => s.target).sort(), ["chat:20", "chat:21"]);
  assert.match(spoken[0].text, /portal restarted.*send your message again/);
  // Told, not noted: a note is read as what other runs wrote and taints the conversation for good.
  for (const id of [mid, unsent]) assert.deepEqual(pendingNotes(id), [], "the next message goes in untainted");
});

test("a channel that cannot be spoken to first is not written to about a restart", async () => {
  const id = resolveChannelSession({ channelSlug: "tg", key: "chat:30", executor: "host" }).session.id;
  const before = getDb().prepare("SELECT COUNT(*) AS n FROM notes").get().n;
  channelSupervisor.running.set("tg-mute", { slug: "tg", state: "running", since: "", signature: "", controller: new AbortController() });
  try {
    await channelSupervisor.tellRestart([id]);
  } finally {
    channelSupervisor.running.delete("tg-mute");
  }
  assert.equal(getDb().prepare("SELECT COUNT(*) AS n FROM notes").get().n, before);
});

test("pi's file is found where the chat's folder is now, by its name", () => {
  const moved = path.join(home, "moved");
  mkdirSync(moved, { recursive: true });
  writeFileSync(path.join(moved, "2026_abc.jsonl"), "");
  assert.equal(findSessionFile(path.join(moved, "2026_abc.jsonl"), "/elsewhere"), path.join(moved, "2026_abc.jsonl"));
  assert.equal(findSessionFile("/old/data/sessions/id/2026_abc.jsonl", moved), path.join(moved, "2026_abc.jsonl"));
  assert.equal(findSessionFile("/old/data/sessions/id/gone.jsonl", moved), undefined);
  assert.equal(findSessionFile(undefined, moved), undefined);
});

test("a recorded file that is gone is replaced by the one pi works in now, and the chat says it starts over", async () => {
  const id = chat({});
  appendEvent(id, "portal_prompt", { message: "remember this" });
  appendEvent(id, "message_end", { message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "noted" }] } });
  updateSession(id, { pi_session_file: path.join(home, "old-place", "gone.jsonl") });
  nextFile = path.join(SESSION_ROOT, id, "fresh.jsonl");
  try {
    await sessions.client(id);
  } finally {
    nextFile = undefined;
  }
  assert.equal(getSession(id).pi_session_file, path.join(SESSION_ROOT, id, "fresh.jsonl"), "so the next launch does not start over again");
  const notice = events(id).find((r) => r.type === "portal_notice");
  assert.match(notice.payload.text, /could not be found.*starts without it/);
  assert.equal(notice.payload.warning, true);
});

test("a chat whose first message never got an answer has no conversation to lose, and no notice", async () => {
  const id = chat({});
  appendEvent(id, "portal_prompt", { message: "hello" });
  updateSession(id, { pi_session_file: path.join(home, "old-place", "never-written.jsonl") });
  nextFile = path.join(SESSION_ROOT, id, "fresh.jsonl");
  try {
    await sessions.client(id);
  } finally {
    nextFile = undefined;
  }
  assert.equal(getSession(id).pi_session_file, path.join(SESSION_ROOT, id, "fresh.jsonl"));
  assert.equal(events(id).some((r) => r.type === "portal_notice"), false);
});

test("a conversation found again under another path is recorded there, without a notice", async () => {
  const id = chat({});
  appendEvent(id, "portal_prompt", { message: "hello" });
  appendEvent(id, "message_end", { message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "hi" }] } });
  const found = path.join(home, `${id}-found.jsonl`);
  writeFileSync(found, "");
  updateSession(id, { pi_session_file: path.join(home, "old-place", "x.jsonl") });
  nextFile = found;
  try {
    await sessions.client(id);
  } finally {
    nextFile = undefined;
  }
  assert.equal(getSession(id).pi_session_file, found);
  assert.equal(events(id).some((r) => r.type === "portal_notice"), false);
});

test("what pi repeats is kept once: tool results, whole runs, and the pictures of the person's own message", async () => {
  const id = chat();
  const pi = await sessions.client(id);
  const picture = { type: "image", data: "QUJD".repeat(500), mimeType: "image/png" };
  const answer = { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Seen." }] };
  const mine = { role: "user", content: [{ type: "text", text: "look at this" }, picture] };
  const result = { role: "toolResult", toolCallId: "c1", toolName: "shot", content: [picture] };
  for (const event of [
    { type: "agent_start" },
    { type: "message_start", message: mine },
    { type: "message_end", message: mine },
    { type: "tool_execution_end", toolCallId: "c1", toolName: "shot", isError: false, result: { content: [picture], details: {} } },
    { type: "message_start", message: result },
    { type: "message_end", message: result },
    { type: "turn_end", message: answer, toolResults: [result] },
    { type: "message_end", message: answer },
    { type: "agent_end", messages: [mine, answer, result], willRetry: false },
    { type: "agent_settled" },
  ]) pi.emit("event", event);

  const stored = events(id).filter((r) => !r.type.startsWith("portal_"));
  const of = (type, pick = () => true) => stored.filter((r) => r.type === type).map((r) => r.payload).filter(pick);
  assert.deepEqual(of("agent_end"), [{ type: "agent_end", willRetry: false }]);
  assert.deepEqual(of("turn_end"), [{ type: "turn_end" }]);
  assert.deepEqual(of("message_end", (p) => p.message.role === "toolResult"), [{ type: "message_end", message: { role: "toolResult" } }]);
  assert.deepEqual(of("message_start", (p) => p.message.role === "toolResult"), [{ type: "message_start", message: { role: "toolResult" } }]);
  // The person's words stay, and a picture is only said to have been there.
  const [end] = of("message_end", (p) => p.message.role === "user");
  assert.deepEqual(end.message.content, [{ type: "text", text: "look at this" }, { type: "image", mimeType: "image/png" }]);
  // What is drawn stays: the answer, and the call's own result, once.
  assert.equal(of("message_end", (p) => p.message.role === "assistant")[0].message.content[0].text, "Seen.");
  assert.equal(of("tool_execution_end")[0].result.content[0].data, picture.data);
  assert.equal(JSON.stringify(stored).split(picture.data).length - 1, 1, "the picture is stored once");
});

/** A running pi for a chat, as of `minutes` ago. */
async function idleFor(minutes) {
  const id = chat();
  const pi = await sessions.client(id);
  sessions.activity.set(id, Date.now() - minutes * 60_000);
  return { id, pi };
}

test("a pi nobody has used for twenty minutes is let go, and one used since is not", async () => {
  const old = await idleFor(21);
  const recent = await idleFor(5);
  const stopped = await sessions.reapIdle();
  assert.ok(stopped.includes(old.id));
  assert.ok(!stopped.includes(recent.id));
  assert.equal(old.pi.disposed, true);
  assert.equal(recent.pi.disposed, false);
  assert.equal(sessions.isLoaded(old.id), false);
  // The chat is not gone: the next message starts pi again.
  assert.equal(await sessions.prompt(old.id, "back again"), true);
  assert.deepEqual(lastPi().prompts, ["back again"]);
});

test("an idle pi that is in the middle of something is left alone", async () => {
  const { id, pi } = await idleFor(60);
  const stays = async (what) => assert.deepEqual(await sessions.reapIdle(), [], what);

  updateSession(id, { status: "running" });
  await stays("a run");
  updateSession(id, { status: "idle" });

  pi.idle = false;
  await stays("pi working with nothing marked");
  pi.idle = true;

  pi.dialogs = 1;
  await stays("a dialog an extension waits on");
  pi.dialogs = 0;

  sessions.commandsInHand.set(id, [{ seq: 1, name: "x", said: 0, inRun: false }]);
  await stays("a command that has not answered");
  sessions.commandsInHand.delete(id);

  pi.subagentsRunning = () => 1;
  await stays("a subagent in the background");
  pi.subagentsRunning = () => 0;

  sessions.compacting.set(id, new Promise(() => {}));
  await stays("a compaction");
  sessions.compacting.delete(id);

  sessions.editing.set(id, new Promise(() => {}));
  await stays("an edit");
  sessions.editing.delete(id);

  assert.deepEqual(await sessions.reapIdle(), [id], "and let go once it is not");
});

test("a chat whose pi cannot pick its conversation up again is not let go for being idle, and one that can is", async () => {
  const { id, pi } = await idleFor(60);
  // As a container's is: started again, it is a new conversation, and the person is still talking to the old one.
  Object.assign(sessions.live.get(id).executor, { resumes: false });
  assert.deepEqual(await sessions.reapIdle(), [], "it would meet the next message as a stranger");
  assert.equal(pi.disposed, false);

  sessions.live.get(id).executor.resumes = true;
  assert.deepEqual(await sessions.reapIdle(), [id]);
  assert.equal(pi.disposed, true);
});

test("whatever pi says, and whatever asks something of it, counts as use", async () => {
  const said = await idleFor(60);
  said.pi.emit("event", { type: "compaction_start" });
  const asked = await idleFor(60);
  await sessions.client(asked.id);
  const stopped = await sessions.reapIdle();
  assert.ok(!stopped.includes(said.id) && !stopped.includes(asked.id));
  assert.equal(said.pi.disposed || asked.pi.disposed, false);
});

test("the reaper runs on its own and stops with the server", async () => {
  const calls = [];
  const reap = sessions.reapIdle;
  sessions.reapIdle = async () => void calls.push(1) ?? [];
  try {
    sessions.startReaper(10);
    await until(() => calls.length >= 2, "the reaper to tick");
    await sessions.shutdown();
    const seen = calls.length;
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(calls.length, seen, "no tick after the shutdown");
  } finally {
    sessions.reapIdle = reap;
  }
});

/** A routine, by the API's own insert: clean session or not. */
function routine(fresh) {
  const row = { id: `r${++count}`, slug: `routine-${count}`, name: "Look around", instructions: "x" };
  getDb()
    .prepare("INSERT INTO routines (id, slug, name, schedule, instructions, fresh_session) VALUES (?, ?, ?, '0 9 * * *', ?, ?)")
    .run(row.id, row.slug, row.name, row.instructions, fresh ? 1 : 0);
  return getDb().prepare("SELECT * FROM routines WHERE id = ?").get(row.id);
}

test("a routine run in a clean session lets its pi go when it ends; one that keeps its session does not", async () => {
  const ask = sessions.ask;
  const stop = sessions.stop;
  const stopped = [];
  const asked = [];
  sessions.ask = async (id) => (asked.push(id), "done");
  sessions.stop = async (id) => void stopped.push(id);
  try {
    await routineSupervisor.run(routine(true), "manual");
    assert.deepEqual(stopped, [asked[0]]);
    stopped.length = 0;
    await routineSupervisor.run(routine(false), "manual");
    assert.deepEqual(stopped, []);
  } finally {
    sessions.ask = ask;
    sessions.stop = stop;
  }
});

test("deleting a chat lets go of its temporary canvases, and of a write that was going on", () => {
  const id = chat();
  const other = chat();
  const draft = createCanvas(id, "Unsaved");
  markCanvasRead(id, draft.id);
  beginCanvasWrite(id, draft.id, 0, "call-1");
  saveCanvasPrefix(id, draft.id, "call-1", "half a document");
  createCanvas(other, "Kept");
  assert.equal(listCanvases(id).length, 1);

  sessions.removeFiles(id);

  assert.deepEqual(listCanvases(id), []);
  assert.throws(() => saveCanvasPrefix(id, draft.id, "call-1", "half a document, and more"), /not found/);
  assert.equal(listCanvases(other).length, 1, "another chat's canvases stay");
});
