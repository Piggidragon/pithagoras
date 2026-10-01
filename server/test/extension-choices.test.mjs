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
const noteOf = (list, value) => list.find((c) => c.value === value)?.notes;
const noted = (value) => noteOf(choices, value);

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

test("a package of the project's is off in a chat where all its tools are, as the user's are", () => {
  // A project's package brings its tools as no package of the user's: the project's entry is what says whose they are.
  const board = (extra = {}) => ({ ...seen, projectPackages: ["npm:pi-board@2.0.0"], userPackages: [], tools: [{ name: "board_add", package: null, projectPackage: "npm:pi-board@2.0.0" }, { name: "board_move", package: null, projectPackage: "npm:pi-board" }], ...extra });
  const has = (s) => installedExtensions(s).some((c) => c.value === "pi-board");
  assert.ok(has(board()), "on, while no tool of it is off");
  assert.ok(!has(board({ off: new Set(["board_add", "board_move"]) })), "the group of its tools is off for this chat");
  assert.ok(has(board({ off: new Set(["board_add"]) })), "one tool on is the package on");
  // The user's package that the project lists as well comes with the project's entry, and the same holds.
  assert.ok(!has(board({ userPackages: ["npm:pi-board"], off: new Set(["board_add", "board_move"]) })));
  // A tool remembered before the project's package was recorded says nothing, and the package stays on.
  assert.ok(has(board({ tools: [{ name: "board_add", package: null }, { name: "board_move", package: null }], off: new Set(["board_add", "board_move"]) })));
});

test("a loose extension that pi's settings switch off is not offered, and a path they add is", () => {
  const agent = path.join(home, "agent-loose");
  const proj = path.join(home, "ws", "loose-project");
  write(path.join(agent, "extensions", "old-todo.ts"));
  write(path.join(agent, "extensions", "scratch-a.ts"));
  write(path.join(agent, "extensions", "scratch-b.ts"));
  write(path.join(agent, "extensions", "legacy", "index.ts"));
  write(path.join(agent, "extensions", "kept", "index.ts"));
  write(path.join(agent, "extensions", "manifest-only", "package.json"), JSON.stringify({ name: "no-entry" }));
  write(path.join(agent, "extensions", "manifest-named", "main.ts"));
  write(path.join(agent, "extensions", "manifest-named", "package.json"), JSON.stringify({ pi: { extensions: ["main.ts"] } }));
  write(path.join(agent, "extensions", "screen-old-todo", "index.ts"), "// Written against: old-todo\n");
  write(path.join(proj, ".pi", "extensions", "mine.ts"));
  write(path.join(proj, ".pi", "extensions", "also.ts"));
  const elsewhere = path.join(home, "elsewhere");
  write(path.join(elsewhere, "my-ext", "index.ts"));
  write(path.join(elsewhere, "single.ts"));
  write(path.join(elsewhere, "folder-of", "one.ts"));
  write(path.join(elsewhere, "folder-of", "two.ts"));
  const choose = (user, projectSetting) =>
    installedExtensions({ agentDir: agent, userPackages: [], userExtensions: user, projectDir: proj, projectPackages: [], projectExtensions: projectSetting, tools: [], off: new Set() });
  const names = (user, projectSetting) => choose(user, projectSetting).map((c) => c.value);

  assert.deepEqual(names(undefined, undefined), ["also", "kept", "legacy", "manifest-named", "mine", "old-todo", "scratch-a", "scratch-b"], "all of them, as found; no folder that is not loaded for want of an entry");
  // What `pi config` writes for a switch: the path from pi's folder, with a minus.
  assert.ok(!names(["-extensions/old-todo.ts"]).includes("old-todo"));
  assert.ok(!names(["-extensions/legacy/index.ts"]).includes("legacy"), "a folder is switched by its entry");
  assert.ok(names(["+extensions/old-todo.ts"]).includes("old-todo"), "what pi config writes for one switched on again");
  assert.ok(!names(["+extensions/old-todo.ts", "-extensions/old-todo.ts"]).includes("old-todo"), "and a minus beats a plus");
  assert.ok(!names([`-${path.join(agent, "extensions", "old-todo.ts")}`]).includes("old-todo"), "or by the whole path");
  assert.ok(names(["-extensions/other.ts"]).includes("old-todo"), "another path is another file");
  // A `!` takes what its pattern matches, with `*`; a plus brings one back.
  assert.deepEqual(names(["!scratch-*.ts"]).filter((n) => n.startsWith("scratch")), []);
  assert.deepEqual(names(["!extensions/scratch-*", "+extensions/scratch-b.ts"]).filter((n) => n.startsWith("scratch")), ["scratch-b"]);
  assert.ok(!names(["!index.ts"]).includes("kept"), "a pattern is held against the file's name too, and a folder's file is index.ts");
  assert.ok(names(["!index.ts"]).includes("old-todo"));
  // A pattern that is more than pi's globs are here is not followed: nothing is taken off by a guess.
  assert.ok(names(["!extensions/{old-todo,legacy}*"]).includes("old-todo"));
  // The connection of an extension that is switched off is no connection that is there.
  assert.deepEqual(noteOf(choose(undefined, undefined), "old-todo"), ["screen"]);
  assert.deepEqual(noteOf(choose(["-extensions/screen-old-todo/index.ts"], undefined), "old-todo"), []);
  // The project's, with its own settings and its own `.pi` for a base.
  assert.ok(!names(undefined, ["-extensions/mine.ts"]).includes("mine"));
  assert.ok(names(["-extensions/mine.ts"], undefined).includes("mine"), "the user's setting is the user's");
  // A path the setting adds is loaded: a script, a folder with an entry, a folder of scripts; one that is not there is not.
  const added = names([path.join(elsewhere, "single.ts"), path.join(elsewhere, "my-ext"), path.join(elsewhere, "folder-of"), "../nowhere"]);
  assert.deepEqual(added.filter((n) => ["single", "my-ext", "one", "two", "nowhere"].includes(n)), ["my-ext", "one", "single", "two"]);
  assert.ok(!names([path.join(elsewhere, "single.ts"), `-${path.join(elsewhere, "single.ts")}`]).includes("single"), "and can be switched off like the rest");
  assert.ok(!names([path.join(elsewhere, "folder-of"), "!*one.ts"]).includes("one"), "a pattern narrows what the paths add");
  assert.deepEqual(names([path.join(elsewhere, "folder-of"), "*two.ts"]).filter((n) => ["one", "two"].includes(n)), ["two"], "and one that is plain is a filter on them");
  // Not lists: nothing is guessed from them.
  assert.equal(names("-extensions/old-todo.ts", { x: 1 }).includes("old-todo"), true);
});

// What pi does with the same settings was compared by running its own package manager over them; these are the cases it gave.
test("a package both settings list is decided by the project's entry alone, as in pi", () => {
  const chosen = (user, projectList, extra = {}) =>
    installedExtensions({ agentDir, userPackages: user, projectDir, projectPackages: projectList, tools: [], off: new Set(), ...extra });
  const has = (list, value) => list.some((c) => c.value === value);
  // The project switches the user's package off for itself: it is not loaded in the chat.
  assert.ok(has(chosen(["npm:pi-board"], []), "pi-board"));
  assert.ok(!has(chosen(["npm:pi-board"], [{ source: "npm:pi-board", extensions: [] }]), "pi-board"));
  assert.ok(!has(chosen(["npm:pi-board@1.0.0"], [{ source: "npm:pi-board@2.0.0", extensions: [] }]), "pi-board"), "the same package at another version");
  assert.ok(!has(chosen([], [{ source: "npm:pi-board", extensions: [] }]), "pi-board"));
  assert.ok(has(chosen(["npm:pi-board"], ["npm:pi-board"]), "pi-board"));
  // The other way round: the user's is off and the project's is on, which is the project's package.
  assert.deepEqual(noteOf(chosen([OFF("npm:pi-board")], ["npm:pi-board"]), "pi-board"), ["project"]);
  // One entry that changes the user's by file (autoload false) is not followed: the user's entry decides, and with no list it changes nothing.
  assert.ok(has(chosen(["npm:pi-board"], [{ source: "npm:pi-board", autoload: false, extensions: [] }]), "pi-board"));
  assert.ok(has(chosen(["npm:pi-board"], [{ source: "npm:pi-board", autoload: false, extensions: ["-extensions/board.ts"] }]), "pi-board"));
  assert.ok(!has(chosen([OFF("npm:pi-board")], [{ source: "npm:pi-board", autoload: false, extensions: [] }]), "pi-board"));
  // A folder is the package where it is: the same text in the two settings is two folders, and one is switched off apart from the other.
  write(path.join(projectDir, ".pi", "local-ext", "package.json"), JSON.stringify({ name: "project-local" }));
  const both = chosen(["./local-ext"], [{ source: "./local-ext", extensions: [] }]);
  assert.ok(has(both, "my-local"), "the user's folder");
  assert.ok(!has(both, "project-local"), "the project's, which it switched off");
  // Its tools are those of either entry.
  const tools = [{ name: "board_add", package: "npm:pi-board" }];
  assert.ok(!has(chosen([], ["npm:pi-board"], { tools, off: new Set(["board_add"]) }), "pi-board"));
  assert.ok(!has(chosen(["npm:pi-board"], [], { tools, off: new Set(["board_add"]) }), "pi-board"));
});

test("the project can switch off an extension of the user's, as pi config writes it for a project", () => {
  const agent = path.join(home, "agent-project-scope");
  const proj = path.join(home, "ws", "project-scope");
  for (const f of ["a.ts", "b.ts", "f/index.ts"]) write(path.join(agent, "extensions", f));
  write(path.join(proj, ".pi", "extensions", "p.ts"));
  const a = path.join(agent, "extensions", "a.ts");
  const names = (projectSetting, userSetting) =>
    installedExtensions({ agentDir: agent, userPackages: [], userExtensions: userSetting, projectDir: proj, projectPackages: [], projectExtensions: projectSetting, tools: [], off: new Set() }).map((c) => c.value);

  assert.deepEqual(names(undefined), ["a", "b", "f", "p"]);
  // The path, and a minus for it: what pi config writes in the project's settings for an inherited extension.
  assert.deepEqual(names([a, `-${a}`]), ["b", "f", "p"]);
  // The user's folder listed by the project, with a pattern that takes one of them off.
  assert.deepEqual(names([path.join(agent, "extensions"), "!b.ts"]), ["a", "f", "p"]);
  // A pattern of the project's alone is for what the project's setting adds and for its own folder, not for the user's.
  assert.deepEqual(names(["!a.ts"]), ["a", "b", "f", "p"]);
  assert.deepEqual(names(["!p.ts"]), ["a", "b", "f"]);
  // A file keeps the first state it is given, and the project's entries come before the user's.
  assert.deepEqual(names([a], ["!a.ts"]), ["a", "b", "f", "p"], "listed by the project, so on, whatever the user's pattern says");
  assert.deepEqual(names([a, `-${a}`], ["+extensions/a.ts"]), ["b", "f", "p"]);
  assert.deepEqual(names(undefined, ["-extensions/a.ts"]), ["b", "f", "p"], "and the user's own, as before");
  // The user's extension that the project brings back by name is the user's, and not marked as the project's.
  assert.deepEqual(installedExtensions({ agentDir: agent, userPackages: [], projectDir: proj, projectPackages: [], projectExtensions: [path.join(agent, "extensions")], tools: [], off: new Set() }).find((c) => c.value === "a").notes, []);
});

test("what the ignore files of the extensions folder leave out is not loaded by pi, and not offered", () => {
  const agent = path.join(home, "agent-ignore");
  for (const f of ["a.ts", "b.ts", "ext-c.ts", "keep.tmp.ts", "scratch.tmp.ts", "old/index.ts", "deep/index.ts"]) write(path.join(agent, "extensions", f));
  const names = (files) => {
    for (const [name, text] of Object.entries(files)) writeFileSync(path.join(agent, "extensions", name), text);
    return installedExtensions({ agentDir: agent, userPackages: [], tools: [], off: new Set() }).map((c) => c.value);
  };
  assert.deepEqual(names({ ".gitignore": "" }), ["a", "b", "deep", "ext-c", "keep.tmp", "old", "scratch.tmp"]);
  // A name, a pattern, a folder with a slash, a line taken back, a comment, and trailing spaces.
  assert.deepEqual(names({ ".gitignore": "# scratch\n*.tmp.ts\n!keep.tmp.ts\nb.ts   \nold/\n" }), ["a", "deep", "ext-c", "keep.tmp"]);
  // A name with a slash after it is for a folder only: no folder is called b.ts, so the script stays.
  assert.ok(names({ ".gitignore": "b.ts/\n" }).includes("b"));
  // The other two files count, in order, and the last line that matches decides.
  assert.deepEqual(names({ ".gitignore": "*.ts\n", ".ignore": "!a.ts\n", ".fdignore": "" }), ["a", "deep", "old"], "the folders are not .ts");
  assert.deepEqual(names({ ".gitignore": "*\n", ".ignore": "", ".fdignore": "!ext-c.ts\n" }), ["ext-c"]);
  // A line about what is deeper does not hide the folder, which pi loads by its entry.
  assert.ok(names({ ".gitignore": "deep/index.ts\n/old/index.ts\n", ".ignore": "", ".fdignore": "" }).includes("deep"));
});

test("a pattern's ** is a globstar only as a whole segment, and a wildcard does not take a dot", () => {
  const agent = path.join(home, "agent-dots", ".cfg", "agent");
  for (const f of ["a.ts", "ext-c.ts", "f/index.ts"]) write(path.join(agent, "extensions", f));
  const names = (...patterns) => installedExtensions({ agentDir: agent, userPackages: [], userExtensions: patterns, tools: [], off: new Set() }).map((c) => c.value);
  assert.deepEqual(names("!ext**"), ["a", "f"], "ext** is ext*, which does not cross a slash: it takes ext-c.ts by its name, not everything in extensions/");
  assert.deepEqual(names("!**ext-c.ts"), ["a", "f"], "against the name, whose ** is a *");
  assert.deepEqual(names("!**/ext-c.ts"), ["a", "f"]);
  assert.deepEqual(names("!extensions/**"), [], "a segment of its own is any number of them");
  assert.deepEqual(names("!**/index.ts"), ["a", "ext-c"]);
  assert.deepEqual(names("!extensions//a.ts"), ["ext-c", "f"], "a doubled slash is one");
  assert.deepEqual(names("!./extensions/a.ts"), ["a", "ext-c", "f"], "and a leading ./ is not dropped, for a ! pattern");
  // The whole path has a folder that starts with a dot, which a wildcard does not match and a pattern that names it does.
  assert.deepEqual(names(`!${path.dirname(path.dirname(agent))}/**/a.ts`), ["a", "ext-c", "f"], "** does not go through .cfg");
  assert.deepEqual(names(`!${path.dirname(path.dirname(agent))}/*/agent/extensions/a.ts`), ["a", "ext-c", "f"], "nor does a * take .cfg");
  assert.deepEqual(names(`!${path.dirname(path.dirname(agent))}/.c*/agent/extensions/a.ts`), ["ext-c", "f"], "unless the pattern starts it with a dot");
  assert.deepEqual(names(`!${path.dirname(path.dirname(agent))}/.cfg/**/a.ts`), ["ext-c", "f"]);
});
