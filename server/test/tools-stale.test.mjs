import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const home = mkdtempSync(path.join(tmpdir(), "pithagoras-stale-"));
process.env.DATA_DIR = home;
process.env.WORKSPACE_ROOT = path.join(home, "ws");
process.env.PI_CODING_AGENT_DIR = path.join(home, "agent");
mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });
const settings = path.join(process.env.PI_CODING_AGENT_DIR, "settings.json");
const listPackages = (packages) => writeFileSync(settings, JSON.stringify({ packages }));
const OFF = (source) => ({ source, extensions: [], skills: [], prompts: [], themes: [] });

const { createSession, forgetPackageTools, knownTools, rememberTools, shownTools } = await import("../dist/db.js");
const { sessions } = await import("../dist/session-manager.js");

const TODO = "npm:@juicesharp/rpiv-todo";

test("the tools of a package that is switched off are not listed, and come back with it", async () => {
  rememberTools([
    { name: "todo", source: "@juicesharp/rpiv-todo", package: TODO },
    { name: "bash", source: "built in" },
  ]);
  listPackages([TODO]);
  assert.deepEqual(shownTools().map((t) => t.name), ["bash", "todo"]);

  listPackages([OFF(TODO)]);
  assert.deepEqual(shownTools().map((t) => t.name), ["bash"]);
  // An idle chat is offered what is shown, not the whole catalogue.
  createSession({ id: "idle", title: "idle", workspace: home, executor: "host" });
  assert.deepEqual((await sessions.getTools("idle")).tools.map((t) => t.name), ["bash"]);
  // Remembered all the same, for when the package is switched on again.
  assert.deepEqual(knownTools().map((t) => t.name), ["bash", "todo"]);

  listPackages([TODO]);
  assert.deepEqual((await sessions.getTools("idle")).tools.map((t) => t.name), ["bash", "todo"]);
});

test("a package that is gone from the settings takes its tools out of the list", () => {
  listPackages([]);
  assert.deepEqual(shownTools().map((t) => t.name), ["bash"]);
});

test("uninstalling forgets the tools, recorded with their package or not", () => {
  rememberTools([
    { name: "todo", source: "@juicesharp/rpiv-todo", package: TODO },
    { name: "todo_old", source: "@juicesharp/rpiv-todo" },
    { name: "other", source: "pi-other", package: "npm:pi-other" },
  ]);
  forgetPackageTools(`${TODO}@0.4.1`);
  // A tool recorded with its package is found by that source, one from before by the name it is filed under.
  assert.deepEqual(knownTools().map((t) => t.name).sort(), ["bash", "other", "todo"]);
  forgetPackageTools(TODO);
  assert.deepEqual(knownTools().map((t) => t.name).sort(), ["bash", "other"]);
});
