import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const temp = mkdtempSync(path.join(tmpdir(), "pitha-features-"));
process.env.DATA_DIR = temp;
process.env.SESSION_DIR = path.join(temp, "sessions");
const agentDir = path.join(temp, "agent");
mkdirSync(agentDir);
process.env.PI_CODING_AGENT_DIR = agentDir;
delete process.env.MEMORY_UNDERSTORY_URL;

const {
  SUBAGENT_PACKAGE,
  UNDERSTORY_RULE,
  bundledSubagentDir,
  findSubagent,
  subagentModeOf,
  subagentLimitOf,
  understoryDefaultUrl,
  understoryEntry,
  understoryIn,
  understoryOn,
  understoryTokenOf,
} = await import("../server/src/features.ts");
const { extraContextFiles } = await import("../server/src/pi/sdk-client.ts");

test("the subagent tool ships with the portal, as a pi package", () => {
  const dir = bundledSubagentDir();
  assert.ok(dir, "found from source");
  assert.equal(path.basename(dir!), "subagent");
});

test("the subagent tool is found in pi's packages by its folder, or by its name from anywhere else", () => {
  const bundled = "/app/extensions/subagent";
  const names: Record<string, string> = { "/src/clone/extensions/subagent": SUBAGENT_PACKAGE, "/x/other": "something-else" };
  const nameOf = (dir: string) => names[dir];
  assert.equal(findSubagent(["npm:pi-mcp-adapter", "/x/other"], "/home/.pi/agent", bundled, nameOf), undefined);
  assert.deepEqual(findSubagent(["npm:x", bundled], "/home/.pi/agent", bundled, nameOf), { source: bundled, enabled: true });
  // Relative to the settings file's folder, as pi reads it.
  assert.deepEqual(findSubagent(["../../../app/extensions/subagent"], "/home/.pi/agent", bundled, nameOf), {
    source: "../../../app/extensions/subagent",
    enabled: true,
  });
  assert.deepEqual(findSubagent(["/src/clone/extensions/subagent"], "/home/.pi/agent", bundled, nameOf)?.source, "/src/clone/extensions/subagent");
  // Switched off in Extensions: there, and off.
  const off = { source: bundled, extensions: [], skills: [], prompts: [], themes: [] };
  assert.deepEqual(findSubagent([off], "/home/.pi/agent", bundled, nameOf), { source: bundled, enabled: false });
});

test("a subagent interrupts unless pi's settings say background", () => {
  assert.equal(subagentModeOf({}), "interrupt");
  assert.equal(subagentModeOf({ subagentMode: "sideways" }), "interrupt");
  assert.equal(subagentModeOf({ subagentMode: "background" }), "background");
});

test("one subagent at a time unless pi's settings allow more, as the tool reads it", () => {
  assert.equal(subagentLimitOf({}), 1);
  assert.equal(subagentLimitOf({ subagentMaxParallel: 4 }), 4);
  assert.equal(subagentLimitOf({ subagentMaxParallel: 2.5 }), 1);
  assert.equal(subagentLimitOf({ subagentMaxParallel: 40 }), 16);
});

test("Understory's entry puts its tools in front of the agent, and names its token rather than holding it", () => {
  assert.equal(understoryDefaultUrl(), "http://localhost:3800/mcp");
  assert.deepEqual(understoryEntry("http://understory:3800/mcp"), { url: "http://understory:3800/mcp", lifecycle: "lazy", directTools: true });
  assert.deepEqual(understoryEntry("http://u/mcp", { tokenEnv: "MEMORY_UNDERSTORY_AUTH_TOKEN" }), {
    url: "http://u/mcp",
    lifecycle: "lazy",
    directTools: true,
    auth: "bearer",
    bearerTokenEnv: "MEMORY_UNDERSTORY_AUTH_TOKEN",
  });
  assert.equal(understoryIn({ mcpServers: {} }), false);
  assert.equal(understoryIn({ mcpServers: { understory: { url: "x" } } }), true);
  assert.equal(understoryIn({ mcpServers: { understory: { url: "x", disabled: true } } }), false, "switched off in MCP is off");
});

test("while Understory is the memory, MEMORY.md is not read; switched off, it is again", () => {
  const home = mkdtempSync(path.join(tmpdir(), "pitha-home-"));
  for (const f of ["SOUL.md", "PrimaryUser.md", "MEMORY.md"]) writeFileSync(path.join(home, f), `# ${f}\n`);
  const names = (role?: string) => extraContextFiles(home, role).map((f) => path.basename(f.path));

  assert.deepEqual(names(), ["SOUL.md", "PrimaryUser.md", "MEMORY.md"]);
  writeFileSync(path.join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: { understory: understoryEntry("http://u/mcp") } }));
  assert.equal(understoryOn(), true);
  assert.deepEqual(names(), ["SOUL.md", "PrimaryUser.md"]);
  assert.deepEqual(names("primary"), ["SOUL.md", "PrimaryUser.md"]);
  assert.match(UNDERSTORY_RULE, /understory_memory_query/);

  writeFileSync(path.join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: { understory: { url: "http://u/mcp", disabled: true } } }));
  assert.deepEqual(names(), ["SOUL.md", "PrimaryUser.md", "MEMORY.md"]);
  // A file that cannot be read says nothing about Understory: the file memory stays.
  writeFileSync(path.join(agentDir, "mcp.json"), "{ nope");
  assert.equal(understoryOn(), false);
});

test("the memory is read through the portal: only Understory's read API, with its token, and only while it is on", async () => {
  const { createServer } = await import("node:http");
  const express = (await import("express")).default;
  const { memoryRouter } = await import("../server/src/api/memory.ts");
  const asked: { url: string; auth?: string }[] = [];
  const understory = createServer((req, res) => {
    asked.push({ url: req.url!, auth: req.headers.authorization });
    res.setHeader("content-type", "application/json");
    if (req.url!.startsWith("/api/concept?path=%2Fgone.md")) return res.writeHead(404).end(JSON.stringify({ error: "Concept not found: /gone.md" }));
    if (req.url === "/api/log") return res.writeHead(500).end("<html>broken</html>");
    res.end(JSON.stringify(req.url === "/api/tree" ? { name: "/", path: "/", kind: "directory", children: [] } : [{ path: "/a.md" }]));
  });
  await new Promise<void>((r) => understory.listen(0, "127.0.0.1", r));
  const port = (understory.address() as { port: number }).port;
  const app = express().use("/api", memoryRouter());
  const portal = app.listen(0, "127.0.0.1");
  await new Promise((r) => portal.once("listening", r));
  const at = `http://127.0.0.1:${(portal.address() as { port: number }).port}/api/memory`;
  const get = async (p: string) => {
    const r = await fetch(`${at}${p}`);
    return { status: r.status, body: await r.json() };
  };
  try {
    writeFileSync(path.join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: {} }));
    assert.equal((await get("/tree")).status, 409, "not while it is off");

    writeFileSync(path.join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: { understory: understoryEntry(`http://127.0.0.1:${port}/mcp`, { tokenEnv: "MEMORY_UNDERSTORY_AUTH_TOKEN" }) } }));
    process.env.MEMORY_UNDERSTORY_AUTH_TOKEN = "s3cret";
    assert.deepEqual(await get("/tree"), { status: 200, body: { name: "/", path: "/", kind: "directory", children: [] } });
    assert.deepEqual(asked.at(-1), { url: "/api/tree", auth: "Bearer s3cret" });
    assert.equal((await get("/search?q=deploy%20script")).status, 200);
    assert.equal(asked.at(-1)!.url, "/api/search?q=deploy+script");
    assert.equal((await get("/search")).status, 400, "a search needs something to look for");
    assert.deepEqual(await get("/concept?path=/gone.md"), { status: 404, body: { error: "Concept not found: /gone.md" } });
    assert.equal((await get("/log")).status, 502, "what is not JSON is Understory failing");
    assert.equal((await get("/graph")).status, 200);
    assert.equal(asked.at(-1)!.url, "/api/graph");
    assert.equal((await fetch(`${at}/chat`)).status, 404, "nothing past the reads: its chat writes");
    delete process.env.MEMORY_UNDERSTORY_AUTH_TOKEN;
    await get("/tree");
    assert.equal(asked.at(-1)!.auth, undefined);
  } finally {
    understory.close();
    portal.close();
  }
});

test("the Understory the portal runs: its model from a provider or an address of its own, its tidying up, a token of its own", async () => {
  const service = await import("../server/src/extensions/understory-service.ts");
  assert.equal(service.intervalMs("6h"), 6 * 3_600_000);
  assert.equal(service.intervalMs("sometimes"), null);
  assert.equal(service.validInterval(""), true, "never is an interval too");
  assert.equal(service.validInterval("30m"), true);
  assert.equal(service.validInterval("2m"), false, "Understory's floor is five minutes");

  writeFileSync(
    path.join(agentDir, "models.json"),
    JSON.stringify({ providers: { "llama-swap": { baseUrl: "http://gpu:8080/v1", api: "openai-completions", models: [{ id: "Ornith" }] }, claude: { baseUrl: "https://api.anthropic.com", api: "anthropic-messages", apiKey: "CLAUDE_KEY", models: [{ id: "sonnet" }] } } }),
  );
  process.env.CLAUDE_KEY = "sk-from-env";
  assert.deepEqual(service.llmEnv({ source: "provider", provider: "llama-swap", model: "Ornith" }), { baseUrl: "http://gpu:8080/v1", apiKey: "none", model: "Ornith", format: "openai" });
  assert.deepEqual(service.llmEnv({ source: "provider", provider: "claude", model: "sonnet" }), { baseUrl: "https://api.anthropic.com", apiKey: "sk-from-env", model: "sonnet", format: "anthropic" });
  assert.throws(() => service.llmEnv({ source: "provider", provider: "gone", model: "x" }), /no provider "gone"/);

  const token = service.token();
  assert.equal(service.token(), token, "made once");
  const env = service.spec({ llm: { source: "provider", provider: "llama-swap", model: "Ornith" }, dreamInterval: "6h" }, token).Env;
  for (const line of ["BUNDLE_ROOT=/bundle", `AUTH_TOKEN=${token}`, "LLM_API_BASE_URL=http://gpu:8080/v1", "LLM_MODEL=Ornith", "DREAM_INTERVAL=6h"]) assert.ok(env.includes(line), line);
  assert.ok(!service.spec({ llm: { source: "provider", provider: "llama-swap", model: "Ornith" }, dreamInterval: "" }, token).Env.some((l) => l.startsWith("DREAM_INTERVAL")), "never is no interval at all");
  assert.throws(() => service.spec({ llm: null, dreamInterval: "" }, token), /Choose the model/);

  // A key the page never holds is kept when it sends none.
  service.saveConfig({ llm: { source: "custom", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", format: "openai", apiKey: "sk-1" }, dreamInterval: "1d" });
  service.saveConfig({ llm: { source: "custom", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-reasoner", format: "openai" }, dreamInterval: "1d" });
  assert.deepEqual(service.config(), { llm: { source: "custom", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-reasoner", format: "openai", apiKey: "sk-1" }, dreamInterval: "1d", dreamAt: "" });
  service.saveConfig({ llm: { source: "custom", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-reasoner", format: "openai", apiKey: "" }, dreamInterval: "" });
  assert.equal((service.config().llm as { apiKey?: string }).apiKey, "", "an empty one clears it");
});

test("the portal's own Understory is written with its token; one run elsewhere names it from the environment", () => {
  assert.deepEqual(understoryEntry("http://127.0.0.1:3800/mcp", { token: "t0k" }), { url: "http://127.0.0.1:3800/mcp", lifecycle: "lazy", directTools: true, auth: "bearer", bearerToken: "t0k" });
  assert.equal(understoryTokenOf({ bearerToken: "t0k" }), "t0k");
  process.env.SOME_TOKEN = "from-env";
  assert.equal(understoryTokenOf({ bearerTokenEnv: "SOME_TOKEN" }), "from-env");
  assert.equal(understoryTokenOf({ url: "x" }), undefined);
});

test("tidying up at a set time: the next time it comes round, Understory's own timer off, the report read from what the pass printed", async () => {
  const service = await import("../server/src/extensions/understory-service.ts");
  assert.equal(service.validTime("03:00"), true);
  assert.equal(service.validTime(""), true);
  assert.equal(service.validTime("3am"), false);
  assert.equal(service.validTime("24:00"), false);

  const evening = new Date(2026, 8, 28, 22, 15);
  assert.deepEqual(service.nextAt("03:00", evening), new Date(2026, 8, 29, 3, 0));
  const night = new Date(2026, 8, 29, 2, 0);
  assert.deepEqual(service.nextAt("03:00", night), new Date(2026, 8, 29, 3, 0), "later the same night");
  assert.deepEqual(service.nextAt("03:00", new Date(2026, 8, 29, 3, 0)), new Date(2026, 8, 30, 3, 0), "not twice in the same minute");

  const llm = { source: "custom" as const, baseUrl: "http://gpu:8080/v1", model: "m", format: "openai" as const };
  assert.ok(!service.spec({ llm, dreamInterval: "6h", dreamAt: "03:00" }, "t").Env.some((l) => l.startsWith("DREAM_INTERVAL")), "a set time wins");
  service.saveConfig({ llm, dreamInterval: "6h", dreamAt: "03:00" });
  assert.deepEqual([service.config().dreamInterval, service.config().dreamAt], ["", "03:00"]);
  assert.ok(service.nextDreamAt(), "scheduled once saved");
  service.saveConfig({ llm, dreamInterval: "", dreamAt: "" });
  assert.equal(service.nextDreamAt(), undefined, "and no longer once it is not");

  assert.deepEqual(service.readReport('\u001b[0mloading\r\n{"ran":false,"reason":"memory healthy"}\r\n'), { ran: false, reason: "memory healthy" });
  assert.deepEqual(service.readReport('{"ran":true,"summary":"merged two","filesChanged":["/a.md"]}\nbye'), { ran: true, summary: "merged two", filesChanged: ["/a.md"] });
  assert.equal(service.readReport("Error: boom"), null);
});
