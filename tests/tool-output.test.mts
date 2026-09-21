import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTranscript } from "../web/src/transcript.ts";

const ev = (seq: number, type: string, payload: unknown) => ({ seq, type, payload });

const ran = (result: unknown, extra: Record<string, unknown> = {}) =>
  buildTranscript([
    ev(1, "tool_execution_start", { toolName: "web_search", toolCallId: "c1", args: { q: "x" } }),
    ev(2, "tool_execution_end", { toolName: "web_search", toolCallId: "c1", result, ...extra }),
  ]).find((i) => i.kind === "tool") as any;

test("what a tool returned as content is kept for the row", () => {
  const item = ran({ content: [{ type: "text", text: "https://example.com\nhttps://example.org" }] });
  assert.equal(item.output, "https://example.com\nhttps://example.org");
});

test("a tool that returns a plain string is kept too", () => {
  assert.equal(ran({ output: "done in 4ms" }).output, "done in 4ms");
});

test("several text parts are one block", () => {
  const item = ran({ content: [{ type: "text", text: "one" }, { type: "text", text: "two" }] });
  assert.equal(item.output, "one\ntwo");
});

test("an image has no text to fold away", () => {
  assert.equal(ran({ content: [{ type: "image", data: "…" }] }).output, undefined);
});

test("a tool that said nothing gets no empty block", () => {
  assert.equal(ran({ output: "   " }).output, undefined);
  assert.equal(ran({}).output, undefined);
});

test("a whole file is cut off rather than put in the page entire", () => {
  const item = ran({ output: "x".repeat(50_000) });
  assert.ok(item.output.length < 21_000);
  assert.ok(item.output.endsWith("…"));
});

test("output and the tool's own drawing sit side by side", () => {
  const item = ran(
    { content: [{ type: "text", text: "the whole answer" }] },
    { render: { collapsed: ["5 sources"], expanded: ["5 sources", "  https://example.com"] } },
  );
  assert.deepEqual(item.render, {
    collapsed: ["5 sources"],
    expanded: ["5 sources", "  https://example.com"],
  });
  assert.equal(item.output, "the whole answer");
});

test("a failed tool still shows what it said, as an error", () => {
  const item = ran({ output: "connection refused" }, { isError: true });
  assert.equal(item.status, "error");
  assert.equal(item.output, "connection refused");
});

test("the sources of a tool call are worked out once, not on every rebuild", () => {
  // The transcript is rebuilt from the whole event list on every streamed
  // delta; reading the links out again each time is a regex pass over every
  // tool result in the conversation, per frame.
  const events = [
    ev(1, "tool_execution_start", { toolName: "web_search", toolCallId: "c1", args: { q: "x" } }),
    ev(2, "tool_execution_end", {
      toolName: "web_search",
      toolCallId: "c1",
      result: { output: "Source: https://example.com" },
    }),
  ];
  const first = (buildTranscript(events).find((i) => i.kind === "tool") as any).links;
  const again = (buildTranscript(events).find((i) => i.kind === "tool") as any).links;
  assert.equal(first.length, 1);
  assert.equal(again, first);
});
