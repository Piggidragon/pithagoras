import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const { isWithinReal, isWithinText } = await import("../dist/workspaces.js");

test("the folder itself and what is under it are within it, by text", () => {
  assert.equal(isWithinText("/w/site", "/w/site"), true);
  assert.equal(isWithinText("/w/site", "/w/site/src/a.ts"), true);
});

test("a sibling that shares the start of the name is not", () => {
  assert.equal(isWithinText("/w/site", "/w/site-old"), false);
  assert.equal(isWithinText("/w/site", "/w/site-old/a.ts"), false);
  assert.equal(isWithinText("/w/site", "/w"), false);
});

test("a trailing separator and the root folder are handled", () => {
  assert.equal(isWithinText("/w/site/", "/w/site"), true);
  assert.equal(isWithinText("/w/site/", "/w/site/a.ts"), true);
  assert.equal(isWithinText("/", "/etc/passwd"), true);
});

test("by where it leads, a link into the folder counts as inside, and an empty place does not", () => {
  const home = mkdtempSync(path.join(tmpdir(), "pithagoras-within-"));
  const project = path.join(home, "site");
  mkdirSync(path.join(project, "docs"), { recursive: true });
  symlinkSync(path.join(project, "docs"), path.join(home, "shortcut"));
  assert.equal(isWithinText(project, path.join(home, "shortcut")), false);
  assert.equal(isWithinReal(project, path.join(home, "shortcut")), true);
  assert.equal(isWithinReal(project, path.join(home, "site-old")), false);
  assert.equal(isWithinReal(project, null), false);
});
