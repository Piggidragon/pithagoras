import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { freePort, serverEnv, startServer, testHome } from "./server-harness.mjs";

const home = testHome("agents-");
// The first agent is named from its SOUL.md, as the setup wizard writes it.
writeFileSync(path.join(home, "agent-home", "SOUL.md"), "Who you are.\n\n---\n\n# Nova\n\nWarm and direct.\n");
const { base } = await startServer(serverEnv(home, await freePort()));

const call = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};

test("the first agent is the Home there was, named by its SOUL.md", async () => {
  const { body } = await call("GET", "/api/agents");
  assert.equal(body.agents.length, 1);
  assert.equal(body.agents[0].id, "home");
  assert.equal(body.agents[0].name, "Nova");
  assert.equal(body.agents[0].home, path.join(home, "agent-home"));
  assert.equal(body.agents[0].first, true);
});

test("an agent has a home, files and chats of its own", async () => {
  const made = await call("POST", "/api/agents", { name: "Research Bot", setup: { userName: "Sam", vibe: "Curious." } });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  assert.equal(made.body.id, "research-bot");
  assert.equal(made.body.home, path.join(home, "agents", "research-bot"));
  assert.equal(made.body.initialised, true);
  assert.match(readFileSync(path.join(made.body.home, "SOUL.md"), "utf8"), /Research Bot/);
  assert.ok(!existsSync(path.join(home, "agent-home", "PrimaryUser.md")), "the first agent's files are untouched");

  const chat = await call("POST", "/api/sessions", { agent: "research-bot" });
  assert.equal(chat.body.workspace, made.body.home);
  const homeChat = await call("POST", "/api/sessions", {});
  assert.equal(homeChat.body.workspace, path.join(home, "agent-home"));

  const named = await call("POST", "/api/agent/sessions", { agent: "research-bot", title: "hi" });
  assert.equal(named.body.workspace, made.body.home);
  const chats = (await call("GET", "/api/sessions")).body.sessions;
  assert.ok(chats.some((s) => s.id === named.body.id), "a conversation started on the Agent page is listed with the chats");
  const listed = await call("GET", "/api/agent/sessions?agent=research-bot");
  assert.deepEqual(listed.body.sessions.map((s) => s.id), [named.body.id]);
  assert.equal((await call("GET", "/api/agent/sessions")).body.sessions.length, 0, "the first agent's list has none of its chats");

  const projects = await call("GET", "/api/projects?bare=1");
  assert.deepEqual(projects.body.agents.map((a) => a.name), ["Nova", "Research Bot"]);

  assert.equal((await call("POST", "/api/agents", { name: "Research Bot" })).body.id, "research-bot-2", "a taken name gets a folder of its own");
  assert.equal((await call("POST", "/api/agents", { name: "  " })).status, 400);
  assert.equal((await call("POST", "/api/sessions", { agent: "nobody" })).status, 404);
});

test("renaming keeps the folder", async () => {
  const renamed = await call("PATCH", "/api/agents/research-bot", { name: "Scout" });
  assert.equal(renamed.body.name, "Scout");
  assert.equal(renamed.body.home, path.join(home, "agents", "research-bot"));
});

test("the first agent is not deleted", async () => {
  assert.equal((await call("DELETE", "/api/agents/home")).status, 409);
  const { status } = await call("DELETE", "/api/agents/nobody");
  assert.equal(status, 404);
});

test("deleting an agent removes its chats, and its folder only when asked", async () => {
  const kept = await call("DELETE", "/api/agents/research-bot");
  assert.equal(kept.status, 200, JSON.stringify(kept.body));
  assert.equal(kept.body.sessionsDeleted, 2);
  assert.ok(existsSync(path.join(home, "agents", "research-bot", "SOUL.md")), "kept by default");
  assert.ok(!(await call("GET", "/api/agents")).body.agents.some((a) => a.id === "research-bot"));

  // Made again under the same name, it takes its folder up again.
  const back = await call("POST", "/api/agents", { name: "Research Bot" });
  assert.equal(back.body.id, "research-bot");
  assert.equal(back.body.initialised, true);

  const gone = await call("DELETE", "/api/agents/research-bot?folder=delete");
  assert.equal(gone.status, 200);
  assert.ok(!existsSync(path.join(home, "agents", "research-bot")));
  assert.ok(existsSync(path.join(home, "agent-home", "SOUL.md")));
});

test("each agent has an avatar of its own, and voice mode shows its chat's agent's", async () => {
  const ops = (await call("POST", "/api/agents", { name: "Ops" })).body;
  const before = (await call("GET", "/api/agents")).body.agents.find((a) => a.first).orb;
  const saved = await call("PUT", "/api/agents/ops/orb", { ...ops.orb, personality: "playful", hat: "crown" });
  assert.equal(saved.status, 200);
  const agents = (await call("GET", "/api/agents")).body.agents;
  assert.equal(agents.find((a) => a.id === "ops").orb.hat, "crown");
  assert.deepEqual(agents.find((a) => a.first).orb, before, "the first agent's avatar is untouched");

  const chat = (await call("POST", "/api/sessions", { agent: "ops" })).body;
  assert.equal((await call("GET", `/api/agent/orb?session=${chat.id}`)).body.hat, "crown");
  const homeChat = (await call("POST", "/api/sessions", {})).body;
  assert.deepEqual((await call("GET", `/api/agent/orb?session=${homeChat.id}`)).body, before);
  assert.equal((await call("PUT", "/api/agents/ops/orb", [])).status, 400);
});

test("an agent speaks with a voice of its own, or the one in the voice settings", async () => {
  await call("POST", "/api/agents", { name: "Herald" });
  assert.equal((await call("GET", "/api/agents")).body.agents.find((a) => a.id === "herald").voice, "");
  const designed = await call("PUT", "/api/agents/herald/voice", { voice: "design" });
  assert.equal(designed.status, 200);
  assert.equal(designed.body.voice, "design");
  assert.equal((await call("PUT", "/api/agents/herald/voice", { voice: "voice-missing" })).status, 400);
  assert.equal((await call("PUT", "/api/agents/herald/voice", { voice: "" })).body.voice, "");
  assert.equal((await call("PUT", "/api/agents/nobody/voice", { voice: "" })).status, 404);
});

test("the pictures of a deleted agent's chats stay with a kept folder, and go with a deleted one, its routine runs' too", async () => {
  const bot = (await call("POST", "/api/agents", { name: "Gallery Bot" })).body;
  const chat = (await call("POST", "/api/sessions", { agent: bot.id })).body;
  // A routine's run keeps its session when its agent is deleted, as a deleted agent's routines keep theirs.
  const db = new Database(path.join(home, "portal.db"));
  db.prepare("INSERT INTO sessions (id, title, workspace, executor, kind, routine_slug) VALUES ('run-1', 'A run', ?, 'host', 'routine', 'nightly')").run(bot.home);
  mkdirSync(path.join(bot.home, "generated-images"), { recursive: true });
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
  for (const [session, name, prompt] of [[chat.id, "image-20260102-120000-aaaaaa.png", "a lake"], ["run-1", "image-20260102-130000-bbbbbb.png", "a hill"]]) {
    writeFileSync(path.join(bot.home, "generated-images", name), png);
    db.prepare("INSERT INTO images (id, origin, session_id, path, kind, prompt, bytes, created_at) VALUES (?, 'chat', ?, ?, 'generated', ?, 72, ?)")
      .run(name.slice(-10, -4) + "000000", session, `generated-images/${name}`, prompt, Date.now());
  }
  db.close();
  const listed = async () => (await call("GET", "/api/images?limit=100")).body.pictures.filter((p) => ["a lake", "a hill"].includes(p.prompt));
  assert.deepEqual((await listed()).map((p) => p.prompt).sort(), ["a hill", "a lake"]);

  // Its folder kept: the pictures stay, as pictures of that folder with what they were asked for.
  assert.equal((await call("DELETE", `/api/agents/${bot.id}`)).status, 200);
  const kept = await listed();
  assert.deepEqual(kept.map((p) => [p.prompt, p.folder?.name ?? p.chat?.title]).sort(), [["a hill", "A run"], ["a lake", "gallery-bot"]]);
  // And the agent made again under the name has them, named after it.
  assert.equal((await call("POST", "/api/agents", { name: "Gallery Bot" })).body.id, bot.id);
  assert.deepEqual((await listed()).find((p) => p.prompt === "a lake").folder, { name: "Gallery Bot", home: false });

  // Its folder deleted: the files are gone, and so are all of them, the run's too.
  assert.equal((await call("DELETE", `/api/agents/${bot.id}?folder=delete`)).status, 200);
  assert.ok(!existsSync(bot.home));
  assert.deepEqual(await listed(), []);
});
