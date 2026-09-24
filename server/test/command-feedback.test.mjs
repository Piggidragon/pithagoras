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

const { createSession, eventsSince } = await import("../dist/db.js");
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
};

class FakePi extends EventEmitter {
  running = true;
  async abort() {}
  dispose() {}
  isIdle() { return true; }
  async getCommands() {
    return [...Object.keys(handlers), "/skill:x"].map((c) => ({ name: c.slice(1), source: "extension" }));
  }
  async prompt(text) {
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
  assert.deepEqual(broken.find((r) => r.type === "portal_notice").payload, { text: "/broken failed: boom", error: true, from: "extension" });
  const report = await send("report", "/report");
  assert.equal(report.at(-1).payload.quiet, undefined, "a custom message is something shown");
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
  assert.equal(extensionFailure(undefined, undefined), "An extension failed: no reason given");
});
