import { test } from "node:test";
import assert from "node:assert/strict";
import { moveHighlight, paletteMatches, slashToken } from "../web/src/slash-palette.ts";

const c = (...names: string[]) => names.map((name) => ({ name }));

test("a bare slash and one word is a token; anything more is a message", () => {
  assert.equal(slashToken("/"), "");
  assert.equal(slashToken("/cl"), "cl");
  assert.equal(slashToken("  /skill:review"), "skill:review");
  assert.equal(slashToken("/name My chat"), null);
  assert.equal(slashToken("/clear "), null);
  assert.equal(slashToken("hello /cl"), null);
});

test("a lone slash lists every command, however many there are", () => {
  const many = c(...Array.from({ length: 40 }, (_, i) => `cmd${i}`));
  assert.equal(paletteMatches(many, "").length, 40);
});

test("matches are by prefix and ignore case", () => {
  const all = c("clear", "compact", "Classify", "new");
  assert.deepEqual(
    paletteMatches(all, "cl").map((x) => x.name),
    ["clear", "Classify"],
  );
  assert.deepEqual(paletteMatches(all, "zzz"), []);
});

test("a command typed in full comes before the longer ones that share its start", () => {
  const all = c("skill:ab", "skill:a", "skill:abc");
  assert.deepEqual(
    paletteMatches(all, "skill:a").map((x) => x.name),
    ["skill:a", "skill:ab", "skill:abc"],
  );
});

test("without an exact match the order is the one given", () => {
  const all = c("compact", "context", "copy");
  assert.deepEqual(
    paletteMatches(all, "co").map((x) => x.name),
    ["compact", "context", "copy"],
  );
});

test("the highlight wraps at both ends", () => {
  assert.equal(moveHighlight(0, 1, 3), 1);
  assert.equal(moveHighlight(2, 1, 3), 0);
  assert.equal(moveHighlight(0, -1, 3), 2);
  assert.equal(moveHighlight(0, 1, 0), 0);
});
