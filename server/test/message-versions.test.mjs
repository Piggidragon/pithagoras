import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const home = mkdtempSync(path.join(tmpdir(), "pithagoras-versions-"));
process.env.DATA_DIR = home;
process.env.SESSION_DIR = path.join(home, "sessions");
process.env.WORKSPACE_ROOT = path.join(home, "ws");
process.env.PI_CODING_AGENT_DIR = path.join(home, "agent");
mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });

const { createSession, eventsSince, sentMessages, getDb, appendEvent, updateSession } = await import("../dist/db.js");
const { sessions } = await import("../dist/session-manager.js");
test.after(() => {
  getDb().close();
  rmSync(home, { recursive: true, force: true });
});

const entry = (id, parentId, role, text) => JSON.stringify({ type: "message", id, parentId, message: { role, content: [{ type: "text", text }] } });
const reply = (text) => ({ message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text }] } });
const answers = (id) =>
  eventsSince(id)
    .filter((e) => e.type === "message_end")
    .map((e) => JSON.parse(e.payload).message.content[0]?.text);
/** How many times the pages holding a chat are told to load it again. */
function reloads(id) {
  const heard = { count: 0 };
  sessions.on(`session:${id}`, (row) => row.type === "portal_reload" && heard.count++);
  return heard;
}

/**
 * A chat of `turns` — each a message and its answer — in pi's file and the
 * transcript, with a pi that answers whatever it is sent, as `answer` says.
 */
function chat(id, turns, answer = (m) => `answer to ${m}`) {
  createSession({ id, title: id, workspace: home, executor: "host" });
  const file = path.join(home, `${id}.jsonl`);
  const lines = [JSON.stringify({ type: "session", id: "s" })];
  const seqs = [];
  let parent = null;
  turns.forEach((m, i) => {
    lines.push(entry(`u${i}`, parent, "user", m), entry(`a${i}`, `u${i}`, "assistant", answer(m)));
    parent = `a${i}`;
    seqs.push(appendEvent(id, "portal_prompt", { message: m }).seq);
    appendEvent(id, "message_end", reply(answer(m)));
  });
  writeFileSync(file, lines.join("\n") + "\n");
  updateSession(id, { pi_session_file: file, status: "idle" });
  let written = 0;
  const client = {
    running: false,
    prompt: async (message) => {
      // pi adds what it was sent and its answer to its file, under the last entry, and says so.
      const text = readFileSync(file, "utf8");
      const leaf = JSON.parse(text.trim().split("\n").at(-1)).id;
      const n = ++written;
      writeFileSync(file, text + entry(`n${n}`, leaf, "user", message) + "\n" + entry(`r${n}`, `n${n}`, "assistant", answer(message)) + "\n");
      setImmediate(() => {
        sessions.record(id, "agent_start", {});
        sessions.record(id, "message_end", reply(answer(message)));
        sessions.record(id, "agent_settled", {});
      });
    },
    getState: async () => ({ model: { id: "m", name: "M", provider: "p", input: ["text"] }, thinkingLevel: "off" }),
    getCommands: async () => [],
    isIdle: () => true,
    clearQueue: () => {},
    abort: async () => {},
  };
  sessions.ensureClient = async () => client;
  return { file, seqs };
}

/** What a page is told to drop: said live, never stored. */
function removals(id) {
  const seen = [];
  sessions.on(`session:${id}`, (row) => row.type === "portal_removed" && seen.push(JSON.parse(row.payload)));
  return seen;
}

async function until(check, what = "the server to catch up") {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`timed out waiting for ${what}`);
}

test("a message sent again keeps what it replaced as a version to switch back to", async () => {
  const { file, seqs } = chat("again", ["hello", "what is pi"]);
  const before = readFileSync(file, "utf8");
  const removed = removals("again");
  const reloaded = reloads("again");
  await sessions.editMessage("again", seqs[1], "what is tau");
  await until(() => answers("again").includes("answer to what is tau"));
  // The page dropped the old turn when the edit was made, not once answered.
  assert.equal(removed.length, 1);
  assert.equal(removed[0].from, seqs[1]);
  const now = sentMessages("again").map((m) => m.seq);
  assert.deepEqual(answers("again"), ["answer to hello", "answer to what is tau"]);
  // The edited message has two versions, the old first; the first message has one.
  assert.deepEqual(sessions.messageVersions("again"), { [now[1]]: [seqs[1], now[1]] });
  const edited = readFileSync(file, "utf8");

  // Back to the first version: its turn, and pi's file as it was then.
  await sessions.switchVersion("again", now[1], seqs[1]);
  assert.deepEqual(sentMessages("again").map((m) => m.message), ["hello", "what is pi"]);
  assert.deepEqual(answers("again"), ["answer to hello", "answer to what is pi"]);
  assert.equal(readFileSync(file, "utf8"), before);
  assert.deepEqual(sessions.messageVersions("again"), { [seqs[1]]: [seqs[1], now[1]] });
  // Its events came back under seqs every page has read past: they load the chat again.
  assert.equal(reloaded.count, 1);
  // Stored, so a page that was away hears it on catching up.
  assert.ok(eventsSince("again").some((e) => e.type === "portal_reload"));

  // And forward again to the edit.
  await sessions.switchVersion("again", seqs[1], now[1]);
  assert.deepEqual(answers("again"), ["answer to hello", "answer to what is tau"]);
  assert.equal(readFileSync(file, "utf8"), edited);
  assert.equal(reloaded.count, 2);
});

test("versions of a later message go with the version of an earlier one they followed", async () => {
  const { seqs } = chat("nested", ["one", "two"]);
  // Two sent again, then one: the second message's versions belong to the first one's old version.
  await sessions.editMessage("nested", seqs[1], "two again");
  await until(() => answers("nested").includes("answer to two again"));
  const twoAgain = sentMessages("nested")[1].seq;
  await sessions.editMessage("nested", seqs[0], "one again");
  await until(() => answers("nested").includes("answer to one again"));
  const oneAgain = sentMessages("nested")[0].seq;
  assert.deepEqual(sessions.messageVersions("nested"), { [oneAgain]: [seqs[0], oneAgain] });
  await sessions.switchVersion("nested", oneAgain, seqs[0]);
  assert.deepEqual(sentMessages("nested").map((m) => m.message), ["one", "two again"]);
  assert.deepEqual(sessions.messageVersions("nested"), { [seqs[0]]: [seqs[0], oneAgain], [twoAgain]: [seqs[1], twoAgain] });
});

test("an edit that gets no answer is undone, and leaves no version behind", async () => {
  const { file, seqs } = chat("undone", ["hi"]);
  const before = readFileSync(file, "utf8");
  const reloaded = reloads("undone");
  const client = await sessions.ensureClient();
  // The run starts, and fails before a word of answer.
  client.isIdle = () => false;
  client.prompt = async () => void setImmediate(() => sessions.record("undone", "portal_status", { status: "error", error: "The run failed: gone" }));
  await sessions.editMessage("undone", seqs[0], "hi again");
  await until(() => readFileSync(file, "utf8") === before);
  assert.deepEqual(sentMessages("undone").map((m) => m.message), ["hi"]);
  assert.deepEqual(sessions.messageVersions("undone"), {});
  // The page dropped the old turn at once, and has it back by loading again.
  await until(() => reloaded.count === 1);
});

test("taking a message out forgets the versions of the ones after it", async () => {
  const { seqs } = chat("taken", ["a", "b", "c"]);
  await sessions.editMessage("taken", seqs[2], "c again");
  await until(() => answers("taken").includes("answer to c again"));
  assert.equal(Object.keys(sessions.messageVersions("taken")).length, 1);
  // Its versions went on from a conversation with "b" in it.
  await sessions.removeMessage("taken", seqs[1], "turn");
  assert.deepEqual(sessions.messageVersions("taken"), {});
});

test("a version that is not there, or a chat that is working, is refused", async () => {
  const { seqs } = chat("refused", ["x"]);
  await assert.rejects(sessions.switchVersion("refused", seqs[0], 99999), /gone/);
  await sessions.editMessage("refused", seqs[0], "y");
  await until(() => answers("refused").includes("answer to y"));
  const y = sentMessages("refused")[0].seq;
  sessions.isBusy = (id) => id === "refused";
  try {
    await assert.rejects(sessions.switchVersion("refused", y, seqs[0]), /Stop the run/);
  } finally {
    delete sessions.isBusy;
  }
  assert.deepEqual(sentMessages("refused").map((m) => m.message), ["y"]);
});
