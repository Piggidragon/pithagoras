import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const home = mkdtempSync(path.join(tmpdir(), "pithagoras-routine-migration-"));
const env = {
  ...process.env,
  DATA_DIR: home,
  WORKSPACE_ROOT: path.join(home, "ws"),
  AGENT_HOME: path.join(home, "agent-home"),
  PI_CODING_AGENT_DIR: path.join(home, "agent"),
};
mkdirSync(env.PI_CODING_AGENT_DIR, { recursive: true });

test("routine sessions from before routines had a place are moved to where Home is now", async () => {
  // A database as it was before: no place on routines, and a routine session
  // made when AGENT_HOME pointed somewhere else.
  const before = `
    const { getDb, createSession } = await import(${JSON.stringify(new URL("../dist/db.js", import.meta.url).href)});
    const d = getDb();
    d.exec("ALTER TABLE routines DROP COLUMN workspace");
    d.prepare("INSERT INTO routines (id, slug, name, schedule, instructions) VALUES ('r', 'old', 'Old', '@daily', 'x')").run();
    createSession({ id: "old-run", title: "Old", workspace: "/earlier/agent-home", executor: "host", kind: "routine", routine_slug: "old" });
    createSession({ id: "a-chat", title: "Chat", workspace: "/earlier/agent-home", executor: "host" });
    d.close();
  `;
  execFileSync(process.execPath, ["--input-type=module", "-e", before], { env, stdio: "inherit" });

  Object.assign(process.env, env);
  const { findRoutineSession, getDb } = await import("../dist/db.js");
  const where = (id) => getDb().prepare("SELECT workspace FROM sessions WHERE id = ?").get(id).workspace;
  assert.equal(where("old-run"), env.AGENT_HOME);
  assert.equal(findRoutineSession("old", env.AGENT_HOME)?.id, "old-run", "its next run in Home picks up its history");
  assert.equal(where("a-chat"), "/earlier/agent-home", "a chat is not a routine's, and stays where it was");
  getDb().close();
});
