import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "pi-agent-"));
process.env.PI_CODING_AGENT_DIR = dir;
const p = await import("../dist/providers.js");
const read = (name) => JSON.parse(readFileSync(path.join(dir, name), "utf8"));

test("a server's models are read from each server's own shape", () => {
  assert.deepEqual(p.parseModels({ data: [{ id: "a" }, { id: "a" }, { id: "b", name: "Bee" }] }), [{ id: "a" }, { id: "b", name: "Bee" }]);
  assert.deepEqual(
    p.parseModels({ data: [{ id: "x/y", name: "Y", context_length: 200000, architecture: { input_modalities: ["text", "image"] }, supported_parameters: ["tools", "reasoning"] }] }),
    [{ id: "x/y", name: "Y", contextWindow: 200000, input: ["text", "image"], reasoning: true }],
  );
  assert.deepEqual(p.parseModels({ data: [{ id: "q", meta: { n_ctx_train: 32768 } }] }), [{ id: "q", contextWindow: 32768 }]);
  assert.deepEqual(p.parseModels({ nope: true }), []);
});

test("an address is made into the base pi wants", () => {
  assert.equal(p.normalizeBaseUrl("localhost:8080", "llama-cpp"), "http://localhost:8080/v1");
  assert.equal(p.normalizeBaseUrl("http://h:11434/", "ollama"), "http://h:11434/v1");
  assert.equal(p.normalizeBaseUrl("https://gw.example/api/v1/models", "custom"), "https://gw.example/api/v1");
  assert.equal(p.normalizeBaseUrl("http://h:8000", "custom"), "http://h:8000");
});

test("a key is never shown, only told apart", () => {
  assert.equal(p.keyHint("sk-or-v1-abcdef123456"), "sk-o…3456");
  assert.equal(p.keyHint("$OPENROUTER_API_KEY"), "OPENROUTER_API_KEY");
  assert.equal(p.keyHint("!op read x"), "from a command");
});

test("saving a server keeps what was written by hand, and the file stays private", async () => {
  writeFileSync(path.join(dir, "models.json"), JSON.stringify({
    providers: {
      "llama-swap": { baseUrl: "http://gpu:8080/v1", api: "openai-completions", apiKey: "none", models: [
        { id: "Ornith", name: "Ornith", reasoning: true, thinkingLevelMap: { off: "off", medium: "medium" }, contextWindow: 327680 },
        { id: "Old" },
      ] },
      anthropic: { baseUrl: "https://proxy.example/v1" },
    },
    somethingElse: 1,
  }));
  await p.saveProvider("llama-swap", { kind: "llama-swap", baseUrl: "http://gpu:8080", models: [{ id: "Ornith", contextWindow: 65536, reasoning: true }, { id: "New", input: ["text", "image"] }] });
  const file = read("models.json");
  assert.equal(file.somethingElse, 1);
  assert.deepEqual(file.providers.anthropic, { baseUrl: "https://proxy.example/v1" });
  const swap = file.providers["llama-swap"];
  assert.equal(swap.baseUrl, "http://gpu:8080/v1");
  assert.equal(swap.apiKey, "none");
  assert.deepEqual(swap.models.map((m) => m.id), ["Ornith", "New"]);
  assert.deepEqual(swap.models[0].thinkingLevelMap, { off: "off", medium: "medium" });
  assert.equal(swap.models[0].contextWindow, 65536);
  assert.equal(swap.models[0].name, undefined, "a name the form cleared is gone");
  assert.equal(statSync(path.join(dir, "models.json")).mode & 0o777, 0o600);

  const listed = p.listProviders();
  assert.deepEqual(listed.map((x) => [x.id, x.kind, x.key.set]), [["llama-swap", "llama-swap", false]], "the address override is not a server of its own");
});

test("a hosted service's key goes to auth.json, and removing it takes it out", async () => {
  await p.saveProvider("openrouter", { kind: "openrouter", apiKey: "sk-or-v1-0123456789" });
  assert.deepEqual(read("auth.json").openrouter, { type: "api_key", key: "sk-or-v1-0123456789" });
  const listed = p.listProviders({ openrouter: "OpenRouter" }, { anthropic: "environment" });
  assert.deepEqual(listed.filter((x) => !x.endpoint).map((x) => [x.id, x.label, x.key.hint ?? x.key.source]), [
    ["openrouter", "OpenRouter", "sk-o…6789"], ["anthropic", "anthropic", "environment"],
  ]);
  await p.saveProvider("openrouter", { kind: "openrouter" });
  assert.equal(read("auth.json").openrouter.key, "sk-or-v1-0123456789", "no key sent keeps the one stored");
  assert.equal(await p.removeProvider("openrouter"), true);
  assert.equal(read("auth.json").openrouter, undefined);
  assert.equal(await p.removeProvider("openrouter"), false);
});

test("a bad name is refused before anything is written", async () => {
  await assert.rejects(p.saveProvider("../x", { kind: "custom", baseUrl: "http://h" }), /name/);
  await assert.rejects(p.saveProvider("x", { kind: "custom" }), /address/);
});

test("a llama-server is asked for its models, and for the window it really gives", async () => {
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/v1/models") return res.end(JSON.stringify({ data: [{ id: "qwen.gguf", meta: { n_ctx_train: 262144 } }] }));
    if (req.url === "/props") return res.end(JSON.stringify({ default_generation_settings: { n_ctx: 65536 }, modalities: { vision: true } }));
    res.statusCode = 404; res.end("{}");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  try {
    const found = await p.probeModels("llama-cpp", `127.0.0.1:${port}`);
    assert.equal(found.baseUrl, `http://127.0.0.1:${port}/v1`);
    assert.deepEqual(found.models, [{ id: "qwen.gguf", contextWindow: 65536, input: ["text", "image"] }]);
    // A custom address without /v1 is tried again with it.
    assert.equal((await p.probeModels("custom", `http://127.0.0.1:${port}`)).baseUrl, `http://127.0.0.1:${port}/v1`);
  } finally {
    server.close();
  }
  await assert.rejects(p.probeModels("llama-cpp", `http://127.0.0.1:${port}`), /Nothing answered/);
});

test("each server is asked whether it answers, and which chosen models it no longer lists", async () => {
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/v1/models") return res.end(JSON.stringify({ data: [{ id: "A" }, { id: "B" }] }));
    if (req.url === "/running") return res.end(JSON.stringify({ running: [{ model: "A", state: "ready" }, { model: "B", state: "starting" }] }));
    res.statusCode = 404; res.end("{}");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  try {
    writeFileSync(path.join(dir, "models.json"), JSON.stringify({ providers: {
      "llama-swap": { baseUrl: `http://127.0.0.1:${port}/v1`, api: "openai-completions", models: [{ id: "A" }, { id: "Old" }] },
      down: { baseUrl: "http://127.0.0.1:1/v1", models: [{ id: "x" }] },
      anthropic: { baseUrl: "https://proxy.example/v1" },
    } }));
    const status = await p.checkProviders();
    assert.deepEqual(Object.keys(status).sort(), ["down", "llama-swap"], "an override of a hosted service is not asked");
    const swap = status["llama-swap"];
    assert.equal(swap.state, "up");
    assert.equal(typeof swap.ms, "number");
    assert.deepEqual([swap.listed, swap.missing, swap.loaded], [2, ["Old"], ["A"]]);
    assert.equal(status.down.state, "down");
    assert.match(status.down.message, /Nothing answered/);
  } finally {
    server.close();
  }
});
