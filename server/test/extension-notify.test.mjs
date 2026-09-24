import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const home = mkdtempSync(path.join(tmpdir(), "pithagoras-notify-"));
process.env.DATA_DIR = home;
process.env.WORKSPACE_ROOT = path.join(home, "ws");
process.env.PI_CODING_AGENT_DIR = path.join(home, "agent");
process.env.SESSION_DIR = path.join(home, "sessions");
mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });

const { createSession, eventsSince } = await import("../dist/db.js");
const { SdkPiClient } = await import("../dist/pi/sdk-client.js");
const { sessions } = await import("../dist/session-manager.js");

class FakePi extends EventEmitter {
  running = true;
  async abort() {}
  dispose() {}
}
let pi;
SdkPiClient.create = async () => (pi = new FakePi());

const notify = (message, notifyType) => ({ type: "extension_ui_request", id: `n-${Math.random()}`, method: "notify", message, notifyType });

test("what an extension says with notify stays in the chat, and is the answer a channel hears", async () => {
  // /bg-update answers only with a notify: pi prints it, the portal showed nothing.
  createSession({ id: "update", title: "update", workspace: home, executor: "host" });
  sessions.submit = async () => {
    setImmediate(() => {
      pi.emit("event", notify("\x1b[1mpi-background-tasks 2.6.2 is installed; 2.6.5 is the latest.\x1b[0m\n  pi install npm:pi-background-tasks@latest", "info"));
      pi.emit("event", notify("Disk almost full", "warning"));
      pi.emit("event", notify("   ", "info"));
      pi.emit("event", { type: "agent_settled" });
    });
  };
  const reply = await sessions.ask("update", "/bg-update", { streamText: false });

  const rows = eventsSince("update").map((r) => ({ type: r.type, payload: JSON.parse(r.payload) }));
  assert.deepEqual(rows.filter((r) => r.type === "portal_notice").map((r) => r.payload), [
    { text: "pi-background-tasks 2.6.2 is installed; 2.6.5 is the latest.\n  pi install npm:pi-background-tasks@latest", from: "extension" },
    { text: "Disk almost full", warning: true, from: "extension" },
  ]);
  assert.equal(rows.filter((r) => r.type === "extension_ui_request").length, 0, "the request itself is still not stored");
  assert.match(reply, /2\.6\.5 is the latest/);
});
