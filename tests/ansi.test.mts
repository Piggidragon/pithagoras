import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAnsi, readable, PALETTE } from "../web/src/ansi.ts";

test("plain text is one run", () => {
  assert.deepEqual(parseAnsi("hello"), [{ text: "hello" }]);
});

test("a colour applies until it is turned off", () => {
  const segments = parseAnsi("\u001b[38;5;109mtitle\u001b[39m · rest");
  assert.deepEqual(segments.map((s) => s.text), ["title", " · rest"]);
  assert.deepEqual(segments[0].color, PALETTE[109]);
  assert.equal(segments[1].color, undefined);
});

test("a reset clears everything the line had set", () => {
  const segments = parseAnsi("\u001b[1m\u001b[4m\u001b[31mloud\u001b[0mquiet");
  assert.equal(segments[0].bold, true);
  assert.equal(segments[0].underline, true);
  assert.deepEqual(segments[0].color, PALETTE[1]);
  assert.deepEqual(segments[1], { text: "quiet" });
});

test("truecolor is taken as it is given", () => {
  assert.deepEqual(parseAnsi("\u001b[38;2;12;34;56mx")[0].color, [12, 34, 56]);
});

test("a background colour is skipped without eating the foreground after it", () => {
  const segments = parseAnsi("\u001b[48;5;17m\u001b[38;5;231mon top");
  assert.deepEqual(segments[0].color, PALETTE[231]);
});

test("bright colours come from the top half of the palette", () => {
  assert.deepEqual(parseAnsi("\u001b[91mbright")[0].color, PALETTE[9]);
});

test("runs that look the same are one run", () => {
  const segments = parseAnsi("\u001b[31mone\u001b[31mtwo");
  assert.equal(segments.length, 1);
  assert.equal(segments[0].text, "onetwo");
});

test("a cursor move leaves no text behind", () => {
  assert.deepEqual(parseAnsi("\u001b[2Kline\u001b[K"), [{ text: "line" }]);
});

test("pi's cursor marker is not text either", () => {
  assert.deepEqual(parseAnsi("a\u001b_pi:c\u0007b"), [{ text: "ab" }]);
});

test("a terminal hyperlink becomes a link", () => {
  const segments = parseAnsi("\u001b]8;;https://example.com\u0007Example\u001b]8;;\u0007 after");
  assert.equal(segments[0].text, "Example");
  assert.equal(segments[0].href, "https://example.com");
  assert.equal(segments[1].href, undefined);
});

test("a link a browser should not follow is not made one", () => {
  const segments = parseAnsi("\u001b]8;;javascript:alert(1)\u0007click\u001b]8;;\u0007");
  assert.equal(segments[0].href, undefined);
  assert.equal(segments[0].text, "click");
});

test("an OSC that is not a link is dropped whole", () => {
  assert.deepEqual(parseAnsi("\u001b]0;a title\u0007text"), [{ text: "text" }]);
});

test("a near-white is pushed down until it can be read on a light page", () => {
  const before = PALETTE[188];
  const after = readable(before, false);
  assert.ok(after[0] < before[0]);
  assert.ok((0.2126 * after[0] + 0.7152 * after[1] + 0.0722 * after[2]) / 255 <= 0.56);
});

test("a near-black is lifted on a dark page", () => {
  const after = readable(PALETTE[235], true);
  assert.ok(after[0] > PALETTE[235][0]);
});

test("a colour that already reads is left exactly alone", () => {
  const mid: [number, number, number] = [130, 130, 130];
  assert.deepEqual(readable(mid, true), mid);
  assert.deepEqual(readable(mid, false), mid);
});

test("bending keeps the hue, so a red stays red", () => {
  const [r, g, b] = readable([120, 20, 20], true);
  assert.ok(r > g && r > b);
});
