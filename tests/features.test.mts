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
  assert.deepEqual(understoryEntry("http://understory:3800/mcp", false), { url: "http://understory:3800/mcp", lifecycle: "lazy", directTools: true });
  assert.deepEqual(understoryEntry("http://u/mcp", true), {
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
  writeFileSync(path.join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: { understory: understoryEntry("http://u/mcp", false) } }));
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

    writeFileSync(path.join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: { understory: understoryEntry(`http://127.0.0.1:${port}/mcp`, true) } }));
    process.env.MEMORY_UNDERSTORY_AUTH_TOKEN = "s3cret";
    assert.deepEqual(await get("/tree"), { status: 200, body: { name: "/", path: "/", kind: "directory", children: [] } });
    assert.deepEqual(asked.at(-1), { url: "/api/tree", auth: "Bearer s3cret" });
    assert.equal((await get("/search?q=deploy%20script")).status, 200);
    assert.equal(asked.at(-1)!.url, "/api/search?q=deploy+script");
    assert.equal((await get("/search")).status, 400, "a search needs something to look for");
    assert.deepEqual(await get("/concept?path=/gone.md"), { status: 404, body: { error: "Concept not found: /gone.md" } });
    assert.equal((await get("/log")).status, 502, "what is not JSON is Understory failing");
    assert.equal((await fetch(`${at}/graph`)).status, 404, "nothing past the four reads");
    delete process.env.MEMORY_UNDERSTORY_AUTH_TOKEN;
    await get("/tree");
    assert.equal(asked.at(-1)!.auth, undefined);
  } finally {
    understory.close();
    portal.close();
  }
});
