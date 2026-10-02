import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const home = mkdtempSync(path.join(tmpdir(), "pithagoras-ext-state-"));
process.env.DATA_DIR = home;
process.env.WORKSPACE_ROOT = path.join(home, "ws");
process.env.PI_CODING_AGENT_DIR = path.join(home, "agent");
process.env.SESSION_DIR = path.join(home, "sessions");
mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });

const { createSession } = await import("../dist/db.js");
const { SdkPiClient } = await import("../dist/pi/sdk-client.js");
const { sessions } = await import("../dist/session-manager.js");

class FakePi extends EventEmitter {
  running = true;
  // What the extensions put on screen over the event bus, as the real client keeps it.
  shown = [];
  screens() { return this.shown; }
  async abort() {}
  dispose() {}
  isIdle() { return true; }
  async getCommands() { return [{ name: "bg", source: "extension" }]; }
  async prompt() {
    this.emit("event", { type: "extension_ui_request", id: "s", method: "setStatus", statusKey: "bg", statusText: "bg 1 running" });
    this.emit("event", { type: "extension_ui_request", id: "w", method: "setWidget", widgetKey: "jobs", widgetContent: ["npm run dev"] });
    return { outcome: "handled" };
  }
}
SdkPiClient.create = async () => new FakePi();

test("what extensions showed goes with a pi that is stopped, not only one that crashed", async () => {
  createSession({ id: "restarted", title: "restarted", workspace: home, executor: "host" });
  await sessions.prompt("restarted", "/bg");
  assert.deepEqual(sessions.extensionState("restarted"), {
    statuses: [{ key: "bg", text: "bg 1 running" }],
    widgets: [{ key: "jobs", lines: ["npm run dev"] }],
    screens: [],
  });
  // A model or tool change restarts it; a delete stops it for good.
  await sessions.stop("restarted");
  assert.deepEqual(sessions.extensionState("restarted"), { statuses: [], widgets: [], screens: [] });
});

test("what an extension shows on a screen is the live client's, and goes with it", async () => {
  createSession({ id: "screened", title: "screened", workspace: home, executor: "host" });
  await sessions.prompt("screened", "/bg");
  const pi = sessions.live.get("screened").client;
  // Said as the chat starts, before anything listened: not an event to note, but what the client holds.
  pi.shown = [{ id: "todo", title: "Todos", blocks: [{ type: "text", text: "Write the docs" }] }];
  assert.deepEqual(sessions.extensionState("screened").screens, pi.shown);
  // The page is told as it changes, live and never stored.
  const heard = [];
  sessions.on("session:screened", (row) => heard.push(row));
  pi.emit("event", { type: "portal_screen", op: "set", id: "todo", blocks: [] });
  assert.deepEqual(heard.map((r) => [r.type, r.seq < 0]), [["portal_screen", true]]);
  await sessions.stop("screened");
  assert.deepEqual(sessions.extensionState("screened").screens, []);
});

test("a chat knows when a tool call is running in it, its subagents' included", async () => {
  createSession({ id: "calls", title: "calls", workspace: home, executor: "host" });
  await sessions.prompt("calls", "/bg");
  const pi = sessions.live.get("calls").client;
  assert.equal(sessions.callsRunning("calls"), false);
  pi.emit("event", { type: "tool_execution_start", toolCallId: "t1", toolName: "bash", args: { command: "npm test" } });
  assert.equal(sessions.callsRunning("calls"), true);
  pi.emit("event", { type: "tool_execution_end", toolCallId: "t1", toolName: "bash", result: {} });
  assert.equal(sessions.callsRunning("calls"), false);
  // A subagent's call, and the subagent ending with it still open.
  pi.emit("event", { type: "portal_subagent", op: "event", id: "s1", event: { type: "tool_execution_start", toolCallId: "t1", toolName: "bash" } });
  assert.equal(sessions.callsRunning("calls"), true);
  pi.emit("event", { type: "portal_subagent", op: "end", id: "s1", status: "stopped" });
  assert.equal(sessions.callsRunning("calls"), false);
});
