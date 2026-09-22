import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const home = mkdtempSync(path.join(tmpdir(), "pithagoras-routines-"));
process.env.DATA_DIR = home;
process.env.WORKSPACE_ROOT = path.join(home, "ws");
process.env.AGENT_HOME = path.join(home, "agent-home");
process.env.PI_CODING_AGENT_DIR = path.join(home, "agent");
mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });

const { default: express } = await import("express");
const { parseCron, nextRun } = await import("../dist/routines/cron.js");
const { oneOffDone, routineSupervisor } = await import("../dist/routines/supervisor.js");
const { routinesRouter } = await import("../dist/api/routines.js");
const { getDb } = await import("../dist/db.js");
const { sessions } = await import("../dist/session-manager.js");

test("cron takes 7 for Sunday, and day and month names", () => {
  // Sunday 2026-09-27, 09:00 local.
  const saturday = new Date(2026, 8, 26, 12, 0);
  for (const expression of ["0 9 * * 7", "0 9 * * 0", "0 9 * * SUN", "0 9 * sep sun"]) {
    const next = nextRun(parseCron(expression), saturday);
    assert.equal(next?.getDay(), 0, expression);
    assert.equal(next?.getHours(), 9, expression);
  }
  // A weekday range written with names.
  const monday = nextRun(parseCron("30 8 * * mon-fri"), saturday);
  assert.equal(monday?.getDay(), 1);
  // "*" still counts as any day, 7 folded in or not.
  assert.equal(parseCron("0 0 * * *").fields[4].values.size, 7);
  assert.throws(() => parseCron("0 9 * * fun"), /day of week/);
  assert.throws(() => parseCron("0 9 * * 8"), /out of range/);
});

test("a one-off is done only by a run at or after its moment", () => {
  const row = { schedule: "", run_at: "2026-10-01T09:00:00.000Z" };
  assert.equal(oneOffDone({ ...row, last_run: null }), false);
  assert.equal(oneOffDone({ ...row, last_run: "2026-09-22T10:00:00.000Z" }), false);
  assert.equal(oneOffDone({ ...row, last_run: "2026-10-01T09:00:10.000Z" }), true);
  assert.equal(oneOffDone({ schedule: "0 9 * * *", run_at: null, last_run: "2026-10-01T09:00:10.000Z" }), false);
  // A moment that cannot be read: any run is its run, or it would never stop.
  assert.equal(oneOffDone({ schedule: "", run_at: "next tuesday", last_run: "2026-09-22T10:00:00.000Z" }), true);
  assert.equal(oneOffDone({ schedule: "", run_at: "next tuesday", last_run: null }), false);
});

async function withApi(fn) {
  const app = express();
  app.use(express.json());
  app.use("/api", routinesRouter());
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body && JSON.stringify(body),
    });
    return res.json();
  };
  try {
    await fn(call);
  } finally {
    server.close();
  }
}

test("running a future one-off by hand leaves its moment in place", async () => {
  sessions.ask = async () => "tried it";
  await withApi(async (call) => {
    const at = new Date(Date.now() + 86_400_000).toISOString();
    const made = await call("POST", "/routines", { name: "Later", runAt: at, instructions: "x" });
    const after = await call("POST", `/routines/${made.id}/run`);
    assert.equal(after.lastOutput, "tried it");
    assert.equal(after.enabled, true);
    assert.equal(after.done, false);
    assert.equal(after.nextRun, at);
  });
});

test("giving a finished one-off a new time switches it back on", async () => {
  sessions.ask = async () => "did it";
  await withApi(async (call) => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const made = await call("POST", "/routines", { name: "Once", runAt: past, instructions: "x" });
    const ran = await call("POST", `/routines/${made.id}/run`);
    assert.equal(ran.lastOutput, "did it");
    assert.equal(ran.done, true);
    assert.equal(ran.enabled, false);

    const again = new Date(Date.now() + 86_400_000).toISOString();
    const rearmed = await call("PATCH", `/routines/${made.id}`, { schedule: "", runAt: again });
    assert.equal(rearmed.enabled, true);
    assert.equal(rearmed.done, false);
    assert.equal(rearmed.nextRun, again);
  });
  routineSupervisor.stop();
  getDb().close?.();
});
