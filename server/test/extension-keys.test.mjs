import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const home = mkdtempSync(path.join(tmpdir(), "portal-"));
process.env.DATA_DIR = home;
process.env.PI_CODING_AGENT_DIR = path.join(home, "agent");
const { settingKeysOf } = await import("../dist/api/extensions.js");

test("an extension worked on in a folder of its own shows a setting as soon as its code reads one", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ext-"));
  writeFileSync(path.join(dir, "index.ts"), "export default (pi, settings) => settings.first;");
  assert.deepEqual(settingKeysOf(dir, false), ["first"]);
  await new Promise((r) => setTimeout(r, 20));
  writeFileSync(path.join(dir, "index.ts"), "export default (pi, settings) => settings.first ?? settings.second;");
  assert.deepEqual(settingKeysOf(dir, false), ["first", "second"]);
});

test("one installed from npm is scanned again only when it is installed again", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ext-"));
  writeFileSync(path.join(dir, "package.json"), '{"name":"x","version":"1.0.0"}');
  writeFileSync(path.join(dir, "index.js"), "settings.first");
  assert.deepEqual(settingKeysOf(dir, true), ["first"]);
  await new Promise((r) => setTimeout(r, 20));
  writeFileSync(path.join(dir, "index.js"), "settings.first; settings.second");
  assert.deepEqual(settingKeysOf(dir, true), ["first"], "kept: its package.json did not change");
  writeFileSync(path.join(dir, "package.json"), '{"name":"x","version":"1.0.1"}');
  assert.deepEqual(settingKeysOf(dir, true), ["first", "second"]);
});
