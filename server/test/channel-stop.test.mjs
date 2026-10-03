import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const home = mkdtempSync(path.join(tmpdir(), "pithagoras-channel-stop-"));
process.env.DATA_DIR = home;
process.env.WORKSPACE_ROOT = path.join(home, "ws");
process.env.PI_CODING_AGENT_DIR = path.join(home, "agent");
mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });

const { channelSupervisor } = await import("../dist/channels/supervisor.js");

const running = (stop) => ({ signature: "x", slug: "hook", state: "running", since: "", controller: new AbortController(), log: [], stop });

test("a channel that will not stop does not hold the sync or the shutdown behind it", async () => {
  const errors = mock.method(console, "error", () => {});
  channelSupervisor.stopGraceMs = 30;
  try {
    // A webhook with a request open for the whole of an agent turn: its stop() waits for it.
    const stuck = running(() => new Promise(() => {}));
    channelSupervisor.running.set("a", stuck);
    const started = Date.now();
    await channelSupervisor.stopChannel("a");
    assert.ok(Date.now() - started < 1000, "carried on after the grace");
    assert.equal(channelSupervisor.running.has("a"), false);
    assert.equal(stuck.controller.signal.aborted, true, "it was told to stop");
    assert.match(errors.mock.calls.at(-1).arguments[0], /\[channel hook\] did not stop within/);

    // One that stops promptly is awaited, and nothing is said.
    let stopped = false;
    channelSupervisor.running.set("b", running(async () => { await new Promise((r) => setTimeout(r, 10)); stopped = true; }));
    const before = errors.mock.callCount();
    await channelSupervisor.stopChannel("b");
    assert.equal(stopped, true);
    assert.equal(errors.mock.callCount(), before);

    // One that throws is reported as before.
    channelSupervisor.running.set("c", running(async () => { throw new Error("boom"); }));
    await channelSupervisor.stopChannel("c");
    assert.match(errors.mock.calls.at(-1).arguments[0], /stop failed: boom/);
  } finally {
    channelSupervisor.stopGraceMs = 5000;
    errors.mock.restore();
  }
});
