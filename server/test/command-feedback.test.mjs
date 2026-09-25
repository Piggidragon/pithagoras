import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const home = mkdtempSync(path.join(tmpdir(), "pithagoras-commands-"));
process.env.DATA_DIR = home;
process.env.WORKSPACE_ROOT = path.join(home, "ws");
process.env.PI_CODING_AGENT_DIR = path.join(home, "agent");
process.env.SESSION_DIR = path.join(home, "sessions");
mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });

const { appendEvent, createSession, eventsSince, getSession } = await import("../dist/db.js");
const { SdkPiClient } = await import("../dist/pi/sdk-client.js");
const { sessions, extensionFailure } = await import("../dist/session-manager.js");

const ui = (method, extra = {}) => ({ type: "extension_ui_request", id: `u-${Math.random()}`, method, ...extra });

/** What each command does inside pi, as pi's extension runner would emit it. */
const handlers = {
  "/bg-clear": () => [],
  "/bg-update": () => [ui("notify", { message: "2.6.5 is out", notifyType: "info" })],
  "/bg-tasks": () => [ui("custom")],
  "/broken": () => [{ type: "extension_error", extensionPath: "command:broken", error: "boom" }],
  "/report": () => [{ type: "message_end", message: { role: "custom", customType: "r", content: "All green", display: true } }],
  // Context for the model only: pi's TUI does not draw it, and neither does the chat.
  "/prime": () => [{ type: "message_end", message: { role: "custom", customType: "ctx", content: "long context" } }],
  // Another extension's status ticking while it runs is not its answer.
  "/bg-quiet": () => [ui("setStatus", { statusKey: "bg", statusText: "3 running" }), ui("setWidget", { widgetKey: "w", widgetLines: ["x"] })],
  // A view a tool opens during a run is not the command's to be named by.
  "/during-run": () => [{ type: "agent_start" }, ui("custom"), { type: "agent_settled" }],
  "/hang": () => [],
  // Sets a status that names a command, as pi-background-tasks does.
  "/bg-status": () => [ui("setStatus", { statusKey: "bg", statusText: "\x1b[?25l⬆ v2.6.5 /bg-update" })],
  // A handler of an extension's that throws on every event of a run.
  "/noisy": () => [0, 1, 2].map(() => ({ type: "extension_error", extensionPath: "/x/node_modules/pkg-noisy/index.js", error: "bad" })),
  // Sent into a run: the run's queued follow-up starts while it is in hand.
  "/bg-beside": () => [{ type: "agent_start" }],
  // Two things to show in the same millisecond.
  "/twice": () => [ui("notify", { message: "one" }), ui("notify", { message: "two" })],
  // An extension's notice, in colour and with the cursor hidden.
  "/coloured": () => [ui("notify", { message: "\x1b[?25l\x1b[32mgreen\x1b[0m" })],
};

let lastPi;
class FakePi extends EventEmitter {
  running = true;
  draft = "";
  constructor() {
    super();
    lastPi = this;
  }
  setDraft(text) { this.draft = text; }
  async reload() { throw new Error("the settings file is not valid JSON"); }
  async abort() {}
  dispose() {}
  isIdle() { return true; }
  async getCommands() {
    return [...Object.keys(handlers), "/skill:x", "/refused"].map((c) => ({ name: c.slice(1), source: "extension" }));
  }
  async prompt(text) {
    // pi goes away while the command waits, and never answers it.
    if (text === "/hang") {
      setTimeout(() => this.emit("exit", { code: 1, signal: null }), 0);
      return new Promise(() => {});
    }
    // pi refuses it outright.
    if (text === "/refused") throw new Error("pi cannot take that now");
    for (const e of handlers[text]?.() ?? []) this.emit("event", e);
    return { outcome: text === "/skill:x" ? "started" : "handled" };
  }
}
SdkPiClient.create = async () => new FakePi();

const rows = (id) => eventsSince(id).map((r) => ({ type: r.type, payload: JSON.parse(r.payload) }));

async function send(id, message) {
  createSession({ id, title: id, workspace: home, executor: "host" });
  await sessions.prompt(id, message);
  return rows(id).filter((r) => ["portal_command", "portal_command_end", "portal_notice", "portal_prompt"].includes(r.type));
}

test("a command that shows nothing is still in the chat, and says it had nothing to show", async () => {
  const got = await send("clear", "/bg-clear");
  assert.deepEqual(got.map((r) => r.type), ["portal_command", "portal_command_end"]);
  assert.equal(got[0].payload.text, "/bg-clear");
  assert.deepEqual(got[1].payload, { of: eventsSince("clear").find((r) => r.type === "portal_command").seq, outcome: "handled", quiet: true });
});

test("a command that answers is done, with its answer after it", async () => {
  const got = await send("update", "/bg-update");
  assert.deepEqual(got.map((r) => r.type), ["portal_command", "portal_notice", "portal_command_end"]);
  assert.equal(got[2].payload.quiet, undefined);
});

test("a terminal-only view, a failure and a message for people are each said", async () => {
  const tasks = await send("tasks", "/bg-tasks");
  assert.deepEqual(tasks.find((r) => r.type === "portal_notice").payload, {
    text: "/bg-tasks opens a view made for pi's terminal, which the browser cannot show.", warning: true, from: "extension",
  });
  const broken = await send("broken", "/broken");
  const of = eventsSince("broken").find((r) => r.type === "portal_command").seq;
  assert.deepEqual(broken.find((r) => r.type === "portal_notice").payload, { text: "/broken failed: boom", error: true, from: "extension", of }, "kept for a channel, marked as the command's");
  // pi answers a command that threw as handled; its line says it failed all the same.
  assert.equal(broken.find((r) => r.type === "portal_command_end").payload.error, "boom");
  const report = await send("report", "/report");
  assert.equal(report.at(-1).payload.quiet, undefined, "a custom message is something shown");
});

test("only what the command shows for itself counts: not a status, a widget, or a message for the model", async () => {
  for (const [id, command] of [["quiet", "/bg-quiet"], ["prime", "/prime"]]) {
    const got = await send(id, command);
    assert.equal(got.find((r) => r.type === "portal_command_end").payload.quiet, true, command);
    assert.equal(got.some((r) => r.type === "portal_notice"), false, command);
  }
});

test("a view opened during a run is not put on the command sent beside it", async () => {
  const got = await send("during", "/during-run");
  assert.equal(got.find((r) => r.type === "portal_notice").payload.text, "An extension opened a view made for pi's terminal, which the browser cannot show.");
});

test("a command pi never answers, because pi went away, ends as failed", async () => {
  createSession({ id: "hang", title: "hang", workspace: home, executor: "host" });
  void sessions.prompt("hang", "/hang").catch(() => {});
  await new Promise((r) => setTimeout(r, 50));
  const end = rows("hang").find((r) => r.type === "portal_command_end");
  assert.equal(end?.payload.error, "pi stopped before it answered");
});

test("a skill says it started a run, and is not a chat message", async () => {
  const got = await send("skill", "/skill:x");
  assert.deepEqual(got.map((r) => r.type), ["portal_command", "portal_command_end"]);
  assert.equal(got[1].payload.outcome, "started");
});

test("a failure is named by its package, not its path", () => {
  assert.equal(extensionFailure("/root/.pi/agent/npm/node_modules/pi-background-tasks/dist/src/extension.js", "x"), "pi-background-tasks failed: x");
  assert.equal(extensionFailure("/a/node_modules/@scope/pkg/index.js", "y"), "@scope/pkg failed: y");
  assert.equal(extensionFailure("command:bg-tasks", "z"), "/bg-tasks failed: z");
  // One outside a package: by its file, or by its folder when the file is only its entry point.
  assert.equal(extensionFailure("/root/.pi/agent/extensions/my-ext.ts", "x"), "my-ext failed: x");
  assert.equal(extensionFailure("/proj/.pi/extensions/x.js", "x"), "x failed: x");
  assert.equal(extensionFailure("/proj/.pi/extensions/tidy/index.ts", "x"), "tidy failed: x");
  assert.equal(extensionFailure("/src/tidy/dist/index.js", "x"), "tidy failed: x");
  assert.equal(extensionFailure(undefined, undefined), "An extension failed: no reason given");
});

test("what extensions showed goes when pi is stopped, so a status cannot outlast it", async () => {
  await send("stopped", "/bg-status");
  assert.deepEqual(sessions.extensionState("stopped").statuses, [{ key: "bg", text: "⬆ v2.6.5 /bg-update" }], "without the terminal's codes");
  // An edit or a delete stops pi; it does not exit on its own.
  await sessions.stop("stopped");
  assert.deepEqual(sessions.extensionState("stopped").statuses, []);
  assert.equal(sessions.isLoaded("stopped"), false);
});

test("a builtin that fails says it once: on its line, its notice marked as its own", async () => {
  createSession({ id: "reload", title: "reload", workspace: home, executor: "host" });
  await sessions.prompt("reload", "/reload");
  await new Promise((r) => setTimeout(r, 20));
  const got = rows("reload");
  const of = got.find((r) => r.type === "portal_command").payload;
  const seq = eventsSince("reload").find((r) => r.type === "portal_command").seq;
  assert.equal(of.text, "/reload");
  assert.deepEqual(got.find((r) => r.type === "portal_notice").payload, { text: "the settings file is not valid JSON", error: true, of: seq });
  assert.equal(got.find((r) => r.type === "portal_command_end").payload.error, "the settings file is not valid JSON");
});

test("a command pi refuses fails on its line, and the chat is not put in error", async () => {
  createSession({ id: "refused", title: "refused", workspace: home, executor: "host" });
  await assert.rejects(sessions.prompt("refused", "/refused"), /cannot take that now/);
  const got = rows("refused");
  assert.equal(got.find((r) => r.type === "portal_command_end").payload.error, "pi cannot take that now");
  assert.equal(got.some((r) => r.type === "portal_status" && r.payload.status === "error"), false, "said once, on its line");
  assert.equal(getSession("refused").status, "idle");
});

test("an extension failing on every event says so once a run", async () => {
  const got = await send("noisy", "/noisy");
  assert.equal(got.filter((r) => r.type === "portal_notice").length, 1);
  // A new run: said again, once.
  lastPi.emit("event", { type: "agent_start" });
  for (let i = 0; i < 3; i++) lastPi.emit("event", { type: "extension_error", extensionPath: "/x/node_modules/pkg-noisy/index.js", error: "bad" });
  assert.equal(rows("noisy").filter((r) => r.type === "portal_notice").length, 2);
});

test("a run that starts while a command sent into a run is in hand is not its answer", async () => {
  createSession({ id: "beside", title: "beside", workspace: home, executor: "host" });
  await sessions.prompt("beside", "/bg-clear");
  lastPi.emit("event", { type: "agent_start" });
  await sessions.prompt("beside", "/bg-beside");
  const ends = rows("beside").filter((r) => r.type === "portal_command_end");
  assert.equal(ends.at(-1).payload.quiet, true);
});

test("live events each have a seq of their own, even in the same millisecond", async () => {
  createSession({ id: "twice", title: "twice", workspace: home, executor: "host" });
  const seen = [];
  const listen = (row) => row.seq < 0 && seen.push(row.seq);
  sessions.on("session:twice", listen);
  await sessions.prompt("twice", "/twice");
  sessions.off("session:twice", listen);
  assert.equal(seen.length, 2);
  assert.notEqual(seen[0], seen[1]);
});

test("an extension's notice is shown without the codes a terminal would act on", async () => {
  const got = await send("coloured", "/coloured");
  assert.equal(got.find((r) => r.type === "portal_notice").payload.text, "green");
});

test("what is in the chat box is there for an extension to read, and not once it is sent", async () => {
  createSession({ id: "draft", title: "draft", workspace: home, executor: "host" });
  sessions.setDraft("draft", "fix the build");
  await sessions.prompt("draft", "/bg-clear");
  assert.equal(lastPi.draft, "fix the build", "a new pi is told what is in the box");
  sessions.setDraft("draft", "/bg-clear");
  await sessions.prompt("draft", "/bg-clear");
  assert.equal(lastPi.draft, "", "sent from the box, which the page empties");
});

test("a command the last server never answered ends as failed, with what it threw", () => {
  createSession({ id: "orphan", title: "orphan", workspace: home, executor: "host" });
  const quiet = appendEvent("orphan", "portal_command", { text: "/deploy" });
  const threw = appendEvent("orphan", "portal_command", { text: "/broken now" });
  appendEvent("orphan", "extension_error", { type: "extension_error", extensionPath: "command:broken", error: "boom" });
  const done = appendEvent("orphan", "portal_command", { text: "/bg-clear" });
  appendEvent("orphan", "portal_command_end", { of: done.seq, outcome: "handled" });
  sessions.recoverOrphans();
  const ends = rows("orphan").filter((r) => r.type === "portal_command_end").map((r) => r.payload);
  assert.deepEqual(ends.slice(1), [
    { of: quiet.seq, error: "The portal restarted before it answered" },
    { of: threw.seq, error: "boom" },
  ]);
});
