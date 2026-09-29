import { test } from "node:test";
import assert from "node:assert/strict";
import { filterSessions } from "../web/src/session-filter.ts";

const list = [
  { title: "Fix login", workspace: "/home/me/webapp" },
  { title: "Write report", workspace: "/home/me/docs" },
  { title: "Refactor", workspace: "/srv/Webapp" },
];

test("nothing typed is everything", () => {
  assert.equal(filterSessions(list, "").length, 3);
  assert.equal(filterSessions(list, "   ").length, 3);
});

test("matches the name or the folder, in any case", () => {
  assert.deepEqual(filterSessions(list, "LOGIN").map((s) => s.title), ["Fix login"]);
  assert.deepEqual(filterSessions(list, "webapp").map((s) => s.title), ["Fix login", "Refactor"]);
});

test("a word is not glued to the next field", () => {
  // "login/home" would match if title and folder were joined without a gap.
  assert.equal(filterSessions(list, "login/home").length, 0);
});

test("nothing matching is nothing", () => {
  assert.deepEqual(filterSessions(list, "zzz"), []);
});
