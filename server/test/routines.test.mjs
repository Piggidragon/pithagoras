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

test("a routine runs in Home or in the project it is given, with a session for each place", async () => {
  const project = path.join(process.env.WORKSPACE_ROOT, "site");
  mkdirSync(project, { recursive: true });
  const asked = [];
  sessions.ask = async (id) => {
    asked.push(getDb().prepare("SELECT workspace FROM sessions WHERE id = ?").get(id).workspace);
    return "ok";
  };
  await withApi(async (call) => {
    const made = await call("POST", "/routines", { name: "Build", schedule: "@daily", instructions: "x" });
    assert.equal(made.workspace, null, "Home unless told otherwise");
    await call("POST", `/routines/${made.id}/run`);

    const moved = await call("PATCH", `/routines/${made.id}`, { workspace: "site" });
    assert.equal(moved.workspace, project, "a bare name is a project under the root");
    await call("POST", `/routines/${made.id}/run`);

    const back = await call("PATCH", `/routines/${made.id}`, { workspace: null });
    assert.equal(back.workspace, null);
    await call("POST", `/routines/${made.id}/run`);

    assert.deepEqual(asked, [process.env.AGENT_HOME, project, process.env.AGENT_HOME]);
    const own = getDb().prepare("SELECT DISTINCT workspace FROM sessions WHERE routine_slug = ?").all(made.slug);
    assert.equal(own.length, 2, "back in Home, it picks up its Home session again");

    assert.match((await call("PATCH", `/routines/${made.id}`, { workspace: "/etc" })).error, /inside the workspace root/);
    assert.match((await call("POST", "/routines", { name: "Nowhere", schedule: "@daily", workspace: "missing" })).error, /does not exist/);

    // A project that has gone fails the run, rather than doing the work in Home.
    const gone = path.join(process.env.WORKSPACE_ROOT, "gone");
    mkdirSync(gone);
    const there = await call("POST", "/routines", { name: "Gone", schedule: "@daily", instructions: "x", workspace: gone });
    const { rmSync } = await import("node:fs");
    rmSync(gone, { recursive: true });
    const failed = await call("POST", `/routines/${there.id}/run`);
    assert.equal(failed.lastStatus, "error");
    assert.match(failed.lastOutput, /cannot be used/);
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
