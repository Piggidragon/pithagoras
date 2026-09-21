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

/**
 * A tool that keeps one component per view and updates it, which is what pi's
 * lastComponent is for — and what used to be handed back disposed.
 */
function cachingTool() {
  const built = [];
  return {
    built,
    renderResult(result, { expanded }, _theme, ctx) {
      const key = expanded ? "open" : "shut";
      const kept = ctx.state[key];
      if (kept) {
        kept.alive || assert.fail("a disposed component was handed back");
        kept.lines = [`${result.count} again ${key}`];
        assert.equal(ctx.lastComponent, kept);
        return kept;
      }
      const made = {
        alive: true,
        lines: [`${result.count} ${key}`],
        render() {
          return this.alive ? this.lines : ["disposed"];
        },
        invalidate() {},
        dispose() {
          this.alive = false;
        },
      };
      built.push(made);
      ctx.state[key] = made;
      return made;
    },
  };
}

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

test("a component the tool keeps is drawn, not ended", () => {
  const tool = cachingTool();
  const r = renderer({ keeps: tool });
  const drawn = r.render({
    type: "tool_execution_end",
    toolName: "keeps",
    toolCallId: "1",
    result: { count: 2 },
  });
  assert.deepEqual(drawn, { collapsed: ["2 shut"], expanded: ["2 open"] });
  assert.equal(tool.built.length, 2);
  assert.ok(tool.built.every((c) => c.alive));
});

test("the tool is handed back the component it built for that view", () => {
  const tool = cachingTool();
  const r = renderer({ keeps: tool });
  const event = { toolName: "keeps", toolCallId: "1" };
  r.render({ ...event, type: "tool_execution_update", partialResult: { count: 1 } });
  const drawn = r.render({ ...event, type: "tool_execution_end", result: { count: 9 } });
  // Two components for two views, each updated rather than built again — the
  // assertions on lastComponent are inside the tool.
  assert.equal(tool.built.length, 2);
  assert.deepEqual(drawn, { collapsed: ["9 again shut"], expanded: ["9 again open"] });
});

test("the arguments are there when the result is drawn, not only the call", () => {
  // pi's end event carries no args, and pi's contract says a renderer has them
  // on every render of the same call.
  const seen = [];
  const r = renderer({
    search: {
      renderCall: () => component(["…"]),
      renderResult: (_result, _opts, _theme, ctx) => {
        seen.push(ctx.args);
        return component([`for ${ctx.args?.query}`]);
      },
    },
  });
  const event = { toolName: "search", toolCallId: "1" };
  r.render({ ...event, type: "tool_execution_start", args: { query: "ansi" } });
  const drawn = r.render({ ...event, type: "tool_execution_end", result: { ok: true } });
  assert.deepEqual(seen, [{ query: "ansi" }, { query: "ansi" }]);
  assert.deepEqual(drawn, { collapsed: ["for ansi"] });
});

test("a renderer that reads expanded off the context still gets a More", () => {
  // pi's own tool-execution.ts sets it in both places, so either is fair.
  const r = renderer({
    ctxonly: {
      renderResult: (result, _opts, _theme, ctx) =>
        component(ctx.expanded ? [`${result.count} results`, "  one", "  two"] : ["2 results"]),
    },
  });
  const drawn = r.render({
    type: "tool_execution_end",
    toolName: "ctxonly",
    toolCallId: "1",
    result: { count: 2 },
  });
  assert.deepEqual(drawn, {
    collapsed: ["2 results"],
    expanded: ["2 results", "  one", "  two"],
  });
});

test("the rest of pi's render context is there to be read", () => {
  let seen;
  const r = renderer({
    peek: {
      renderResult: (_result, _opts, _theme, ctx) => {
        seen = ctx;
        return component(["x"]);
      },
    },
  });
  r.render({
    type: "tool_execution_end",
    toolName: "peek",
    toolCallId: "1",
    result: {},
    isError: true,
  });
  assert.equal(seen.isError, true);
  assert.equal(seen.isPartial, false);
  assert.equal(seen.argsComplete, true);
  assert.equal(seen.showImages, false);
  assert.equal(seen.cwd, "/tmp");
});

test("a call with no id is forgotten under the name it was filed as", () => {
  const tool = cachingTool();
  const r = renderer({ keeps: tool });
  r.render({ type: "tool_execution_end", toolName: "keeps", result: { count: 1 } });
  assert.equal(tool.built.length, 2);
  // The same key ToolRenderer files it under when there is no call id.
  r.forget("keeps");
  r.render({ type: "tool_execution_end", toolName: "keeps", result: { count: 2 } });
  // Built again rather than handed the previous call's component, which would
  // have drawn the previous call's results.
  assert.equal(tool.built.length, 4);
});
