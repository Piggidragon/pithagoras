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
  sessions.submit = async (id, message) => {
    // The command's line, as submit writes it: what is said while it is in hand is its answer.
    const command = sessions.startCommand(id, message);
    setImmediate(() => {
      pi.emit("event", notify("\x1b[1mpi-background-tasks 2.6.2 is installed; 2.6.5 is the latest.\x1b[0m\n  pi install npm:pi-background-tasks@latest", "info"));
      pi.emit("event", notify("Disk almost full", "warning"));
      pi.emit("event", notify("   ", "info"));
      sessions.endCommand(id, command, { outcome: "handled" });
      pi.emit("event", { type: "agent_settled" });
    });
  };
  const reply = await sessions.ask("update", "/bg-update", { streamText: false });

  const rows = eventsSince("update").map((r) => ({ type: r.type, payload: JSON.parse(r.payload) }));
  const of = eventsSince("update").find((r) => r.type === "portal_command").seq;
  assert.deepEqual(rows.filter((r) => r.type === "portal_notice").map((r) => r.payload), [
    { text: "pi-background-tasks 2.6.2 is installed; 2.6.5 is the latest.\n  pi install npm:pi-background-tasks@latest", from: "extension", command: of },
    { text: "Disk almost full", warning: true, from: "extension", command: of },
  ]);
  assert.equal(rows.filter((r) => r.type === "extension_ui_request").length, 0, "the request itself is still not stored");
  assert.match(reply, /2\.6\.5 is the latest/);
});

test("what an extension says that is not for a channel's command stays in the chat, and is not sent to the channel", async () => {
  // A message from a channel starts a run; meanwhile another extension's job finishes, and a handler fails.
  createSession({ id: "news", title: "news", workspace: home, executor: "host" });
  sessions.submit = async () => {
    setImmediate(() => {
      pi.emit("event", { type: "agent_start" });
      pi.emit("event", notify("job 3 finished", "info"));
      pi.emit("event", { type: "extension_error", extensionPath: "/x/node_modules/pkg-other/index.js", error: "bad" });
      pi.emit("event", { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Hello there" } });
      pi.emit("event", { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Hello there" }] } });
      pi.emit("event", { type: "agent_settled" });
    });
  };
  const reply = await sessions.ask("news", "Say hello", { streamText: false });
  assert.equal(reply, "Hello there");
  const notices = eventsSince("news").filter((r) => r.type === "portal_notice").map((r) => JSON.parse(r.payload).text);
  assert.deepEqual(notices, ["job 3 finished", "pkg-other failed: bad"]);
});
