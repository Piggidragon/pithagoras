import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { freePort, serverEnv, startServer, testHome } from "./server-harness.mjs";

/**
 * What a command's argument may be, against the whole server: the extensions
 * that are on in a chat, as the chat's own switches leave them.
 */
const home = testHome("pithagoras-arguments-api-");
const agent = path.join(home, "agent");
const ws = path.join(home, "ws");
mkdirSync(path.join(ws, "research", ".pi"), { recursive: true });
mkdirSync(path.join(agent, "extensions", "todo"), { recursive: true });
writeFileSync(path.join(agent, "extensions", "todo", "index.ts"), "export default () => {};\n");
mkdirSync(path.join(agent, "extensions", "screen-todo"), { recursive: true });
writeFileSync(path.join(agent, "extensions", "screen-todo", "index.ts"), "// Written against: todo\n");
const OFF = (source) => ({ source, extensions: [], skills: [], prompts: [], themes: [] });
writeFileSync(path.join(agent, "settings.json"), JSON.stringify({ packages: ["npm:pi-board@1.0.0", "npm:pi-search", OFF("npm:pi-lens")] }));
writeFileSync(path.join(ws, "research", ".pi", "settings.json"), JSON.stringify({ packages: ["npm:pi-research-only"] }));

// A project that switches off for itself a package and an extension of the user's.
mkdirSync(path.join(ws, "office", ".pi"), { recursive: true });
const todoFile = path.join(agent, "extensions", "todo", "index.ts");
writeFileSync(path.join(ws, "office", ".pi", "settings.json"), JSON.stringify({ packages: [{ source: "npm:pi-search", extensions: [] }], extensions: [todoFile, `-${todoFile}`] }));

// The server's database, to say which tools were seen and where from.
process.env.DATA_DIR = home;
const db = await import("../dist/db.js");
db.rememberTools([
  { name: "board_add", source: "pi-board", package: "npm:pi-board@1.0.0" },
  { name: "board_move", source: "pi-board", package: "npm:pi-board@1.0.0" },
  { name: "web_search", source: "pi-search", package: "npm:pi-search" },
  // The project's own package brings its tools as no package of the user's: its entry in the project's settings says whose they are.
  { name: "research_ask", source: "pi-research-only", projectPackage: "npm:pi-research-only" },
  { name: "research_cite", source: "pi-research-only", projectPackage: "npm:pi-research-only" },
]);

let base;
before(async () => {
  ({ base } = await startServer(serverEnv(home, await freePort())));
});

const send = (url, method = "GET", body) =>
  fetch(base + url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (url, method, body) => {
  const res = await send(url, method, body);
  assert.ok(res.ok, `${url}: ${res.status} ${await res.clone().text()}`);
  return res.json();
};
const names = async (id) => (await json(`/api/sessions/${id}/arguments/extensions`)).choices.map((c) => c.value);

test("a chat is offered the extensions that are on, with the one that has a screen marked", async () => {
  const chat = await json("/api/sessions", "POST", {});
  const { choices } = await json(`/api/sessions/${chat.id}/arguments/extensions`);
  assert.deepEqual(choices.map((c) => c.value), ["pi-board", "pi-search", "todo"], "not the one that is switched off, not the project's, not the connection");
  assert.deepEqual(choices.map((c) => c.notes), [[], [], ["screen"]]);
  assert.equal(choices[0].detail, "npm:pi-board@1.0.0");
});

test("a chat in a project is offered what the project brings, and a chat that switched a package's tools off is not offered it", async () => {
  const inside = await json("/api/sessions", "POST", { workspace: "research" });
  assert.deepEqual(await names(inside.id), ["pi-board", "pi-research-only", "pi-search", "todo"]);
  // Its group in the chat's tools menu, switched off for this chat alone.
  await json(`/api/sessions/${inside.id}/tools`, "PUT", { off: ["board_add", "board_move"] });
  assert.deepEqual(await names(inside.id), ["pi-research-only", "pi-search", "todo"]);
  // One tool on again is the package on.
  await json(`/api/sessions/${inside.id}/tools`, "PUT", { off: ["board_add"] });
  assert.ok((await names(inside.id)).includes("pi-board"));
  // The project's own package is a group in the menu as well, and goes the same way.
  await json(`/api/sessions/${inside.id}/tools`, "PUT", { off: ["research_ask", "research_cite"] });
  assert.deepEqual(await names(inside.id), ["pi-board", "pi-search", "todo"]);
  await json(`/api/sessions/${inside.id}/tools`, "PUT", { off: ["research_cite"] });
  assert.ok((await names(inside.id)).includes("pi-research-only"));
  await json(`/api/sessions/${inside.id}/tools`, "PUT", { off: ["board_add"] });
  // Another chat, outside the project, never had it off.
  const other = await json("/api/sessions", "POST", {});
  assert.deepEqual(await names(other.id), ["pi-board", "pi-search", "todo"]);
});

test("a package switched off in the portal's settings is not offered, and is when it is switched on", async () => {
  const chat = await json("/api/sessions", "POST", {});
  assert.ok(!(await names(chat.id)).includes("pi-lens"));
  writeFileSync(path.join(agent, "settings.json"), JSON.stringify({ packages: ["npm:pi-board@1.0.0", "npm:pi-search", "npm:pi-lens"] }));
  assert.ok((await names(chat.id)).includes("pi-lens"));
});

test("a source there is none of, and a chat that is not there, have nothing to offer", async () => {
  const chat = await json("/api/sessions", "POST", {});
  assert.equal((await send(`/api/sessions/${chat.id}/arguments/nope`)).status, 404);
  assert.equal((await send(`/api/sessions/${chat.id}/arguments/constructor`)).status, 404);
  assert.equal((await send(`/api/sessions/missing/arguments/extensions`)).status, 404);
});

test("a loose extension that pi's own settings switch off is not offered", async () => {
  const chat = await json("/api/sessions", "POST", {});
  const settings = { packages: ["npm:pi-board@1.0.0", "npm:pi-search", "npm:pi-lens"] };
  assert.ok((await names(chat.id)).includes("todo"));
  // What `pi config` writes for a script or folder of pi's folder turned off.
  writeFileSync(path.join(agent, "settings.json"), JSON.stringify({ ...settings, extensions: ["-extensions/todo/index.ts"] }));
  assert.ok(!(await names(chat.id)).includes("todo"));
  writeFileSync(path.join(agent, "settings.json"), JSON.stringify(settings));
  assert.ok((await names(chat.id)).includes("todo"));
});

test("a project that switches off the user's package, or the user's extension, for itself has it off in its chats", async () => {
  const inside = await json("/api/sessions", "POST", { workspace: "office" });
  const inList = await names(inside.id);
  assert.ok(inList.includes("pi-board"));
  assert.ok(!inList.includes("pi-search") && !inList.includes("todo"), "the user's, and this project has them off");
  const outList = await names((await json("/api/sessions", "POST", {})).id);
  assert.ok(outList.includes("pi-search") && outList.includes("todo"));
});
