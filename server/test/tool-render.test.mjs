import { test } from "node:test";
import assert from "node:assert/strict";
import { ToolRenderer } from "../dist/pi/tool-render.js";

const runtime = { theme: {}, keybindings: {} };
const component = (lines) => ({ render: () => lines, invalidate() {} });

/** A tool that draws a thin row closed and everything open, as a search does. */
const searchTool = {
  renderCall: (args) => component([`searching "${args?.query}"`]),
  renderResult: (result, { expanded, isPartial }) =>
    component(
      expanded
        ? [`${result.count} results`, "  https://example.com"]
        : [`${result.count} results${isPartial ? "…" : ""}`]
    ),
};

const renderer = (tools) => new ToolRenderer(runtime, "/tmp", (name) => tools[name]);

test("a tool that draws nothing keeps the row the portal builds", () => {
  const r = renderer({ plain: {} });
  assert.equal(r.render({ type: "tool_execution_start", toolName: "plain", toolCallId: "1" }), undefined);
  assert.equal(
    r.render({ type: "tool_execution_end", toolName: "plain", toolCallId: "1", result: {} }),
    undefined
  );
});

test("a tool nobody has heard of is left alone", () => {
  const r = renderer({});
  assert.equal(r.render({ type: "tool_execution_start", toolName: "gone", toolCallId: "1" }), undefined);
});

test("the call is drawn from the arguments", () => {
  const r = renderer({ search: searchTool });
  const drawn = r.render({
    type: "tool_execution_start",
    toolName: "search",
    toolCallId: "1",
    args: { query: "ansi" },
  });
  assert.deepEqual(drawn, { collapsed: ['searching "ansi"'] });
});

test("both views of the result are drawn, because the closed one is deliberately thin", () => {
  const r = renderer({ search: searchTool });
  const drawn = r.render({
    type: "tool_execution_end",
    toolName: "search",
    toolCallId: "1",
    result: { count: 2 },
  });
  assert.deepEqual(drawn.collapsed, ["2 results"]);
  assert.deepEqual(drawn.expanded, ["2 results", "  https://example.com"]);
});

test("a tool that ignores the flag is not offered an empty More", () => {
  const r = renderer({ same: { renderResult: () => component(["one line"]) } });
  const drawn = r.render({
    type: "tool_execution_end",
    toolName: "same",
    toolCallId: "1",
    result: {},
  });
  assert.deepEqual(drawn, { collapsed: ["one line"] });
});

test("a streaming result says so to the tool", () => {
  const r = renderer({ search: searchTool });
  const drawn = r.render({
    type: "tool_execution_update",
    toolName: "search",
    toolCallId: "1",
    partialResult: { count: 1 },
  });
  assert.deepEqual(drawn.collapsed, ["1 results…"]);
});

test("the state pi shares between a call and its result is the same object", () => {
  const seen = [];
  const r = renderer({
    stateful: {
      renderCall: (_a, _t, ctx) => {
        seen.push(ctx.state);
        return component(["call"]);
      },
      renderResult: (_r, _o, _t, ctx) => {
        seen.push(ctx.state);
        return component(["result"]);
      },
    },
  });
  r.render({ type: "tool_execution_start", toolName: "stateful", toolCallId: "7" });
  r.render({ type: "tool_execution_end", toolName: "stateful", toolCallId: "7", result: {} });
  assert.equal(seen.length, 3);
  assert.equal(seen[0], seen[1]);
});

test("a different call gets its own state", () => {
  const seen = [];
  const r = renderer({
    stateful: {
      renderCall: (_a, _t, ctx) => {
        seen.push(ctx.state);
        return component(["call"]);
      },
    },
  });
  r.render({ type: "tool_execution_start", toolName: "stateful", toolCallId: "a" });
  r.render({ type: "tool_execution_start", toolName: "stateful", toolCallId: "b" });
  assert.notEqual(seen[0], seen[1]);
});

test("a tool that throws while drawing loses its row, not the run", () => {
  const r = renderer({
    broken: {
      renderResult() {
        throw new Error("no layout");
      },
    },
  });
  assert.equal(
    r.render({ type: "tool_execution_end", toolName: "broken", toolCallId: "1", result: {} }),
    undefined
  );
});

test("a result that never arrived is not drawn as an empty one", () => {
  const r = renderer({ search: searchTool });
  assert.equal(
    r.render({ type: "tool_execution_end", toolName: "search", toolCallId: "1" }),
    undefined
  );
});

test("a tool that renders a whole file does not put it in the event log twice", () => {
  const huge = Array.from({ length: 5000 }, (_, i) => `line ${i}`);
  const r = renderer({ dump: { renderResult: () => component(huge) } });
  const drawn = r.render({
    type: "tool_execution_end",
    toolName: "dump",
    toolCallId: "1",
    result: {},
  });
  assert.ok(drawn.collapsed.length < 500);
  assert.equal(drawn.collapsed.at(-1).trim(), "…");
});

test("anything that is not a tool event is not a tool's to draw", () => {
  const r = renderer({ search: searchTool });
  assert.equal(r.render({ type: "message_end", toolName: "search" }), undefined);
  assert.equal(r.render({ type: "tool_execution_start" }), undefined);
});
