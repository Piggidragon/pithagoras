import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// A database of its own, before anything opens the default one.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "pithagoras-browser-"));

const {
  browserAllowed,
  createSession,
  getSession,
  rememberTools,
  setSessionTools,
  setToolDefaultsOff,
} = await import("../dist/db.js");

const BROWSER = ["browser_browser_click", "browser_browser_navigate"];

rememberTools([
  ...BROWSER.map((name) => ({ name, source: "pi-mcp-adapter" })),
  { name: "web_search", source: "pi-web-access" },
]);

createSession({
  id: "grant1",
  title: "grant",
  workspace: process.env.DATA_DIR,
  executor: "host",
});
/** Read back each time: browserAllowed asks the switches, not the row. */
const session = () => getSession("grant1");

test("a conversation has the browser when it has the browser's tools", () => {
  assert.equal(browserAllowed(session()), true);
});

test("switching the browser's tools off for one chat takes the browser with them", () => {
  setSessionTools("grant1", { off: BROWSER, on: [] });
  assert.equal(browserAllowed(session()), false);
  // One of them left on is still a conversation that reaches the browser.
  setSessionTools("grant1", { off: [BROWSER[0]], on: [] });
  assert.equal(browserAllowed(session()), true);
  setSessionTools("grant1", { off: [], on: [] });
});

test("switching them off by default takes it from every chat that has not said otherwise", () => {
  setToolDefaultsOff(BROWSER);
  assert.equal(browserAllowed(session()), false);
  // And a chat that says otherwise keeps it.
  setSessionTools("grant1", { off: [], on: [BROWSER[0]] });
  assert.equal(browserAllowed(session()), true);
  setToolDefaultsOff([]);
  setSessionTools("grant1", { off: [], on: [] });
});

test("a tool that is not the browser's does not grant it", () => {
  setSessionTools("grant1", { off: BROWSER, on: ["web_search"] });
  assert.equal(browserAllowed(session()), false);
});
