import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// pi itself, against an agent directory of its own.
const dir = mkdtempSync(path.join(tmpdir(), "pi-agent-"));
process.env.PI_CODING_AGENT_DIR = dir;
delete process.env.OPENROUTER_API_KEY;
const pi = await import("@earendil-works/pi-coding-agent");
const { SdkPiClient } = await import("../dist/pi/sdk-client.js");
const { modelRuntime } = await import("../dist/api/providers.js");
const providersOf = async (rt) => new Set((await rt.getAvailable()).map((m) => m.provider));

test("a key saved in Settings reaches the model menu of a chat already open", async () => {
  const chat = new SdkPiClient({}, await pi.ModelRuntime.create(), () => {});
  const menu = async () => new Set((await chat.getModels()).map((m) => m.provider));
  assert.equal((await menu()).has("openrouter"), false);
  writeFileSync(path.join(dir, "auth.json"), JSON.stringify({ openrouter: { type: "api_key", key: "sk-or-v1-test" } }));
  assert.equal((await menu()).has("openrouter"), true);
});

test("the models Settings offers include those an installed package brings", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "agent-home-"));
  assert.equal((await providersOf(await modelRuntime(home))).has("fake-gateway"), false);

  // Installed: pi's settings name it, as `pi install` would.
  mkdirSync(path.join(dir, "ext"), { recursive: true });
  writeFileSync(path.join(dir, "ext", "gateway.js"), `export default function (pi) {
    pi.registerProvider("fake-gateway", { baseUrl: "http://127.0.0.1:1/v1", apiKey: "x", api: "openai-completions",
      models: [{ id: "m1", name: "M1", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000, maxTokens: 100 }] });
  }`);
  // A moment on, so the settings file is seen to have changed.
  await new Promise((r) => setTimeout(r, 20));
  writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ extensions: [path.join(dir, "ext", "gateway.js")] }));
  const models = await (await modelRuntime(home)).getAvailable();
  assert.deepEqual(models.filter((m) => m.provider === "fake-gateway").map((m) => m.id), ["m1"]);
});
