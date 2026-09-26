import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// pi's catalogue, against an agent directory of its own, with an installed
// extension that takes its time loading — as a package can after an install.
const dir = mkdtempSync(path.join(tmpdir(), "pi-agent-levels-"));
process.env.PI_CODING_AGENT_DIR = dir;
const map = (on) => Object.fromEntries(["off", "minimal", "low", "medium", "high", "xhigh", "max"].map((l) => [l, on.includes(l) ? l : null]));
writeFileSync(path.join(dir, "models.json"), JSON.stringify({
  providers: {
    "test-server": {
      baseUrl: "http://127.0.0.1:1/v1", api: "openai-completions", apiKey: "none",
      models: [{ id: "switch", name: "Switch", reasoning: true, thinkingLevelMap: map(["off", "medium"]), input: ["text"], contextWindow: 1000, maxTokens: 100 }],
    },
  },
}));
mkdirSync(path.join(dir, "ext"), { recursive: true });
writeFileSync(path.join(dir, "ext", "slow.js"), `await new Promise((r) => setTimeout(r, 1500));
export default function () {}`);
writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ extensions: [path.join(dir, "ext", "slow.js")] }));

const { modelLevels } = await import("../dist/api/providers.js");
const home = mkdtempSync(path.join(tmpdir(), "agent-home-"));
process.env.AGENT_HOME = home;

test("a chat's levels do not wait for pi's catalogue to be built", async () => {
  // Opening an idle chat asks for them. Waiting for the build — every
  // extension's code, loaded — held the answer up to 1.5s after each start
  // or install, where the page has what it last saw to draw meanwhile.
  const started = Date.now();
  assert.deepEqual(await modelLevels("test-server", "switch"), []);
  assert.ok(Date.now() - started < 1000, `answered after ${Date.now() - started}ms`);

  // The build was started, and the next chat opened has them.
  let levels = [];
  for (let i = 0; i < 60 && !levels.length; i++) {
    await new Promise((r) => setTimeout(r, 100));
    levels = await modelLevels("test-server", "switch");
  }
  assert.deepEqual(levels, ["off", "medium"]);
});
