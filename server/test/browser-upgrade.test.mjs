import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// An install that already has conversations in it, opened the way a server
// opens it after an upgrade: the database first, the tools later.
const home = mkdtempSync(path.join(tmpdir(), "pithagoras-upgrade-"));
process.env.DATA_DIR = home;
process.env.PI_CODING_AGENT_DIR = path.join(home, "agent");
mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });
writeFileSync(
  path.join(process.env.PI_CODING_AGENT_DIR, "mcp.json"),
  JSON.stringify({ mcpServers: { browser: {} } })
);

const {
  adoptBrowserGrants,
  browserAllowed,
  browserByDefault,
  createSession,
  getDb,
  getSession,
  rememberTools,
  sessionTools,
  toolDefaultsOff,
} = await import("../dist/db.js");

const BROWSER = ["browser_browser_click", "browser_browser_navigate"];
const seen = () => [
  ...BROWSER.map((name) => ({ name, source: "pi-mcp-adapter" })),
  { name: "web_search", source: "pi-web-access" },
];
const flag = () =>
  getDb().prepare("SELECT value FROM settings WHERE key = 'browser_tools_adopted'").get()?.value;

// What the database looked like before this build: conversations, one of which
// was given the browser, and no record of any tool.
createSession({ id: "was-on", title: "granted", workspace: home, executor: "host" });
createSession({ id: "was-off", title: "not granted", workspace: home, executor: "host" });
getDb().prepare("UPDATE sessions SET browser = 1 WHERE id = 'was-on'").run();
getDb().prepare("DELETE FROM settings WHERE key IN ('browser_tools_adopted', 'tools_seen')").run();

test("the first start after an upgrade has nothing to carry yet, and does not pretend to", () => {
  adoptBrowserGrants();
  // Not done: no session has registered a tool, so there is no telling which
  // are the browser's. Marking it done here is what made the migration a no-op.
  assert.equal(flag(), "pending");
  assert.deepEqual(toolDefaultsOff(), []);
});

test("until the tools are seen, the old grant stands", () => {
  assert.equal(browserAllowed(getSession("was-on")), true);
  assert.equal(browserAllowed(getSession("was-off")), false);
  assert.equal(browserByDefault(), false);
});

test("the first session to register them carries the posture over", () => {
  // The order production has: the database is open long before any session
  // launches and reports its tools.
  rememberTools(seen());
  assert.equal(flag(), "1");
  for (const name of BROWSER) assert.ok(toolDefaultsOff().includes(name), name);
  assert.deepEqual(sessionTools("was-on").on, BROWSER);
  assert.equal(browserAllowed(getSession("was-on")), true);
  assert.equal(browserAllowed(getSession("was-off")), false);
  assert.equal(browserByDefault(), false);
});

test("and only once", () => {
  getDb().prepare("DELETE FROM settings WHERE key = 'tools_off_default'").run();
  rememberTools(seen());
  assert.deepEqual(toolDefaultsOff(), []);
  assert.equal(browserAllowed(getSession("was-off")), true);
});
