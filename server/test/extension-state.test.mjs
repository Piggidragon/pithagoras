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
  });
  // A model or tool change restarts it; a delete stops it for good.
  await sessions.stop("restarted");
  assert.deepEqual(sessions.extensionState("restarted"), { statuses: [], widgets: [] });
});
