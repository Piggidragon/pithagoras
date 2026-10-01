import { test } from "node:test";
import assert from "node:assert/strict";
import { argumentMatches, argumentToken, moveHighlight, paletteMatches, slashToken, typedCommand } from "../web/src/slash-palette.ts";

const c = (...names: string[]) => names.map((name) => ({ name }));

test("a bare slash and one word is a token; anything more is a message", () => {
  assert.equal(slashToken("/"), "");
  assert.equal(slashToken("/cl"), "cl");
  assert.equal(slashToken("  /skill:review"), "skill:review");
  assert.equal(slashToken("/name My chat"), null);
  assert.equal(slashToken("/clear "), null);
  assert.equal(slashToken("hello /cl"), null);
});

test("under another trigger it is that character that starts a token, and the slash is only text", () => {
  assert.equal(slashToken("!", "!"), "");
  assert.equal(slashToken("!cl", "!"), "cl");
  assert.equal(slashToken("  !skill:review", "!"), "skill:review");
  assert.equal(slashToken("!name My chat", "!"), null);
  assert.equal(slashToken("/", "!"), null);
  assert.equal(slashToken("/cl", "!"), null);
  assert.equal(slashToken("hello !cl", "!"), null);
  // A trigger that is a pattern character in a regex is not read as one.
  assert.equal(slashToken(".cl", "."), "cl");
  assert.equal(slashToken("xcl", "."), null);
  assert.equal(slashToken("$cl", "$"), "cl");
  assert.equal(slashToken("\\cl", "\\"), "cl");
});

test("a command is read from what was typed, under the trigger and as a slash", () => {
  assert.deepEqual(typedCommand("/clear"), { name: "clear", args: "", wire: "/clear" });
  assert.deepEqual(typedCommand("/skill:review the diff"), { name: "skill:review", args: "the diff", wire: "/skill:review the diff" });
  // The one pi is sent keeps the slash, whatever it was typed with.
  assert.deepEqual(typedCommand("!clear", "!"), { name: "clear", args: "", wire: "/clear" });
  assert.deepEqual(typedCommand("!skill:review the  diff", "!"), { name: "skill:review", args: "the  diff", wire: "/skill:review the  diff" });
  // What follows the name is sent as it was written, line breaks included.
  assert.deepEqual(typedCommand("!skill:review a\nb", "!"), { name: "skill:review", args: "a\nb", wire: "/skill:review a\nb" });
  // A command typed the old way is still one, though the trigger has changed.
  assert.deepEqual(typedCommand("/new", "!"), { name: "new", args: "", wire: "/new" });
  // Neither is a message that merely starts with the character.
  assert.equal(typedCommand("!", "!"), null);
  assert.equal(typedCommand("!!", "!"), null);
  assert.equal(typedCommand("hello !clear", "!"), null);
  assert.equal(typedCommand("!clear", "/"), null);
  assert.equal(typedCommand("hello"), null);
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

test("a command, a space and one word is an argument being typed; the first word only", () => {
  assert.deepEqual(argumentToken("/screen "), { name: "screen", typed: "" });
  assert.deepEqual(argumentToken("/screen rp"), { name: "screen", typed: "rp" });
  assert.deepEqual(argumentToken("  /skill:review @scope/pkg"), { name: "skill:review", typed: "@scope/pkg" });
  assert.deepEqual(argumentToken("/screen\trp"), { name: "screen", typed: "rp" });
  // The name alone is still the palette's; a second word, a line break or other text before it is a message.
  assert.equal(argumentToken("/screen"), null);
  assert.equal(argumentToken("/screen one two"), null);
  assert.equal(argumentToken("/screen one "), null);
  assert.equal(argumentToken("/screen one\ntwo"), null);
  assert.equal(argumentToken("/screen\n"), null);
  assert.equal(argumentToken("hello /screen x"), null);
  assert.equal(argumentToken("/etc/hosts is wrong"), null);
});

test("under another trigger the argument is read after it, and after the slash that may have been typed", () => {
  assert.deepEqual(argumentToken("!screen rp", "!"), { name: "screen", typed: "rp" });
  assert.deepEqual(argumentToken("/screen rp", "!"), { name: "screen", typed: "rp" });
  assert.equal(argumentToken("?screen rp", "!"), null);
  assert.deepEqual(argumentToken(".screen rp", "."), { name: "screen", typed: "rp" });
  assert.equal(argumentToken("xscreen rp", "."), null);
});

test("what starts with the typed word comes first, then what has it inside, each in the order offered", () => {
  const all = [{ value: "@scope/rpiv-todo" }, { value: "rpiv-ask" }, { value: "web-search" }, { value: "rpiv-web" }];
  assert.deepEqual(
    argumentMatches(all, "rpiv").map((x) => x.value),
    ["rpiv-ask", "rpiv-web", "@scope/rpiv-todo"],
  );
  assert.deepEqual(
    argumentMatches(all, "WEB").map((x) => x.value),
    ["web-search", "rpiv-web"],
  );
  assert.deepEqual(argumentMatches(all, "").map((x) => x.value), all.map((x) => x.value));
  assert.deepEqual(argumentMatches(all, "zzz"), []);
});

test("nothing is suggested once what was typed is one of the values in full, so Enter sends it", () => {
  const all = [{ value: "todo" }, { value: "todo-plus" }];
  assert.deepEqual(argumentMatches(all, "todo"), []);
  assert.deepEqual(argumentMatches(all, "TODO"), []);
  assert.deepEqual(
    argumentMatches(all, "todo-").map((x) => x.value),
    ["todo-plus"],
  );
  assert.deepEqual(argumentMatches([], "x"), []);
});
