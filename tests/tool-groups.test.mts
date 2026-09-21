import { test } from "node:test";
import assert from "node:assert/strict";
import { groupSummary, groupTools, nextOff, toggleOpen } from "../web/src/tool-groups.ts";

const tool = (name: string, source: string, enabled = true) => ({
  name,
  source,
  enabled,
  description: undefined,
});

test("tools are grouped by what they came from", () => {
  const groups = groupTools([
    tool("web_search", "pi-web-access"),
    tool("bash", "built in"),
    tool("web_fetch", "pi-web-access"),
  ]);
  assert.deepEqual(groups.map((g) => [g.source, g.tools.length]), [
    ["pi-web-access", 2],
    ["built in", 1],
  ]);
});

test("what was installed comes before what was always there", () => {
  const groups = groupTools([tool("bash", "built in"), tool("todo", "rpiv-todo")]);
  assert.deepEqual(groups.map((g) => g.source), ["rpiv-todo", "built in"]);
});

test("a group knows whether all of it is on, off, or neither", () => {
  const [group] = groupTools([
    tool("a", "pkg", true),
    tool("b", "pkg", false),
  ]);
  assert.equal(group.allOn, false);
  assert.equal(group.allOff, false);
  assert.equal(groupTools([tool("a", "pkg", true)])[0].allOn, true);
  assert.equal(groupTools([tool("a", "pkg", false)])[0].allOff, true);
});

test("a tool with no source of its own is not its own group", () => {
  const groups = groupTools([tool("a", ""), tool("b", "  ")]);
  assert.deepEqual(groups.map((g) => g.source), ["built in"]);
  assert.equal(groups[0].tools.length, 2);
});

test("tools within a group read in order", () => {
  const [group] = groupTools([tool("zed", "pkg"), tool("alpha", "pkg")]);
  assert.deepEqual(group.tools.map((t) => t.name), ["alpha", "zed"]);
});

test("switching one off adds it to what is written down", () => {
  assert.deepEqual(nextOff([], ["web_search"], false), ["web_search"]);
});

test("switching it back on takes it out again", () => {
  assert.deepEqual(nextOff(["web_search", "todo"], ["web_search"], true), ["todo"]);
});

test("a whole group goes at once", () => {
  assert.deepEqual(nextOff([], ["web_search", "web_fetch"], false), ["web_fetch", "web_search"]);
  assert.deepEqual(nextOff(["web_search", "web_fetch"], ["web_search", "web_fetch"], true), []);
});

test("switching off what is already off changes nothing", () => {
  assert.deepEqual(nextOff(["a"], ["a"], false), ["a"]);
});

/**
 * An extension that is not loaded right now still has its switches remembered,
 * or reinstalling it would quietly bring back tools somebody turned off.
 */
test("a name the session has never heard of is kept", () => {
  assert.deepEqual(nextOff(["gone_tool"], ["web_search"], false), ["gone_tool", "web_search"]);
});

test("a group shut says whether anything in it is off", () => {
  const [group] = groupTools([tool("a", "ext"), tool("b", "ext")]);
  assert.equal(groupSummary(group), "2 on");
});

test("a group with something switched off says how much", () => {
  const [group] = groupTools([tool("a", "ext"), tool("b", "ext", false)]);
  assert.equal(groupSummary(group), "1 of 2 off");
});

test("a group switched off entirely says so without counting", () => {
  const [group] = groupTools([tool("a", "ext", false), tool("b", "ext", false)]);
  assert.equal(groupSummary(group), "2 off");
});

test("opening a group and shutting it again", () => {
  assert.deepEqual(toggleOpen([], "pi-web-access"), ["pi-web-access"]);
  assert.deepEqual(toggleOpen(["pi-lens", "pi-web-access"], "pi-lens"), ["pi-web-access"]);
});

test("a group whose tools answer to something else says so", () => {
  const [group] = groupTools([
    { name: "browser_browser_click", source: "browser", enabled: true, owner: "browser", description: undefined },
    { name: "browser_browser_navigate", source: "browser", enabled: true, owner: "browser", description: undefined },
  ]);
  assert.equal(group.owner, "browser");
  assert.equal(group.source, "browser");
  assert.equal(groupSummary(group), "2 on");
});

test("an ordinary group has no owner", () => {
  const [group] = groupTools([tool("web_search", "pi-web-access")]);
  assert.equal(group.owner, undefined);
});
