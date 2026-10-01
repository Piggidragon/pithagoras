import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const temp = mkdtempSync(path.join(tmpdir(), "pitha-images-"));
process.env.DATA_DIR = temp;
process.env.SESSION_DIR = path.join(temp, "sessions");
process.env.PI_CODING_AGENT_DIR = path.join(temp, "agent");
process.env.AGENT_HOME = path.join(temp, "agent-home");

const gen = await import("../server/src/image-generation.ts");
const { GenerateImageTool, GENERATED_DIR, takenByAnother } = await import("../server/src/pi/generate-image-tool.ts");

// The first bytes of each kind a browser draws, padded: that is all the check reads.
const pad = (head: number[], to = 64) => Buffer.concat([Buffer.from(head), Buffer.alloc(to)]);
const PNG = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = pad([0xff, 0xd8, 0xff, 0xe0]);
const GIF = pad([...Buffer.from("GIF89a")]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([1, 0, 0, 0]), Buffer.from("WEBPVP8 "), Buffer.alloc(32)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

const KEY = "sk-test-0123456789";

interface Seen { method?: string; url?: string; auth?: string; body?: any }
/** A fake image endpoint: `handler` answers, and every request it gets is kept. */
async function fake(handler: (req: IncomingMessage, res: ServerResponse, seen: Seen) => void): Promise<{ origin: string; seen: Seen[]; server: Server }> {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: any;
      try { body = raw ? JSON.parse(raw) : undefined; } catch { body = raw; }
      const one: Seen = { method: req.method, url: req.url, auth: req.headers.authorization, body };
      seen.push(one);
      handler(req, res, one);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { origin: `http://127.0.0.1:${(server.address() as { port: number }).port}`, seen, server };
}
const json = (res: ServerResponse, body: unknown, status = 200) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
const b64 = (bytes: Buffer) => bytes.toString("base64");
const config = (baseUrl: string, more: Partial<ReturnType<typeof gen.imageGenerationConfig>> = {}) => ({ enabled: true, baseUrl, model: "image-model", size: "", apiKey: KEY, ...more });

test("a request is checked: the address is a base with no secret in it, the size a real one", () => {
  const parse = gen.parseImageGenerationPatch;
  assert.deepEqual(parse({ baseUrl: " https://images.example.com/v1/ ", model: " m ", size: "1024x1024", apiKey: " k ", enabled: true }), {
    baseUrl: "https://images.example.com/v1", model: "m", size: "1024x1024", apiKey: "k", enabled: true,
  });
  assert.deepEqual(parse({ baseUrl: "", size: "" }), { baseUrl: "", size: "" }, "emptied is the way back to nothing");
  for (const bad of ["ftp://x/v1", "not a url", "https://user:pass@host/v1", "https://host/v1?api_key=abc", "https://host/v1#x"]) {
    assert.equal(typeof parse({ baseUrl: bad }), "string", bad);
  }
  assert.equal(typeof parse({ size: "huge" }), "string");
  assert.equal(typeof parse({ enabled: "yes" }), "string");
  assert.equal(typeof parse({ model: 5 }), "string");
});

test("the route is added to the address unless it is there", () => {
  assert.equal(gen.endpointUrl("https://h.example/v1").href, "https://h.example/v1/images/generations");
  assert.equal(gen.endpointUrl("https://h.example/v1/").href, "https://h.example/v1/images/generations");
  assert.equal(gen.endpointUrl("https://h.example/v1/images/generations").href, "https://h.example/v1/images/generations");
  assert.equal(gen.endpointUrl("http://localhost:8080").href, "http://localhost:8080/images/generations");
});

test("it is off until switched on with an address, and the key is kept but never shown", () => {
  assert.equal(gen.imageGenerationReady(), false);
  assert.deepEqual(gen.imageGenerationState(), { enabled: false, baseUrl: "", model: "", size: "", keySet: false });
  assert.throws(() => gen.saveImageGeneration({ enabled: true }), /address/, "no address to ask: not on");
  assert.equal(gen.imageGenerationReady(), false);

  gen.saveImageGeneration({ baseUrl: "https://images.example.com/v1", model: "m", apiKey: KEY });
  assert.equal(gen.imageGenerationReady(), false, "an address alone does not switch it on");
  gen.saveImageGeneration({ enabled: true });
  assert.equal(gen.imageGenerationReady(), true);
  const state = gen.imageGenerationState();
  assert.equal(state.keySet, true);
  assert.ok(!("apiKey" in state));
  assert.ok(!JSON.stringify(state).includes(KEY), "nothing the page is given holds the key");

  // Kept while the address stays the server's; taken away with another server's.
  gen.saveImageGeneration({ model: "other" });
  assert.equal(gen.imageGenerationConfig().apiKey, KEY);
  gen.saveImageGeneration({ baseUrl: "https://images.example.com/v2" });
  assert.equal(gen.imageGenerationConfig().apiKey, KEY, "the same host");
  gen.saveImageGeneration({ baseUrl: "https://elsewhere.example.org/v1" });
  assert.equal(gen.imageGenerationConfig().apiKey, "", "a key is one server's: another is not given it");
  gen.saveImageGeneration({ baseUrl: "https://images.example.com/v1", apiKey: "k2" });
  assert.equal(gen.imageGenerationConfig().apiKey, "k2");
  gen.saveImageGeneration({ apiKey: "" });
  assert.equal(gen.imageGenerationState().keySet, false);
  assert.throws(() => gen.saveImageGeneration({ baseUrl: "" }), /address/, "not while it is on");
  gen.saveImageGeneration({ enabled: false });
  assert.equal(gen.imageGenerationReady(), false);
});

test("a picture comes back as base64 and is asked for with the model, the prompt and the key", async () => {
  const { origin, seen, server } = await fake((_req, res) => json(res, { data: [{ b64_json: b64(PNG) }] }));
  try {
    const got = await gen.generateImage(config(`${origin}/v1`, { size: "512x512" }), { prompt: "a red square" });
    assert.equal(got.ext, "png");
    assert.deepEqual(got.bytes, PNG);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].method, "POST");
    assert.equal(seen[0].url, "/v1/images/generations");
    assert.equal(seen[0].auth, `Bearer ${KEY}`);
    assert.deepEqual(seen[0].body, { model: "image-model", prompt: "a red square", n: 1, size: "512x512" });

    // What the agent asks for wins over the default; no model and no key send neither.
    await gen.generateImage(config(origin, { model: "", apiKey: "" }), { prompt: "p", size: "1024x768" });
    assert.deepEqual(seen[1].body, { prompt: "p", n: 1, size: "1024x768" });
    assert.equal(seen[1].auth, undefined);
  } finally {
    server.close();
  }
});

test("only a PNG, JPEG, GIF or WebP counts, by its bytes, whatever it is called", async () => {
  let next = PNG;
  const { origin, server } = await fake((_req, res) => json(res, { data: [{ b64_json: b64(next) }] }));
  try {
    for (const [bytes, ext] of [[PNG, "png"], [JPEG, "jpg"], [GIF, "gif"], [WEBP, "webp"]] as const) {
      next = bytes;
      assert.equal((await gen.generateImage(config(origin), { prompt: "p" })).ext, ext);
    }
    for (const bad of [SVG, Buffer.from("<html><script>alert(1)</script></html>"), Buffer.from("not a picture at all"), Buffer.alloc(0)]) {
      next = bad;
      await assert.rejects(gen.generateImage(config(origin), { prompt: "p" }), /not (base64|a PNG, JPEG, GIF or WebP picture)|no picture in it/);
    }
  } finally {
    server.close();
  }
});

test("a picture sent as a data URL is read, one that is not base64 is refused", async () => {
  let answer: unknown = { data: [{ url: `data:image/png;base64,${b64(PNG)}` }] };
  const { origin, server } = await fake((_req, res) => json(res, answer));
  try {
    assert.equal((await gen.generateImage(config(origin), { prompt: "p" })).ext, "png");
    answer = { data: [{ b64_json: "!!! not base64 !!!" }] };
    await assert.rejects(gen.generateImage(config(origin), { prompt: "p" }), /not base64/);
    for (const empty of [{ data: [] }, { data: [{}] }, {}, { data: "x" }]) {
      answer = empty;
      await assert.rejects(gen.generateImage(config(origin), { prompt: "p" }), /no picture in it/);
    }
  } finally {
    server.close();
  }
});

test("a picture sent as an address is fetched from the endpoint's own host, with the key", async () => {
  const { origin, seen, server } = await fake((req, res) => {
    if (req.url === "/files/a.png") return res.writeHead(200, { "content-type": "application/octet-stream" }).end(JPEG);
    json(res, { data: [{ url: `${origin}/files/a.png` }] });
  });
  try {
    const got = await gen.generateImage(config(`${origin}/v1`), { prompt: "p" });
    assert.equal(got.ext, "jpg", "by its bytes, not the type it was served as");
    assert.equal(seen.at(-1)!.url, "/files/a.png");
    assert.equal(seen.at(-1)!.auth, `Bearer ${KEY}`, "the host the key was given for may have it back");
  } finally {
    server.close();
  }
});

test("an address on another host on this machine or its network is not fetched", async () => {
  const inner = await fake((_req, res) => res.writeHead(200).end(PNG));
  const { origin, server } = await fake((_req, res) => json(res, { data: [{ url: `${inner.origin}/secret.png` }] }));
  try {
    // Another port is another origin: a service of this machine the endpoint has no business pointing at.
    await assert.rejects(gen.generateImage(config(origin), { prompt: "p" }), /another host than the endpoint, and is only fetched from there over https/);
    assert.equal(inner.seen.length, 0, "nothing was asked of it");
  } finally {
    server.close();
    inner.server.close();
  }
});

test("a host given by name that leads to this machine is refused where the connection is made", async () => {
  // https, so the address itself passes; the name is only found out to be this machine's when it is looked up.
  const inner = await fake((_req, res) => res.writeHead(200).end(PNG));
  const { origin, server } = await fake((_req, res) => json(res, { data: [{ url: `https://localhost:${new URL(inner.origin).port}/secret.png` }] }));
  try {
    await assert.rejects(gen.generateImage(config(origin), { prompt: "p" }), /localhost, which is not on the public internet/);
    assert.equal(inner.seen.length, 0);
  } finally {
    server.close();
    inner.server.close();
  }
});

test("where an address may lead: its own origin, or the public internet over https", () => {
  const endpoint = new URL("http://gpu-box:8000/v1/images/generations");
  const refusal = (address: string) => gen.pictureUrlRefusal(new URL(address), endpoint);
  assert.equal(refusal("http://gpu-box:8000/out/1.png"), undefined, "the endpoint's own");
  assert.equal(refusal("https://cdn.example.com/1.png?sig=abc"), undefined, "a host by name: checked where it is connected to");
  assert.equal(refusal("https://93.184.216.34/1.png"), undefined, "a public address");
  assert.match(refusal("http://cdn.example.com/1.png")!, /over https/);
  assert.match(refusal("http://gpu-box:9000/1.png")!, /another host/);
  assert.match(refusal("https://169.254.169.254/latest/meta-data")!, /not on the public internet/);
  assert.match(refusal("https://127.0.0.1/1.png")!, /not on the public internet/);
  assert.match(refusal("https://10.0.0.5/1.png")!, /not on the public internet/);
  assert.match(refusal("https://[::1]/1.png")!, /not on the public internet/);
  assert.match(refusal("https://[::ffff:192.168.1.1]/1.png")!, /not on the public internet/);
  assert.match(refusal("https://2130706433/1.png")!, /not on the public internet/, "an address written as one number is still 127.0.0.1");
  assert.match(refusal("ftp://cdn.example.com/1.png")!, /not http or https/);
  assert.match(refusal("https://user:pw@cdn.example.com/1.png")!, /login/);
  assert.match(gen.pictureUrlRefusal(new URL("file:///etc/passwd"), endpoint)!, /not http or https/);
});

test("the key goes to the endpoint's own origin only, a picture's host elsewhere never has it", () => {
  const endpoint = new URL("https://images.example.com/v1/images/generations");
  assert.deepEqual(gen.downloadHeaders(new URL("https://images.example.com/files/1.png"), endpoint, KEY), { accept: "image/*", authorization: `Bearer ${KEY}` });
  assert.deepEqual(gen.downloadHeaders(new URL("https://cdn.example.net/1.png?sig=abc"), endpoint, KEY), { accept: "image/*" });
  assert.deepEqual(gen.downloadHeaders(new URL("https://images.example.com:8443/1.png"), endpoint, KEY), { accept: "image/*" }, "another port is another server");
  assert.deepEqual(gen.downloadHeaders(new URL("https://images.example.com/1.png"), endpoint, ""), { accept: "image/*" });
});

test("which addresses are public", () => {
  for (const address of ["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) assert.equal(gen.isPublicAddress(address), true, address);
  for (const address of [
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255",
    "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "64:ff9b::a00:1", "nope", "",
  ]) assert.equal(gen.isPublicAddress(address), false, address);
  assert.equal(gen.isPublicAddress("172.32.0.1"), true, "just past 172.16/12");
});

test("a redirect on the way to a picture is judged like the address itself", async () => {
  const inner = await fake((_req, res) => res.writeHead(200).end(PNG));
  let target = "/files/hop";
  const own = await fake((req, res) => {
    if (req.url === "/files/own.png") return res.writeHead(200).end(GIF);
    if (req.url === "/files/hop") return res.writeHead(302, { location: "/files/own.png" }).end();
    if (req.url === "/files/leave") return res.writeHead(302, { location: `${inner.origin}/secret.png` }).end();
    if (req.url === "/files/loop") return res.writeHead(302, { location: "/files/loop" }).end();
    json(res, { data: [{ url: `${own.origin}${target}` }] });
  });
  try {
    assert.equal((await gen.generateImage(config(own.origin), { prompt: "p" })).ext, "gif", "within its own host: followed");
    target = "/files/leave";
    await assert.rejects(gen.generateImage(config(own.origin), { prompt: "p" }), /another host/);
    assert.equal(inner.seen.length, 0, "the other place was never asked");
    target = "/files/loop";
    await assert.rejects(gen.generateImage(config(own.origin), { prompt: "p" }), /redirects too often/);
  } finally {
    own.server.close();
    inner.server.close();
  }
});

test("the endpoint itself is never followed elsewhere: the key stays with it", async () => {
  const inner = await fake((_req, res) => json(res, { data: [{ b64_json: b64(PNG) }] }));
  const { origin, server } = await fake((_req, res) => res.writeHead(307, { location: `${inner.origin}/v1/images/generations` }).end());
  try {
    await assert.rejects(gen.generateImage(config(origin), { prompt: "p" }), /Could not reach the image endpoint/);
    assert.equal(inner.seen.length, 0, "no request, and so no key, went there");
  } finally {
    server.close();
    inner.server.close();
  }
});

test("a picture over the limit is not taken, however it arrives", async () => {
  const big = Buffer.concat([PNG, Buffer.alloc(4096)]);
  let mode: "b64" | "length" | "stream" = "b64";
  const { origin, server } = await fake((req, res) => {
    if (req.url === "/big.png") {
      if (mode === "length") return res.writeHead(200, { "content-length": big.length }).end(big);
      // No length given: only counting what comes tells.
      res.writeHead(200);
      return void res.end(big);
    }
    json(res, { data: [mode === "b64" ? { b64_json: b64(big) } : { url: `${origin}/big.png` }] });
  });
  try {
    for (const m of ["b64", "length", "stream"] as const) {
      mode = m;
      await assert.rejects(gen.generateImage(config(origin), { prompt: "p" }, { maxBytes: 1024 }), /over/, m);
    }
    assert.equal((await gen.generateImage(config(origin), { prompt: "p" }, { maxBytes: 1024 * 1024 })).ext, "png");
  } finally {
    server.close();
  }
});

test("a server that never answers is given up on, and a chat that is stopped stops it", async () => {
  const { origin, server } = await fake(() => {});
  try {
    await assert.rejects(gen.generateImage(config(origin), { prompt: "p" }, { timeoutMs: 150 }), /did not answer within/);
    const stop = new AbortController();
    const slow = gen.generateImage(config(origin), { prompt: "p" }, { signal: stop.signal });
    setTimeout(() => stop.abort(), 50);
    await assert.rejects(slow, (e: Error) => !(e instanceof gen.ImageGenerationError) && /abort/i.test(e.name));
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("an error from the endpoint is passed on without the key, even where it repeats it", async () => {
  const { origin, server } = await fake((_req, res) => json(res, { error: { message: `Invalid key ${KEY} for model image-model` } }, 401));
  try {
    await assert.rejects(gen.generateImage(config(origin), { prompt: "p" }), (e: Error) => {
      assert.match(e.message, /answered 401: Invalid key \[key\] for model/);
      assert.ok(!e.message.includes(KEY));
      return true;
    });
  } finally {
    server.close();
  }
  const html = await fake((_req, res) => res.writeHead(502).end("<html>Bad gateway</html>"));
  try {
    await assert.rejects(gen.generateImage(config(html.origin), { prompt: "p" }), /answered 502/);
  } finally {
    html.server.close();
  }
  // Nothing listening: said, without the key.
  await assert.rejects(gen.generateImage(config("http://127.0.0.1:1"), { prompt: "p" }), (e: Error) => /Could not reach the image endpoint/.test(e.message) && !e.message.includes(KEY));
});

/** The tool as pi gets it, and a way to call it. */
function load(folder: string) {
  const tool = new GenerateImageTool(folder);
  const registered: any[] = [];
  tool.extension({ registerTool: (t: any) => registered.push(t) });
  return { tool, registered, call: (p: any, signal?: AbortSignal) => registered[0].execute("id", p, signal) };
}

test("while it is off, or has no address, the tool is not there at all", () => {
  const folder = mkdtempSync(path.join(temp, "chat-"));
  const off = load(folder);
  assert.deepEqual(off.registered, []);
  assert.equal(off.tool.registered(), false);

  gen.saveImageGeneration({ baseUrl: "https://images.example.com/v1", enabled: true });
  const on = load(folder);
  assert.deepEqual(on.registered.map((t) => t.name), ["generate_image"]);
  assert.equal(on.tool.registered(), true);

  // Loaded again after a switch, as pi does on a reload: it follows.
  gen.saveImageGeneration({ enabled: false });
  on.tool.extension({ registerTool: () => assert.fail("not while it is off") });
  assert.equal(on.tool.registered(), false);
});

test("the tool makes a picture in the chat's folder and answers as show_image does", async () => {
  const folder = mkdtempSync(path.join(temp, "chat-"));
  const { origin, seen, server } = await fake((_req, res) => json(res, { data: [{ b64_json: b64(PNG) }] }));
  try {
    gen.saveImageGeneration({ baseUrl: origin, model: "image-model", apiKey: KEY, enabled: true });
    const { call, registered } = load(folder);
    const params = registered[0].parameters;
    assert.deepEqual(Object.keys(params.properties).sort(), ["prompt", "size", "title"]);
    assert.ok(!JSON.stringify(registered[0]).includes(KEY));

    const result = await call({ prompt: "  a lighthouse at dusk  ", title: "Lighthouse", size: "1024x1024" });
    assert.match(result.details.path, new RegExp(`^${GENERATED_DIR}/image-\\d{8}-\\d{6}-[0-9a-f]{6}\\.png$`));
    assert.deepEqual(result.details, { path: result.details.path, title: "Lighthouse" });
    assert.match(result.content[0].text, /shown to the user/i);
    assert.deepEqual(readFileSync(path.join(folder, result.details.path)), PNG);
    assert.deepEqual(seen[0].body, { model: "image-model", prompt: "a lighthouse at dusk", n: 1, size: "1024x1024" });

    // Without a title, the prompt is the caption; a second one never takes the first's place.
    const again = await call({ prompt: "a lighthouse\nat   dusk" });
    assert.equal(again.details.title, "a lighthouse at dusk");
    assert.notEqual(again.details.path, result.details.path);
    assert.equal(readdirSync(path.join(folder, GENERATED_DIR)).length, 2);
    assert.deepEqual(readdirSync(folder), [GENERATED_DIR], "nothing else was made in the folder");
  } finally {
    server.close();
  }
});

test("the name is made by the portal: nothing the agent or the endpoint says reaches it", async () => {
  const folder = mkdtempSync(path.join(temp, "chat-"));
  const { origin, server } = await fake((_req, res) => json(res, { data: [{ b64_json: b64(JPEG), revised_prompt: "../../../escape", url: "../../x" }], created: "../../y" }));
  try {
    gen.saveImageGeneration({ baseUrl: origin, enabled: true });
    const { call } = load(folder);
    const result = await call({ prompt: "../../../etc/passwd", title: "../../x.png" });
    assert.match(result.details.path, /^generated-images\/image-[\d-]+-[0-9a-f]{6}\.jpg$/);
    assert.equal(existsSync(path.join(folder, "..", "escape")), false);
    assert.deepEqual(readdirSync(folder), [GENERATED_DIR]);
  } finally {
    server.close();
  }
});

test("a folder in the chat that leads out of it is not written through", async () => {
  const folder = mkdtempSync(path.join(temp, "chat-"));
  const outside = mkdtempSync(path.join(temp, "outside-"));
  symlinkSync(outside, path.join(folder, GENERATED_DIR));
  const { origin, server } = await fake((_req, res) => json(res, { data: [{ b64_json: b64(PNG) }] }));
  try {
    gen.saveImageGeneration({ baseUrl: origin, enabled: true });
    await assert.rejects(load(folder).call({ prompt: "p" }));
    assert.deepEqual(readdirSync(outside), [], "nothing outside the folder");
  } finally {
    server.close();
  }
});

test("the tool fails loudly: a bad ask, an endpoint with no picture, an add-on switched off since", async () => {
  const folder = mkdtempSync(path.join(temp, "chat-"));
  let answer: unknown = { data: [{ b64_json: b64(PNG) }] };
  const { origin, server } = await fake((_req, res) => json(res, answer));
  try {
    gen.saveImageGeneration({ baseUrl: origin, enabled: true });
    const { call } = load(folder);
    await assert.rejects(call({ prompt: "   " }), /prompt is required/);
    await assert.rejects(call({ prompt: "x".repeat(4001) }), /over 4000 characters/);
    await assert.rejects(call({ prompt: "p", size: "huge" }), /1024x1024/);
    answer = { data: [{ b64_json: b64(SVG) }] };
    await assert.rejects(call({ prompt: "p" }), /not a PNG, JPEG, GIF or WebP/);
    assert.equal(existsSync(path.join(folder, GENERATED_DIR)), false, "what is not a picture is not kept");
    // Changed since it was loaded: in force at once; switched off since: refused.
    server.closeAllConnections();
    gen.saveImageGeneration({ enabled: false });
    await assert.rejects(call({ prompt: "p" }), /switched off/);
  } finally {
    server.close();
  }
});

test("the API holds the settings, never gives the key back, and reloads chats only when the tool comes or goes", async () => {
  const express = (await import("express")).default;
  const { featuresRouter } = await import("../server/src/api/features.ts");
  const app = express().use(express.json()).use("/api", featuresRouter());
  const portal = app.listen(0, "127.0.0.1");
  await new Promise((r) => portal.once("listening", r));
  const at = `http://127.0.0.1:${(portal.address() as { port: number }).port}/api`;
  const call = async (method: string, p: string, body?: unknown) => {
    const r = await fetch(`${at}${p}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    assert.ok(!text.includes(KEY), `${method} ${p} gave the key back`);
    return { status: r.status, body: JSON.parse(text) };
  };
  try {
    // As a fresh install has it, whatever the tests before left.
    gen.saveImageGeneration({ enabled: false, baseUrl: "", model: "", size: "", apiKey: "" });
    assert.deepEqual((await call("GET", "/features/images")).body, { images: { enabled: false, baseUrl: "", model: "", size: "", keySet: false } });
    assert.equal((await call("PUT", "/features/images", { enabled: true })).status, 400, "nowhere to ask yet");
    assert.equal((await call("PUT", "/features/images", { baseUrl: "https://u:p@h.example/v1" })).status, 400);
    assert.equal((await call("PUT", "/features/images", { size: "wide" })).status, 400);

    const saved = await call("PUT", "/features/images", { baseUrl: "https://images.example.com/v1", model: "image-model", apiKey: KEY });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body, { images: { enabled: false, baseUrl: "https://images.example.com/v1", model: "image-model", size: "", keySet: true }, changed: false, reloaded: 0, waiting: 0 });
    const on = await call("PUT", "/features/images", { enabled: true });
    assert.equal(on.body.changed, true, "the tool is there from now on: chats are reloaded");
    assert.equal(on.body.images.enabled, true);
    assert.equal((await call("PUT", "/features/images", { model: "other" })).body.changed, false, "the model is read at each call: no reload");

    assert.equal((await call("GET", "/features/images")).body.images.keySet, true);
    assert.equal((await call("PUT", "/features/images", { apiKey: "" })).body.images.keySet, false);
    // The page's whole picture of the features has it too, and still no key.
    await call("PUT", "/features/images", { apiKey: KEY });
    const all = await call("GET", "/features");
    assert.equal(all.body.images.keySet, true);
    assert.ok(!("apiKey" in all.body.images));
    await call("PUT", "/features/images", { enabled: false });
  } finally {
    portal.close();
  }
});

test("the tool menus do not offer generate_image while the add-on is off, though it is remembered for when it is on", async () => {
  const { remembered, rememberTools, shownTools, knownTools } = await import("../server/src/db.ts");
  // As a chat that had the tool reports it: no package of the user's brings it, and pi names its extension <inline:…>.
  rememberTools([
    remembered({ name: "generate_image", source: "image-generation", inline: true }),
    remembered({ name: "show_image", source: "pictures", inline: true }),
  ]);
  const names = () => shownTools().map((t) => t.name).filter((n) => /image/.test(n));
  gen.saveImageGeneration({ enabled: false, baseUrl: "", apiKey: "" });
  assert.deepEqual(names(), ["show_image"]);
  gen.saveImageGeneration({ baseUrl: "https://images.example.com/v1" });
  assert.deepEqual(names(), ["show_image"], "an address alone does not make the tool");
  gen.saveImageGeneration({ enabled: true });
  assert.deepEqual(names().sort(), ["generate_image", "show_image"]);
  gen.saveImageGeneration({ enabled: false });
  assert.deepEqual(names(), ["show_image"]);
  assert.equal(knownTools().find((t) => t.name === "generate_image")?.inline, true, "remembered for when it is on");
  assert.ok(!("inline" in shownTools()[0]), "the page is not told how it is kept");

  // An extension's tool of the same name is loaded whatever the add-on says, so it is offered — also from a
  // file or a folder called image-generation, which has the same label the portal's extension has.
  for (const source of ["image-package", "image-generation"]) {
    rememberTools([remembered({ name: "generate_image", source })]);
    assert.deepEqual(names().sort(), ["generate_image", "show_image"], source);
    rememberTools([remembered({ name: "generate_image", source: "image-generation", package: "npm:image-package" })]);
    assert.deepEqual(names().sort(), ["generate_image", "show_image"], `${source}, from a package`);
  }
  // The portal's own again, as the next chat that has it reports it.
  rememberTools([remembered({ name: "generate_image", source: "image-generation", inline: true })]);
  assert.deepEqual(names(), ["show_image"]);
});

test("an extension's tool of the same name is the one pi keeps, so the portal's is not counted as there", () => {
  const ext = (extensionPath: string, ...names: string[]) => ({ path: extensionPath, tools: new Map(names.map((n) => [n, { definition: { name: n } }])) });
  const own = ext("<inline:image-generation>", "generate_image");
  assert.equal(takenByAnother([]), false);
  assert.equal(takenByAnother([ext("/x/other.ts", "other_tool"), own]), false, "its own is not another's");
  assert.equal(takenByAnother([ext("/x/image-package.ts", "edit_image", "generate_image"), own]), true);

  gen.saveImageGeneration({ baseUrl: "https://images.example.com/v1", enabled: true });
  let loaded: any[] = [own];
  const tool = new GenerateImageTool(mkdtempSync(path.join(temp, "chat-")), () => loaded);
  assert.equal(tool.registered(), false, "not before it is loaded");
  tool.extension({ registerTool: () => {} });
  assert.equal(tool.registered(), true);
  loaded = [ext("/x/image-package.ts", "generate_image"), own];
  assert.equal(tool.registered(), false, "an extension's tool is the model's");
  gen.saveImageGeneration({ enabled: false });
});
