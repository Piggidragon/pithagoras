import { test, before } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { freePort, serverEnv, startServer, testHome } from "./server-harness.mjs";

/**
 * The tools of a project, against the whole server: what the page reads and
 * writes at /api/projects/:name/tools, and what a chat in the project then
 * sees from /api/sessions/:id/tools.
 */
const home = testHome("pithagoras-project-tools-api-");
const ws = path.join(home, "ws");
mkdirSync(path.join(ws, "research"), { recursive: true });
mkdirSync(path.join(ws, "dev"), { recursive: true });

// The server's database, to say which tools were seen where no route does.
process.env.DATA_DIR = home;
const db = await import("../dist/db.js");
db.rememberTools([
  { name: "web_search", source: "pi-web-access", description: "Search the web" },
  { name: "web_fetch", source: "pi-web-access" },
  { name: "todo", source: "pi-todo" },
]);

let base;
before(async () => {
  ({ base } = await startServer(serverEnv(home, await freePort())));
});

const send = (url, method, body) =>
  fetch(base + url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (url, method = "GET", body) => {
  const res = await send(url, method, body);
  assert.ok(res.ok, `${url}: ${res.status} ${await res.clone().text()}`);
  return res.json();
};
const states = (r) => Object.fromEntries(r.tools.map((t) => [t.name, t.enabled]));

test("a project with nothing said lists every tool as the portal-wide default has it", async () => {
  await json("/api/tools", "PUT", { off: ["web_fetch"] });
  const r = await json("/api/projects/research/tools");
  assert.deepEqual(states(r), { todo: true, web_fetch: false, web_search: true });
  assert.deepEqual(r.off, ["web_fetch"]);
  assert.equal(r.live, false);
  // `defaultOn` is the portal-wide default, which is what the project disagrees with.
  assert.equal(r.tools.find((t) => t.name === "web_fetch").defaultOn, false);
  assert.equal(r.tools.find((t) => t.name === "web_search").description, "Search the web");
});

test("what a project switches is its own, and the chats in it start with it", async () => {
  const saved = await json("/api/projects/research/tools", "PUT", { off: ["web_fetch", "web_search"] });
  assert.deepEqual(saved.off, ["web_fetch", "web_search"]);
  // The difference from the default is what is kept, not the whole picture.
  assert.deepEqual(db.projectTools("research"), { off: ["web_search"], on: [] });

  const r = await json("/api/projects/research/tools");
  assert.deepEqual(states(r), { todo: true, web_fetch: false, web_search: false });

  const inside = await json("/api/sessions", "POST", { workspace: "research" });
  const mine = await json(`/api/sessions/${inside.id}/tools`);
  assert.deepEqual(states(mine), { todo: true, web_fetch: false, web_search: false });
  assert.deepEqual(mine.off, ["web_fetch", "web_search"]);

  // Another project and Home have what they had.
  const other = await json("/api/sessions", "POST", { workspace: "dev" });
  assert.deepEqual(states(await json(`/api/sessions/${other.id}/tools`)), { todo: true, web_fetch: false, web_search: true });
  const homeChat = await json("/api/sessions", "POST", {});
  assert.deepEqual(states(await json(`/api/sessions/${homeChat.id}/tools`)), { todo: true, web_fetch: false, web_search: true });

  // One chat in the project may disagree with it, either way.
  await json(`/api/sessions/${inside.id}/tools`, "PUT", { off: ["todo", "web_fetch", "web_search"] });
  assert.deepEqual(db.sessionTools(inside.id), { off: ["todo"], on: [] });
  await json(`/api/sessions/${inside.id}/tools`, "PUT", { off: [] });
  assert.deepEqual(db.sessionTools(inside.id), { off: [], on: ["web_fetch", "web_search"] });
});

test("the list says which projects have settings of their own", async () => {
  const { projects } = await json("/api/projects");
  assert.deepEqual(Object.fromEntries(projects.map((p) => [p.name, p.hasTools])), { dev: false, research: true });
  // Everything back as the default has it: nothing left to say.
  await json("/api/projects/research/tools", "PUT", { off: ["web_fetch"] });
  const after = await json("/api/projects");
  assert.equal(after.projects.find((p) => p.name === "research").hasTools, false);
});

test("a project that is not there, or not a project name, has no tools", async () => {
  assert.equal((await send("/api/projects/nope/tools", "GET")).status, 404);
  assert.equal((await send("/api/projects/nope/tools", "PUT", { off: [] })).status, 404);
  assert.equal((await send("/api/projects/.hidden/tools", "GET")).status, 400);
  assert.equal((await send("/api/projects/research/tools", "PUT", { off: "web_search" })).status, 400);
  assert.equal((await send("/api/projects/research/tools", "PUT", { off: [1] })).status, 400);
  assert.equal((await send("/api/projects/research/tools", "PUT", {})).status, 400);
  assert.ok(!existsSync(path.join(ws, "nope")));
});

test("deleting a project, or making one of the same name, leaves no settings behind", async () => {
  await json("/api/projects/dev/tools", "PUT", { off: ["todo", "web_fetch"] });
  assert.ok(db.projectsWithTools().has("dev"));
  await json("/api/projects/dev", "DELETE");
  assert.ok(!db.projectsWithTools().has("dev"));

  // A folder removed outside the portal leaves its row; a project made again under the name does not inherit it.
  db.setProjectTools("ghost", { off: ["todo"], on: [] });
  await json("/api/projects", "POST", { name: "ghost" });
  assert.ok(!db.projectsWithTools().has("ghost"));
  assert.deepEqual(states(await json("/api/projects/ghost/tools")), { todo: true, web_fetch: false, web_search: true });
});

test("a project made with tools starts with them, and nothing an older folder of its name left", async () => {
  await json("/api/tools", "PUT", { off: ["web_fetch"] });
  db.setProjectTools("fresh", { off: ["todo"], on: ["web_fetch"] });
  // The page's whole picture, as for the PUT: the portal-wide default's off tool stays in it.
  const made = await json("/api/projects", "POST", { name: "fresh", toolsOff: ["web_fetch", "web_search"] });
  assert.equal(made.toolsError, undefined);
  assert.deepEqual(db.projectTools("fresh"), { off: ["web_search"], on: [] });
  assert.deepEqual(states(await json("/api/projects/fresh/tools")), { todo: true, web_fetch: false, web_search: false });

  const chat = await json("/api/sessions", "POST", { workspace: "fresh" });
  assert.deepEqual(states(await json(`/api/sessions/${chat.id}/tools`)), { todo: true, web_fetch: false, web_search: false });
});

test("a project made with tools that match the default stores nothing, and one made without them has none", async () => {
  await json("/api/projects", "POST", { name: "same", toolsOff: ["web_fetch"] });
  assert.ok(!db.projectsWithTools().has("same"));
  await json("/api/projects", "POST", { name: "plain" });
  assert.ok(!db.projectsWithTools().has("plain"));
});

test("tools that cannot be a list are refused before any folder is made", async () => {
  for (const toolsOff of ["web_search", [1], {}, null]) {
    const res = await send("/api/projects", "POST", { name: "never", toolsOff });
    assert.equal(res.status, 400, JSON.stringify(toolsOff));
  }
  assert.ok(!existsSync(path.join(ws, "never")));
  assert.ok(!db.projectsWithTools().has("never"));
});

test("a project whose tools could not be saved is made, and says so", async () => {
  // The portal's table for them is gone, as when its database cannot be written to.
  db.getDb().exec("DROP TABLE project_tools");
  const res = await json("/api/projects", "POST", { name: "halfway", toolsOff: ["web_search"] });
  assert.equal(res.name, "halfway");
  assert.match(res.toolsError, /project_tools/);
  assert.ok(existsSync(path.join(ws, "halfway")));
  assert.ok((await json("/api/projects?bare=1")).projects.some((p) => p.name === "halfway"));
});
