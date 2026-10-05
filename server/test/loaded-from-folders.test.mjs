import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inProcessHome, scratch } from "./server-harness.mjs";

// What pi, the MCP adapter, the heartbeat and the portal load out of a folder is said once, in
// pi/loaded-from-folders.ts. What a colleague or a guest may write is held to that list, and a
// test that walks it fails for a name that is on it and not held, wherever a conversation runs.

inProcessHome("loaded-folders-");
const { guardExtension } = await import("../dist/pi/guard.js");
const { LOADED_IN_FOLDERS, loadedAt, loadedPlaces } = await import("../dist/pi/loaded-from-folders.js");
const { addToolRule, deleteToolRule } = await import("../dist/db.js");
const { agentsRoot, createAgent, deleteAgent } = await import("../dist/agents.js");

mock.method(console, "warn", () => {});

const root = process.env.WORKSPACE_ROOT;
const folder = scratch("loaded-folders-");
const guardAs = (role, workspace) => {
  const h = {};
  guardExtension("t", () => ({ role, key: "priya" }), "s", true, () => ({ allowed: false, allowlist: [] }), workspace)({ on: (k, f) => (h[k] = f) });
  return h;
};
/** Whether a write by this guard is refused as one that reaches what is loaded; a write the rules allow is undefined. */
const outcome = (h, tool, where) => {
  const result = h.tool_call({ toolName: tool, input: { path: where, content: "x", edits: [] } });
  if (result === undefined) return "allowed";
  return result.block === true && /^Refused: it writes to /.test(result.reason) ? "refused" : `blocked: ${result.reason}`;
};
const refused = (h, tool, where) => outcome(h, tool, where) === "refused";
const allowed = (h, tool, where) => outcome(h, tool, where) === "allowed";

/** Where a write to this entry is aimed in a folder: the file itself, or a file somewhere inside the folder. */
const writtenIn = (dir, entry) => (entry.folder ? path.join(dir, entry.name, "deep", "x.ts") : path.join(dir, ...entry.name.split("/")));

const rules = ["write", "edit"].map((tool) => {
  const id = `rule-loaded-walk-${tool}`;
  addToolRule({ id, role: "all", tool, pattern: "*", note: "", person_key: null });
  return id;
});
test.after(() => rules.forEach(deleteToolRule));

// Every kind of folder a conversation of the primary user, or the next one of an agent, may read from.
mkdirSync(path.join(root, "site", "sub"), { recursive: true });
const nova = createAgent({ name: "Nova" }).home;
const gone = createAgent({ name: "Gone" });
deleteAgent(gone.id, { deleteFolder: false });
const kept = gone.home;
const notMade = path.join(agentsRoot(), "finance");
const conversation = path.join(folder, "conversation");
mkdirSync(conversation, { recursive: true });
const folders = {
  "the folder of the conversation": conversation,
  "another agent's home": nova,
  "the folder kept from an agent that is gone": kept,
  "the folder of an agent that is not made yet": notMade,
  "the top of a project": path.join(root, "site"),
  "a folder in a project": path.join(root, "site", "sub"),
};

test("every name on the list is held, in every folder a conversation or a look runs in, whoever else is speaking there", () => {
  assert.ok(LOADED_IN_FOLDERS.length >= 10);
  for (const role of ["colleague", "guest"]) {
    const as = guardAs(role, conversation);
    for (const entry of LOADED_IN_FOLDERS) {
      for (const [label, dir] of Object.entries(folders)) {
        for (const tool of ["write", "edit"]) {
          const where = writtenIn(dir, entry);
          assert.equal(refused(as, tool, where), true, `${role} ${tool} ${entry.name} in ${label}: ${where}`);
        }
      }
      // Told apart from case, and by a path that goes round.
      assert.equal(refused(as, "write", writtenIn(conversation, { ...entry, name: entry.name.toUpperCase() })), true, `${role} ${entry.name} in capitals`);
      assert.equal(refused(as, "write", `${conversation}/notes/../${path.relative(conversation, writtenIn(conversation, entry))}`), true, `${role} ${entry.name} by a path that goes round`);
    }
    // What is read from above the folder counts wherever it is; the rest only where a conversation runs.
    for (const entry of LOADED_IN_FOLDERS.filter((e) => e.above || e.folder)) assert.equal(refused(as, "write", writtenIn("/somewhere/else", entry)), true, `${role} ${entry.name} elsewhere`);
    // Without a folder to hold it to, by name in every folder.
    for (const entry of LOADED_IN_FOLDERS) assert.equal(refused(guardAs(role), "write", writtenIn("/anywhere", entry)), true, `${role} ${entry.name} with no folder`);
  }
  // The primary user's agent writes them, and so does an agent looking around for it.
  for (const role of ["primary", "heartbeat"]) for (const entry of LOADED_IN_FOLDERS) assert.equal(allowed(guardAs(role, conversation), "write", writtenIn(conversation, entry)), true, `${role} ${entry.name}`);
});

test("what the rule is for goes through: notes, the shared file, and names that only look like these", () => {
  for (const role of ["colleague", "guest"]) {
    const as = guardAs(role, conversation);
    for (const [label, dir] of Object.entries(folders)) {
      for (const name of ["notes/new.md", "TEAM.md", "mcp.json", ".mcp.json.bak", "agent-notes.md", ".vscode/settings.json", "docs/agents-guide.md", "docs/opencode-notes.json", ".pitch/x.ts", ".agent-names"]) {
        assert.equal(allowed(as, "write", path.join(dir, name)), true, `${role} ${name} in ${label}`);
      }
    }
    // A note called like one of the agent's files, in a folder no conversation runs in.
    assert.equal(allowed(as, "write", path.join(nova, "notes", "memory.md")), true);
    assert.equal(allowed(as, "write", path.join(nova, "notes", ".mcp.json")), true);
  }
});

test("a link at a name on the list is followed to what it leads to, for a file that is not there yet, in a conversation's folder, an agent's, and the top of a project", () => {
  let n = 0;
  const places = {
    "the folder of the conversation": () => path.join(folder, `link-${n++}`),
    "another agent's home": () => nova,
    "the folder kept from an agent that is gone": () => kept,
    "the folder of an agent that is not made yet": () => path.join(agentsRoot(), `later-${n++}`),
    "the top of a project": () => path.join(root, `project-${n++}`),
    "the workspace root": () => root,
  };
  // The name is a link to something that is not there yet; what is written there is loaded under the name.
  const linked = [];
  for (const [label, pick] of Object.entries(places)) {
    for (const entry of LOADED_IN_FOLDERS) {
      const dir = pick();
      const target = path.join(folder, "behind", `${n++}`, entry.folder ? "dir" : "file");
      const at = path.join(dir, ...entry.name.split("/"));
      mkdirSync(path.dirname(at), { recursive: true });
      rmSync(at, { force: true }); // a file an agent's folder has already, such as the name it was made for
      symlinkSync(target, at);
      linked.push({ label, entry, runsIn: label === "the folder of the conversation" ? dir : conversation, written: entry.folder ? path.join(target, "extensions", "x.ts") : target, beside: path.join(path.dirname(target), "other.md") });
    }
  }
  for (const role of ["colleague", "guest"]) {
    for (const { label, entry, runsIn, written, beside } of linked) {
      const as = guardAs(role, runsIn);
      assert.equal(refused(as, "write", written), true, `${role}: ${entry.name} as a link in ${label}, written as ${written}`);
      assert.equal(refused(as, "edit", written), true, `${role}: ${entry.name} as a link in ${label}, edited as ${written}`);
      // And a file beside it, which no link leads to, is a note.
      assert.equal(allowed(as, "write", beside), true, `${role}: beside it in ${label}`);
    }
  }
});

test("the folders and files the portal hands pi or loads itself are held where they are, by whatever path they are reached", () => {
  const places = loadedPlaces();
  assert.ok(places.length >= 8, "pi's agent folder, what ships with the portal, the channel packages, the MCP adapter's configs in the home");
  for (const role of ["colleague", "guest"]) {
    const as = guardAs(role, conversation);
    for (const place of places) {
      assert.equal(refused(as, "write", path.join(place.path, "x.ts")), true, `${role}: below ${place.path}`);
      assert.equal(refused(as, "write", place.path), true, `${role}: ${place.path}`);
    }
  }
  const named = (as) => places.filter((place) => place.as === as).length;
  assert.ok(named("code") >= 1 && named("tools") >= 1 && named("instructions") >= 2, "each kind of place is there");
  // The channel packages are code the portal runs: a write into the folder they are installed in.
  const installed = path.join(process.env.CHANNELS_DIR, "node_modules", "pithagoras-channel-x", "index.js");
  assert.equal(refused(guardAs("colleague", conversation), "write", installed), true);
});

test("loadedAt answers by the name and for the folder it would be read from", () => {
  assert.equal(loadedAt("/w/site/.mcp.json")?.by, "mcp");
  assert.equal(loadedAt("/w/site/.VSCODE/MCP.json")?.by, "mcp");
  assert.equal(loadedAt("/w/site/AGENTS.md")?.by, "pi");
  assert.equal(loadedAt("/w/site/.pi/x/y")?.by, "pi");
  assert.equal(loadedAt("/w/site/notes.md"), undefined);
  assert.equal(loadedAt("/w/site/mcp.json"), undefined, "a name that is only part of one");
  assert.equal(loadedAt("/w/site/SOUL.md", (dir) => dir === "/w/site")?.by, "portal");
  assert.equal(loadedAt("/w/site/notes/SOUL.md", (dir) => dir === "/w/site"), undefined, "not read from a folder nothing runs in");
  assert.equal(loadedAt("/w/site/notes/AGENTS.md", () => false)?.by, "pi", "pi reads it from above as well");
});

// --- the list against what pi loads, and against the page that tells the primary user ---

const pi = path.dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
const piSource = (file) => readFileSync(path.join(pi, file), "utf8");

test("what pi's resource loader reads by name is on the list, and what is on the list as pi's is read", async () => {
  const { CONFIG_DIR_NAME, loadProjectContextFiles } = await import("@earendil-works/pi-coding-agent");
  assert.ok(LOADED_IN_FOLDERS.some((e) => e.folder && e.name.toLowerCase() === CONFIG_DIR_NAME.toLowerCase()), `pi's folder for its own config is ${CONFIG_DIR_NAME}`);

  // The names pi reads a folder's instructions from, as its loader spells them.
  const candidates = /const candidates = \[([^\]]+)\]/.exec(piSource("core/resource-loader.js"))?.[1];
  assert.ok(candidates, "pi's loader still lists the names it reads (core/resource-loader.js): add what it reads now to loaded-from-folders.ts and teach this test");
  const names = [...candidates.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(names.length >= 2);
  for (const name of names) {
    assert.ok(loadedAt(path.join("/w/site", name)), `pi reads ${name}, so it is on the list`);
  }
  // And what is on the list for pi is read: written into a folder, pi's own loader finds it.
  for (const entry of LOADED_IN_FOLDERS.filter((e) => e.by === "pi" && !e.folder)) {
    const dir = scratch("loaded-pi-");
    writeFileSync(path.join(dir, entry.name), "instructions");
    const found = loadProjectContextFiles({ cwd: dir, agentDir: scratch("loaded-pi-agent-") }).map((f) => path.basename(f.path));
    assert.ok(found.includes(entry.name), `pi reads ${entry.name} from the folder it runs in`);
  }

  // What pi treats as its project config, each a name inside its folder.
  const trusted = /TRUST_REQUIRING_PROJECT_CONFIG_RESOURCES = \[([^\]]+)\]/.exec(piSource("core/trust-manager.js"))?.[1];
  assert.ok(trusted, "pi still lists what a project's config folder holds (core/trust-manager.js)");
  for (const [, name] of trusted.matchAll(/"([^"]+)"/g)) {
    assert.ok(loadedAt(path.join("/w/site", CONFIG_DIR_NAME, name, "x")), `pi reads ${CONFIG_DIR_NAME}/${name}`);
  }
  assert.match(piSource("core/package-manager.js"), /join\(dir, "\.agents", "skills"\)/, "pi still reads skills from .agents, which is on the list as a folder");
});

test("the page on roles names everything on the list", () => {
  const docs = (file) => readFileSync(fileURLToPath(new URL(`../../docs/${file}`, import.meta.url)), "utf8").replace(/\s+/g, " ");
  const roles = docs("people/roles.md");
  for (const entry of LOADED_IN_FOLDERS) assert.ok(roles.includes(`\`${entry.name}\``), `docs/people/roles.md names ${entry.name}`);
  for (const word of ["pi's own agent folder", "the folders that come with the portal", "channel packages", "tool servers"]) assert.ok(roles.includes(word), `docs/people/roles.md says ${word}`);
});
