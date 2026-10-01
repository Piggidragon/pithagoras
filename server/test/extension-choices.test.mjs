import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { installedExtensions } from "../dist/extension-choices.js";

/**
 * The extensions a command can be given as its argument (`/screen <extension>`):
 * the ones that are on in the chat, found as Settings → Extensions and the
 * chat's tools menu find them, and none of the portal's own.
 */
const home = mkdtempSync(path.join(tmpdir(), "pithagoras-extension-choices-"));
const agentDir = path.join(home, "agent");
const projectDir = path.join(home, "ws", "research");
const OFF = (source) => ({ source, extensions: [], skills: [], prompts: [], themes: [] });
const file = (...parts) => {
  const p = path.join(...parts);
  mkdirSync(path.dirname(p), { recursive: true });
  return p;
};
const write = (p, text = "export default () => {};\n") => writeFileSync(file(p), text);

// The user's own, loose in pi's folder: a folder, a script, and the agent's connections to screens.
write(path.join(agentDir, "extensions", "todo", "index.ts"));
write(path.join(agentDir, "extensions", "lone.ts"));
write(path.join(agentDir, "extensions", "screen-rpiv-todo", "index.ts"), "/**\n * Written against: @juicesharp/rpiv-todo 2.12.0\n */\n");
write(path.join(agentDir, "extensions", "screen-lone", "index.ts"), "// no line that says what it is for\n");
write(path.join(agentDir, "extensions", ".hidden", "index.ts"));
write(path.join(agentDir, "extensions", "notes.md"), "not an extension");
// A package of a folder of its own, relative to pi's folder, and the one the portal ships.
write(path.join(agentDir, "local-ext", "package.json"), JSON.stringify({ name: "my-local" }));
write(path.join(agentDir, "bundled-sub", "package.json"), JSON.stringify({ name: "pithagoras-subagent" }));
const shipped = path.join(home, "image", "extensions", "subagent");
write(path.join(shipped, "package.json"), JSON.stringify({ name: "elsewhere" }));
// What the chat's project brings: a package, and a loose extension with a connection of its own.
write(path.join(projectDir, ".pi", "extensions", "mine.ts"));
write(path.join(projectDir, ".pi", "extensions", "screen-mine", "index.ts"), "// Written against: mine\n");

const seen = {
  agentDir,
  userPackages: [
    "npm:@juicesharp/rpiv-todo@2.12.0",
    "npm:pi-lens",
    OFF("npm:switched-off"),
    { source: "npm:@scope/narrowed", extensions: [], skills: ["skills"] },
    { source: "npm:@scope/filtered", extensions: ["!legacy.ts"] },
    "git:github.com/user/repo@v1",
    "./local-ext",
    "npm:pi-quiet",
    "npm:pi-half",
    "./bundled-sub",
    shipped,
  ],
  projectDir,
  projectPackages: ["npm:project-only", { source: "npm:switched-off", extensions: ["index.ts"] }, "npm:pi-lens"],
  tools: [
    { name: "todo", package: "npm:@juicesharp/rpiv-todo@2.12.0" },
    { name: "quiet_a", package: "npm:pi-quiet" },
    { name: "quiet_b", package: "npm:pi-quiet@3.0.0" },
    { name: "half_a", package: "npm:pi-half" },
    { name: "half_b", package: "npm:pi-half" },
    { name: "mcp_thing", package: null },
  ],
  off: new Set(["quiet_a", "quiet_b", "half_b"]),
  bundled: shipped,
};
const choices = installedExtensions(seen);
const values = choices.map((c) => c.value);
const noted = (value) => choices.find((c) => c.value === value)?.notes;

test("the packages that are on, and the loose extensions, are offered by the names a person uses", () => {
  assert.deepEqual(values, [
    "@juicesharp/rpiv-todo", "@scope/filtered", "github.com/user/repo", "lone", "mine", "my-local", "pi-half", "pi-lens", "project-only", "switched-off", "todo",
  ]);
  const todo = choices.find((c) => c.value === "@juicesharp/rpiv-todo");
  assert.equal(todo.detail, "npm:@juicesharp/rpiv-todo@2.12.0", "and where each comes from");
  assert.equal(choices.find((c) => c.value === "my-local").detail, path.join(agentDir, "local-ext"));
});

test("what is switched off, or loads no extension, is not offered", () => {
  assert.ok(!values.includes("pi-quiet"), "every tool of it is off in this chat: its group is switched off");
  assert.ok(values.includes("pi-half"), "one tool on is a package on");
  assert.ok(!values.includes("@scope/narrowed"), "narrowed to none of its extensions: it brings skills, no extension");
  assert.ok(values.includes("@scope/filtered"), "narrowed by hand to some is still on");
  // The user's switch is what the user's settings say; a project that lists it and loads it has it.
  assert.ok(values.includes("switched-off"));
  assert.ok(!installedExtensions({ ...seen, projectPackages: [] }).some((c) => c.value === "switched-off"));
  assert.ok(!installedExtensions({ ...seen, userPackages: [OFF("npm:pi-lens")], projectPackages: [] }).some((c) => c.value === "pi-lens"), "off for the user and not in the project");
});

test("the portal's own, and the agent's connections to screens, are not extensions to connect", () => {
  assert.ok(!values.some((v) => /subagent|bundled-sub|^screen-/.test(v)), values.join());
  assert.ok(!values.includes("pithagoras-subagent"));
  assert.equal(values.length, new Set(values).size);
});

test("those that already have a screen are marked, by the folder's name or by what it says it was written against", () => {
  assert.deepEqual(noted("@juicesharp/rpiv-todo"), ["screen"], "screen-rpiv-todo, and the line names it");
  assert.deepEqual(noted("lone"), ["screen"], "named for it");
  assert.deepEqual(noted("mine"), ["screen", "project"]);
  assert.deepEqual(noted("todo"), [], "rpiv-todo's connection is not the todo extension's");
  assert.deepEqual(noted("pi-lens"), []);
});

test("the chat's project is said where it brings the extension and the user does not", () => {
  assert.deepEqual(noted("project-only"), ["project"]);
  assert.deepEqual(noted("switched-off"), ["project"]);
  assert.deepEqual(noted("pi-lens"), [], "the user has it as well");
  assert.deepEqual(noted("lone"), ["screen"]);
});

test("a chat outside any project, and settings that are not a list, offer what there is", () => {
  const plain = installedExtensions({ ...seen, projectDir: undefined, projectPackages: undefined });
  assert.ok(!plain.some((c) => c.value === "project-only" || c.value === "mine"));
  assert.ok(plain.some((c) => c.value === "lone"));
  assert.deepEqual(installedExtensions({ agentDir: path.join(home, "nowhere"), userPackages: "npm:x", tools: [], off: new Set() }), []);
});
