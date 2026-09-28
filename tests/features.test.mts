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
