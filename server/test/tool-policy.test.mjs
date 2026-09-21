import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toolEnabled,
  effectiveOff,
  exceptionsFor,
  browserTool,
  mcpServerOf,
  toolSource,
} from "../dist/tool-policy.js";

const none = { off: [], on: [] };

test("with nothing said anywhere, a tool is on", () => {
  assert.equal(toolEnabled("web_search", [], none), true);
});

test("a default takes effect where a conversation is silent", () => {
  assert.equal(toolEnabled("web_search", ["web_search"], none), false);
});

test("a conversation may switch off what the default leaves on", () => {
  assert.equal(toolEnabled("web_search", [], { off: ["web_search"], on: [] }), false);
});

test("and switch on what the default has off", () => {
  assert.equal(toolEnabled("web_search", ["web_search"], { off: [], on: ["web_search"] }), true);
});

test("off wins over on, so a contradiction fails closed", () => {
  assert.equal(
    toolEnabled("web_search", [], { off: ["web_search"], on: ["web_search"] }),
    false
  );
});

test("what pi is told is everything off, however it got that way", () => {
  const off = effectiveOff(["a", "b", "c"], ["b"], { off: ["a"], on: [] });
  assert.deepEqual(off, ["a", "b"]);
});

test("a tool nobody has loaded is still named, so its switch is not lost", () => {
  assert.deepEqual(effectiveOff([], ["gone"], none), ["gone"]);
});

test("wanting exactly the default writes nothing down", () => {
  const e = exceptionsFor(["b"], ["b"], ["a", "b"]);
  assert.deepEqual(e, { off: [], on: [] });
});

test("switching off something the default leaves on is written as an exception", () => {
  assert.deepEqual(exceptionsFor(["a"], [], ["a", "b"]), { off: ["a"], on: [] });
});

test("switching on something the default has off is written the other way", () => {
  assert.deepEqual(exceptionsFor([], ["a"], ["a", "b"]), { off: [], on: ["a"] });
});

/** The reason exceptions are stored rather than the whole picture. */
test("a default changed later reaches a conversation that never disagreed", () => {
  const exceptions = exceptionsFor([], [], ["a", "b"]);
  assert.deepEqual(exceptions, { off: [], on: [] });
  assert.equal(toolEnabled("a", ["a"], exceptions), false);
});

test("but not one that did", () => {
  const exceptions = exceptionsFor([], ["a"], ["a"]);
  assert.deepEqual(exceptions, { off: [], on: ["a"] });
  assert.equal(toolEnabled("a", ["a"], exceptions), true);
});

test("the browser's tools are known by the name the adapter gives them", () => {
  assert.ok(browserTool("browser_browser_click"));
  assert.ok(browserTool("browser_navigate"));
  assert.ok(!browserTool("web_search"));
  assert.ok(!browserTool("browserify"));
});

test("a tool is filed under the MCP server it came through", () => {
  const servers = ["browser", "jira"];
  assert.equal(toolSource("browser_browser_click", "pi-mcp-adapter", servers), "browser");
  assert.equal(toolSource("jira_create_issue", "pi-mcp-adapter", servers), "jira");
  // The adapter's own tools are not any server's.
  assert.equal(toolSource("mcp", "pi-mcp-adapter", servers), "pi-mcp-adapter");
  assert.equal(toolSource("web_search", "pi-web-access", servers), "pi-web-access");
});

test("the longer server name wins, so one does not claim another's tools", () => {
  assert.equal(mcpServerOf("browser_staging_click", ["browser", "browser_staging"]), "browser_staging");
  assert.equal(mcpServerOf("browser_click", ["browser", "browser_staging"]), "browser");
  assert.equal(mcpServerOf("web_search", ["browser"]), undefined);
});
