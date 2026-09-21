import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const home = mkdtempSync(path.join(tmpdir(), "pithagoras-idle-"));
process.env.DATA_DIR = home;
process.env.WORKSPACE_ROOT = path.join(home, "ws");
process.env.PI_CODING_AGENT_DIR = path.join(home, "agent");
mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });

const { createSession, rememberTools, sessionTools, setToolDefaultsOff } = await import("../dist/db.js");
const { sessions } = await import("../dist/session-manager.js");

test("switching a default-off tool on is kept when nothing is running", async () => {
  // The page was drawn while the chat was live; by the time it answers the chat
  // has gone idle and been torn down. With nothing to have registered tools the
  // switch was in neither list, so no exception was written and the tool went
  // on following the default — under a 200.
  rememberTools([
    { name: "web_search", source: "pi-web-access" },
    { name: "web_fetch", source: "pi-web-access" },
  ]);
  setToolDefaultsOff(["web_search"]);
  createSession({ id: "idle", title: "idle", workspace: home, executor: "host" });

  // Everything the default has off except web_search, which is wanted on.
  const off = await sessions.setTools("idle", []);

  assert.deepEqual(sessionTools("idle"), { off: [], on: ["web_search"] });
  assert.deepEqual(off, []);
});
