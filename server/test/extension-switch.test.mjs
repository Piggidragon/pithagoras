import { test } from "node:test";
import assert from "node:assert/strict";
import { isFiltered, isSwitchedOff, setPackageEnabled, sourceOf } from "../dist/extension-switch.js";

const OFF = (source) => ({ source, extensions: [], skills: [], prompts: [], themes: [] });

test("a package is named by its source, in either form", () => {
  assert.equal(sourceOf("npm:pi-lens"), "npm:pi-lens");
  assert.equal(sourceOf({ source: "npm:pi-lens", skills: [] }), "npm:pi-lens");
  assert.equal(sourceOf({ skills: [] }), undefined);
  assert.equal(sourceOf(42), undefined);
});

test("only a package with every kind emptied is off", () => {
  assert.equal(isSwitchedOff("npm:a"), false);
  assert.equal(isSwitchedOff(OFF("npm:a")), true);
  assert.equal(isSwitchedOff({ source: "npm:a", extensions: [] }), false, "skills and the rest are still loaded");
  assert.equal(isSwitchedOff({ source: "npm:a", extensions: ["x.ts"], skills: [], prompts: [], themes: [] }), false);
  assert.equal(isSwitchedOff({ ...OFF("npm:a"), autoload: false }), false, "a delta over another scope is not off");
});

test("a hand-written filter is filtered, a plain entry and an off one are not", () => {
  assert.equal(isFiltered("npm:a"), false);
  assert.equal(isFiltered(OFF("npm:a")), false);
  assert.equal(isFiltered({ source: "npm:a", extensions: ["!legacy.ts"] }), true);
});

test("switching a plain package off empties what it brings, and on writes it plain again", () => {
  const off = setPackageEnabled(["npm:a", "npm:b"], "npm:a", false, {});
  assert.deepEqual(off.packages, [OFF("npm:a"), "npm:b"]);
  assert.deepEqual(off.stash, {}, "a plain entry has nothing worth keeping");

  const on = setPackageEnabled(off.packages, "npm:a", true, off.stash);
  assert.deepEqual(on.packages, ["npm:a", "npm:b"]);
});

test("a hand-written filter survives being switched off and on", () => {
  const filtered = { source: "npm:a", extensions: ["extensions/*.ts", "!extensions/legacy.ts"] };
  const off = setPackageEnabled([filtered], "npm:a", false, {});
  assert.deepEqual(off.packages, [OFF("npm:a")]);
  assert.deepEqual(off.stash, { "npm:a": filtered });

  const on = setPackageEnabled(off.packages, "npm:a", true, off.stash);
  assert.deepEqual(on.packages, [filtered]);
  assert.deepEqual(on.stash, {}, "given back, so not kept twice");
});

test("saying what is already so changes nothing", () => {
  const packages = ["npm:a", OFF("npm:b")];
  const stash = { keep: 1 };
  assert.deepEqual(setPackageEnabled(packages, "npm:a", true, stash), { packages, stash });
  assert.deepEqual(setPackageEnabled(packages, "npm:b", false, stash), { packages, stash });
});

test("the stash is not overwritten by switching off twice", () => {
  const filtered = { source: "npm:a", skills: ["a"] };
  const first = setPackageEnabled([filtered], "npm:a", false, {});
  const again = setPackageEnabled(first.packages, "npm:a", false, first.stash);
  assert.deepEqual(again.stash, { "npm:a": filtered });
});

test("a package that is not listed is reported, not invented", () => {
  assert.equal(setPackageEnabled(["npm:a"], "npm:zzz", false, {}), null);
});

test("the input is left as it was", () => {
  const packages = ["npm:a"];
  const stash = {};
  setPackageEnabled(packages, "npm:a", false, stash);
  assert.deepEqual(packages, ["npm:a"]);
  assert.deepEqual(stash, {});
});

test("other entries keep their place and their filters", () => {
  const other = { source: "npm:c", prompts: ["p.md"] };
  const out = setPackageEnabled(["npm:a", other, "npm:b"], "npm:b", false, {});
  assert.equal(out.packages[1], other);
  assert.deepEqual(out.packages[2], OFF("npm:b"));
});

test("a filter put aside earlier is not brought back over a plain entry written since", () => {
  const filtered = { source: "npm:a", extensions: ["!legacy.ts"] };
  const stash = setPackageEnabled([filtered], "npm:a", false, {}).stash;
  // settings.json edited by hand back to the plain entry, then switched off and on.
  const off = setPackageEnabled(["npm:a"], "npm:a", false, stash);
  assert.deepEqual(off.stash, {});
  const on = setPackageEnabled(off.packages, "npm:a", true, off.stash);
  assert.deepEqual(on.packages, ["npm:a"]);
});
