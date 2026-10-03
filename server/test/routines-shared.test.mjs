import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The HTTP API and the agent's tools make and change routines by the same rules, and these hold them to it.

const home = mkdtempSync(path.join(tmpdir(), "pithagoras-routines-shared-"));
process.env.DATA_DIR = home;
process.env.WORKSPACE_ROOT = path.join(home, "ws");
process.env.AGENT_HOME = path.join(home, "agent-home");
process.env.PI_CODING_AGENT_DIR = path.join(home, "agent");
mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });

const { default: express } = await import("express");
const { routinesRouter } = await import("../dist/api/routines.js");
const { routineTools } = await import("../dist/pi/routine-tools.js");
const { channelSupervisor } = await import("../dist/channels/supervisor.js");
const { freeSlug } = await import("../dist/slug.js");
const { createSession, getDb } = await import("../dist/db.js");

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

const tools = {};
routineTools()({ registerTool: (tool) => (tools[tool.name] = tool) });
const run = (name, params) => tools[name].execute("call", params);
const failure = async (name, params) => {
  try {
    await run(name, params);
  } catch (e) {
    return e.message;
  }
  assert.fail(`${name} did not refuse`);
};
const row = (slug) => getDb().prepare("SELECT * FROM routines WHERE slug = ?").get(slug);
/** What a routine is, apart from what makes it this one. */
const shape = (r) => ({ ...r, id: null, slug: null, name: null, created_at: null, updated_at: null });

test("a routine is created the same through the API as through the agent's tool, and refused the same", async () => {
  await withApi(async (call) => {
    const at = "2031-01-01T09:00:00Z";
    const refusals = [
      [{ schedule: "@daily", runAt: at }],
      [{}],
      [{ runAt: "next tuesday" }],
      [{ schedule: "not a cron" }],
    ];
    for (const [timing] of refusals) {
      const viaApi = (await call("POST", "/routines", { name: "Rule", instructions: "x", ...timing })).error;
      assert.ok(viaApi);
      assert.equal(await failure("routine_create", { name: "Rule", instructions: "x", ...timing }), viaApi);
    }

    for (const timing of [{ schedule: "0 9 * * 1-5" }, { runAt: at }]) {
      const made = await call("POST", "/routines", { name: "Via api", instructions: " check it ", freshSession: true, ...timing });
      await run("routine_create", { name: "Via tool", instructions: " check it ", freshSession: true, ...timing });
      assert.deepEqual(shape(row("via-tool")), shape(row(made.slug)));
      getDb().prepare("DELETE FROM routines").run();
    }
  });
});

test("a one-off that has run is armed again by a new time through the agent's tool as through the API", async () => {
  await withApi(async (call) => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const later = new Date(Date.now() + 86_400_000).toISOString();
    const ran = (slug) =>
      getDb().prepare("UPDATE routines SET last_run = ?, last_status = 'ok', last_output = 'did it', enabled = 0 WHERE slug = ?").run(new Date().toISOString(), slug);

    const viaApi = await call("POST", "/routines", { name: "Api once", runAt: past, instructions: "x" });
    await run("routine_create", { name: "Tool once", runAt: past, instructions: "x" });
    ran(viaApi.slug);
    ran("tool-once");
    await call("PATCH", `/routines/${viaApi.id}`, { schedule: "", runAt: later });
    await run("routine_update", { routine: "tool-once", runAt: later });

    for (const r of [row(viaApi.slug), row("tool-once")]) {
      assert.equal(r.enabled, 1);
      assert.equal(r.last_run, null);
      assert.equal(r.last_status, null);
      assert.equal(r.next_run, later);
    }
  });
});

test("a free slug is the name's own, else the first of -2, -3 that is not taken", () => {
  assert.equal(freeSlug("Morning Summary", [], "routine"), "morning-summary");
  assert.equal(freeSlug("Morning Summary", ["morning-summary"], "routine"), "morning-summary-2");
  assert.equal(freeSlug("Morning Summary", new Set(["morning-summary", "morning-summary-2"]), "routine"), "morning-summary-3");
  assert.equal(freeSlug("!!!", [], "routine"), "routine", "a name with nothing a slug can keep");
  assert.equal(freeSlug("!!!", ["routine"], "channel"), "channel");
});

test("a report target keeps the chat's own key, also from a channel bound to a second agent", async () => {
  createSession({ id: "t1", title: "Sam", workspace: home, executor: "host", kind: "agent", channel_slug: "tg", channel_key: "tg:chat:5" });
  createSession({ id: "t2", title: "Riley", workspace: home, executor: "host", kind: "agent", channel_slug: "tg", channel_key: "tg@a2:chat:999" });
  channelSupervisor.running.set("tg-fake", {
    slug: "tg",
    state: "running",
    since: "",
    signature: "",
    controller: new AbortController(),
    send: async () => {},
  });
  try {
    await withApi(async (call) => {
      const { targets } = await call("GET", "/routines/report-targets");
      assert.deepEqual(
        targets.map((t) => [t.channel, t.target, t.label]).sort(),
        [["tg", "chat:5", "Sam"], ["tg", "chat:999", "Riley"]],
      );
    });
  } finally {
    channelSupervisor.running.delete("tg-fake");
  }
});

test("a schedule is previewed as the three next runs", async () => {
  await withApi(async (call) => {
    const { runs } = await call("POST", "/routines/preview", { schedule: "0 9 * * *" });
    assert.equal(runs.length, 3);
    assert.ok(new Date(runs[0]) < new Date(runs[1]) && new Date(runs[1]) < new Date(runs[2]));
  });
  getDb().close?.();
});
