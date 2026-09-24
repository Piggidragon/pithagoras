import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "pithagoras-reload-"));

const { SdkPiClient } = await import("../dist/pi/sdk-client.js");

/**
 * The parts of pi 0.82's AgentSession that decide which tools are active.
 *
 * The registry holds every definition, `grep`, `find` and `ls` among them, and
 * a session starts with only read/bash/edit/write plus the extensions' tools
 * active. Activation from anywhere — an extension registering later, a reload —
 * goes through `setActiveToolsByName`, called on `this`.
 */
function fakeSession() {
  const session = {
    registry: ["read", "bash", "edit", "write", "grep", "find", "ls", "web_search", "browser_browser_click"],
    active: ["read", "bash", "edit", "write", "web_search", "browser_browser_click"],
    extension: ["web_search", "browser_browser_click"],
    getAllTools: () => session.registry.map((name) => ({ name })),
    getActiveToolNames: () => [...session.active],
    setActiveToolsByName(names) {
      session.active = [...new Set(names)].filter((name) => session.registry.includes(name));
    },
    /** `ctx.refreshTools()`: whatever was not there before comes up active. */
    register(name) {
      session.registry.push(name);
      session.extension.push(name);
      this.setActiveToolsByName([...session.active, name]);
    },
    async reload() {
      this.setActiveToolsByName([...session.active, ...session.extension]);
    },
  };
  return session;
}

const client = (session) => new SdkPiClient(session, {}, () => {});

test("switching one tool off does not switch on what pi left inactive", async () => {
  const session = fakeSession();
  const c = client(session);
  await c.setToolsOff(["web_search"]);
  assert.deepEqual(session.active, ["read", "bash", "edit", "write", "browser_browser_click"]);
  for (const name of ["grep", "find", "ls"]) assert.ok(!session.active.includes(name), name);
});

test("switching it back on restores what pi wanted, and no more", async () => {
  const session = fakeSession();
  const c = client(session);
  await c.setToolsOff(["web_search"]);
  await c.setToolsOff([]);
  assert.deepEqual(
    [...session.active].sort(),
    ["bash", "browser_browser_click", "edit", "read", "web_search", "write"]
  );
});

test("a tool that registers after the switch was made comes up off", async () => {
  const session = fakeSession();
  const c = client(session);
  await c.setToolsOff(["jira_create_issue"]);
  session.register("jira_create_issue");
  assert.ok(!session.active.includes("jira_create_issue"));
  // And one nobody switched off does come up.
  session.register("jira_search");
  assert.ok(session.active.includes("jira_search"));
});

test("a reload does not bring back what was switched off", async () => {
  const session = fakeSession();
  const c = client(session);
  await c.setToolsOff(["browser_browser_click"]);
  await c.reload();
  assert.ok(!session.active.includes("browser_browser_click"));
  assert.ok(session.active.includes("web_search"));
  assert.ok(!session.active.includes("grep"));
});

test("a reload with nothing switched off leaves pi's active set alone", async () => {
  const session = fakeSession();
  const c = client(session);
  await c.reload();
  assert.deepEqual([...session.active].sort(), [...fakeSession().active].sort());
});

test("only what the model could be offered is listed", async () => {
  const c = client(fakeSession());
  const names = (await c.getTools()).map((t) => t.name);
  assert.ok(names.includes("web_search"));
  // Registered, and inactive: a tick beside them would be a state the session
  // is not in.
  for (const name of ["grep", "find", "ls"]) assert.ok(!names.includes(name), name);
});

test("a tool switched off stays listed, and can come back, after pi refreshes its tools", async () => {
  const session = fakeSession();
  const c = client(session);
  await c.setToolsOff(["web_search"]);
  // pi builds the next set from the active one, which no longer has it.
  session.register("jira_search");
  const listed = await c.getTools();
  const web = listed.find((t) => t.name === "web_search");
  assert.ok(web, "web_search is still offered");
  assert.equal(web.enabled, false);
  await c.setToolsOff([]);
  assert.ok(session.active.includes("web_search"));
});
