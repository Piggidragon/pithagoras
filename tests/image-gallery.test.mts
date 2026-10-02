import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, get, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const temp = mkdtempSync(path.join(tmpdir(), "pitha-gallery-"));
// What it made is not left in the temporary folder, run after run.
after(() => rmSync(temp, { recursive: true, force: true }));
process.env.DATA_DIR = temp;
process.env.SESSION_DIR = path.join(temp, "sessions");
process.env.PI_CODING_AGENT_DIR = path.join(temp, "agent");
process.env.AGENT_HOME = path.join(temp, "agent-home");

const express = (await import("express")).default;
const gen = await import("../server/src/image-generation.ts");
const gallery = await import("../server/src/image-gallery.ts");
const { imagesRouter } = await import("../server/src/api/images.ts");
const { featuresRouter } = await import("../server/src/api/features.ts");
const { GenerateImageTool, GENERATED_DIR } = await import("../server/src/pi/generate-image-tool.ts");
const { EditImageTool } = await import("../server/src/pi/edit-image-tool.ts");
const { MAX_RUNNING } = await import("../server/src/image-jobs.ts");
const { createSession, deleteSession, getDb } = await import("../server/src/db.ts");

// The first bytes of each kind a browser draws, padded: that is all the check reads. `tag` tells two apart.
const pad = (head: number[], tag = "", to = 64) => Buffer.concat([Buffer.from(head), Buffer.from(tag), Buffer.alloc(to)]);
const png = (tag = "") => pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], tag);
const PNG = png();
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const KEY = "sk-test-0123456789";

interface Seen { method?: string; url?: string; auth?: string; body?: any; type?: string; raw?: Buffer; closed?: boolean }
/** A fake image endpoint: `handler` answers, and every request it gets is kept. */
async function fake(handler: (req: IncomingMessage, res: ServerResponse, seen: Seen) => void): Promise<{ origin: string; seen: Seen[]; server: Server }> {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const whole = Buffer.concat(chunks);
      const text = whole.toString("utf8");
      let body: any;
      try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
      const one: Seen = { method: req.method, url: req.url, auth: req.headers.authorization, body, type: req.headers["content-type"], raw: whole };
      seen.push(one);
      res.on("close", () => { one.closed = !res.writableFinished; });
      handler(req, res, one);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { origin: `http://127.0.0.1:${(server.address() as { port: number }).port}`, seen, server };
}
/** The parts of a multipart request as an endpoint reads them, in the order they were sent. */
function partList(seen: Seen): { name: string; filename?: string; bytes: Buffer }[] {
  const boundary = /boundary=(.+)$/.exec(seen.type ?? "")?.[1];
  assert.ok(boundary, `a multipart form, not ${seen.type}`);
  const found: { name: string; filename?: string; bytes: Buffer }[] = [];
  const delimiter = Buffer.from(`--${boundary}`);
  let at = seen.raw!.indexOf(delimiter);
  while (at >= 0) {
    const next = seen.raw!.indexOf(delimiter, at + delimiter.length);
    if (next < 0) break;
    const part = seen.raw!.subarray(at + delimiter.length + 2, next - 2);
    const split = part.indexOf("\r\n\r\n");
    const head = part.subarray(0, split).toString("utf8");
    found.push({ name: /name="([^"]*)"/.exec(head)![1], filename: /filename="([^"]*)"/.exec(head)?.[1], bytes: part.subarray(split + 4) });
    at = next;
  }
  return found;
}
const json = (res: ServerResponse, body: unknown, status = 200) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
const b64 = (bytes: Buffer) => bytes.toString("base64");
/** Answers every request with a picture. */
const answering = (bytes: Buffer = PNG) => fake((_req, res) => json(res, { data: [{ b64_json: b64(bytes) }] }));

// The portal's parts the page talks to, as the server mounts them: its own parser for what carries a mask.
const app = express()
  .use((req, res, next) => (req.path === "/api/images/edit" ? next() : express.json({ limit: "2mb" })(req, res, next)))
  .use("/api", featuresRouter(), imagesRouter())
  // What a body that is too large says, as the server's own handler says it.
  .use((err: { status?: number; message?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => void res.status(err.status ?? 500).json({ error: err.message }));
const portal = app.listen(0, "127.0.0.1");
await new Promise((r) => portal.once("listening", r));
after(() => portal.close());
const at = `http://127.0.0.1:${(portal.address() as { port: number }).port}/api`;

/** A call to the API, and what it answered; none ever has the key in it. */
async function call(method: string, p: string, body?: unknown, init: { raw?: Buffer; type?: string; headers?: Record<string, string> } = {}) {
  const r = await fetch(`${at}${p}`, {
    method,
    headers: { ...(init.raw ? { "content-type": init.type ?? "image/png" } : body !== undefined ? { "content-type": "application/json" } : {}), ...init.headers },
    body: init.raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const bytes = Buffer.from(await r.arrayBuffer());
  assert.ok(!bytes.includes(KEY), `${method} ${p} gave the key back`);
  const type = r.headers.get("content-type") ?? "";
  return { status: r.status, headers: r.headers, bytes, body: type.includes("json") ? JSON.parse(bytes.toString("utf8")) : undefined };
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Waits until none of the jobs is running, and returns them. */
async function settled(): Promise<any[]> {
  for (let i = 0; i < 200; i++) {
    const { jobs } = (await call("GET", "/images/jobs")).body;
    if (jobs.every((j: any) => j.state !== "running")) return jobs;
    await pause(25);
  }
  assert.fail("a job never ended");
}
/** No job of an earlier test is left to be told apart from this one's. */
async function clearJobs() {
  for (const job of (await call("GET", "/images/jobs")).body.jobs) await call("DELETE", `/images/jobs/${job.id}`);
}
const settings = (more: Partial<ReturnType<typeof gen.imageGenerationConfig>> = {}) =>
  gen.saveImageGeneration({ enabled: true, model: "image-model", size: "", apiKey: KEY, editEnabled: false, editBaseUrl: "", editModel: "", editApiKey: "", editMultiple: false, ...more });
const gone = () => gen.saveImageGeneration({ enabled: false, editEnabled: false });
/** A chat with a folder of its own. */
function chat(id: string, title = "A chat") {
  const folder = mkdtempSync(path.join(temp, "chat-"));
  createSession({ id, title, workspace: folder, executor: "host" });
  return folder;
}
const listed = async (query = "") => (await call("GET", `/images${query}`)).body;
const dir = path.join(temp, "images");

test("extra fields are checked: names and values a form can send, never the four the request is made of", () => {
  assert.deepEqual(gen.parseExtra(undefined), {});
  assert.deepEqual(gen.parseExtra({ quality: "high", seed: "7", hd: "true", soft: "false", ratio: "1.5", plain: '"42"', n2: 3, ok: false }), { quality: "high", seed: 7, hd: true, soft: false, ratio: 1.5, plain: "42", n2: 3, ok: false });
  for (const name of ["model", "prompt", "n", "size"]) assert.match(String(gen.parseExtra({ [name]: "x" })), /set by the form itself/, name);
  for (const bad of ["", "9lives", "with space", "a/b", "x".repeat(41)]) assert.equal(typeof gen.parseExtra({ [bad]: "x" }), "string", bad);
  assert.equal(typeof gen.parseExtra({ a: "x".repeat(201) }), "string");
  assert.equal(typeof gen.parseExtra({ a: { nested: 1 } }), "string");
  assert.equal(typeof gen.parseExtra(["a"]), "string");
  assert.equal(typeof gen.parseExtra(Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`f${i}`, "x"]))), "string");
});

test("a request has a model and extra fields of its own, and the form's four fields cannot be taken over", async () => {
  const { origin, seen, server } = await answering();
  try {
    const config = gen.imageGenerationConfig();
    const base = { ...config, enabled: true, baseUrl: origin, model: "saved-model", size: "1024x1024", apiKey: KEY };
    await gen.generateImage(base, { prompt: "a", model: "other", size: "512x512", extra: { quality: "high", seed: 7, n: 9, model: "sneaky", prompt: "sneaky", size: "1x1" } });
    assert.deepEqual(seen[0].body, { quality: "high", seed: 7, model: "other", prompt: "a", n: 1, size: "512x512" });
    await gen.generateImage(base, { prompt: "b" });
    assert.deepEqual(seen[1].body, { model: "saved-model", prompt: "b", n: 1, size: "1024x1024" }, "without them, what the tool sends");
  } finally {
    server.close();
  }
});

test("a picture is made without any chat: a job, a picture in the gallery that is sent, and the key stays on the server", async () => {
  const { origin, seen, server } = await answering();
  await clearJobs();
  try {
    settings({ baseUrl: origin });
    const start = await call("POST", "/images/generate", { prompt: "  a lighthouse at dusk  ", size: "512x512", model: "other-model", extra: { quality: "high", seed: "7", hd: "true" } });
    assert.equal(start.status, 202, "answered at once, without waiting for the endpoint");
    assert.equal(start.body.jobs.length, 1);
    assert.equal(start.body.jobs[0].kind, "generate");
    assert.equal(start.body.jobs[0].size, "512x512");
    const [job] = await settled();
    assert.equal(job.state, "done");
    assert.deepEqual(seen[0].body, { quality: "high", seed: 7, hd: true, model: "other-model", prompt: "a lighthouse at dusk", n: 1, size: "512x512" });
    assert.equal(seen[0].auth, `Bearer ${KEY}`);
    assert.match(seen[0].url!, /\/images\/generations$/);

    const all = await listed();
    const picture = all.pictures.find((p: any) => p.id === job.pictureId);
    assert.ok(picture, "the picture is in the gallery");
    assert.deepEqual({ ...picture, createdAt: 0, bytes: 0, fileName: "" }, {
      id: job.pictureId, origin: "page", chat: null, kind: "generated", prompt: "a lighthouse at dusk",
      params: { model: "other-model", size: "512x512", extra: { quality: "high", seed: 7, hd: true } },
      from: null, createdAt: 0, bytes: 0, fileName: "",
    });
    assert.match(picture.fileName, /^image-\d{8}-\d{6}-[0-9a-f]{4}\.png$/);
    assert.equal(picture.bytes, PNG.length);
    assert.ok(Math.abs(picture.createdAt - Date.now()) < 60_000);

    const file = await call("GET", `/images/${picture.id}/file`);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get("content-type"), "image/png");
    assert.deepEqual(file.bytes, PNG);
    assert.match(file.headers.get("content-security-policy") ?? "", /sandbox/);
    assert.equal(file.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(readFileSync(path.join(dir, `${picture.id}.png`)), PNG, "kept in the portal's own folder");
    // The browser keeps what never changes, and asks again with what it has. Through http: fetch adds a no-cache to a conditional request, which is its own way of asking for everything again.
    const status = await new Promise<number>((resolve) => {
      get(`${at}/images/${picture.id}/file`, { headers: { "if-none-match": file.headers.get("etag")! } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
    });
    assert.equal(status, 304);
    assert.match(file.headers.get("cache-control") ?? "", /max-age=86400/);
  } finally {
    server.close();
    gone();
  }
});

test("several pictures are one request each, no more than the limit are made at once, and a request that is too much is refused whole", async () => {
  const held: ServerResponse[] = [];
  const { origin, seen, server } = await fake((_req, res) => void held.push(res));
  await clearJobs();
  try {
    settings({ baseUrl: origin });
    const before = (await listed()).total;
    assert.equal((await call("POST", "/images/generate", { prompt: "x", count: MAX_RUNNING + 1 })).status, 400);
    assert.equal((await call("POST", "/images/generate", { prompt: "x", count: 0 })).status, 400);
    const three = await call("POST", "/images/generate", { prompt: "three", count: 3 });
    assert.equal(three.status, 202);
    assert.equal(three.body.jobs.length, 3);
    for (let i = 0; i < 100 && seen.length < 3; i++) await pause(10);
    assert.equal(seen.length, 3, "one request for each, not one for three");
    assert.ok(seen.every((s) => s.body.n === 1), "each asks for one: an endpoint that makes one at a time is not asked for more");

    const two = await call("POST", "/images/generate", { prompt: "two", count: 2 });
    assert.equal(two.status, 429, "only one place is free");
    assert.match(two.body.error, /Only 1 more/);
    assert.equal(seen.length, 3, "none of the two was started");
    assert.equal((await call("POST", "/images/generate", { prompt: "one" })).status, 202);
    const full = await call("POST", "/images/generate", { prompt: "none" });
    assert.equal(full.status, 429);
    assert.match(full.body.error, /being made already/);

    for (let i = 0; i < 100 && held.length < 4; i++) await pause(10);
    for (const res of held) json(res, { data: [{ b64_json: b64(PNG) }] });
    const jobs = await settled();
    assert.equal(jobs.filter((j) => j.state === "done").length, 4);
    assert.equal((await listed()).total, before + 4);
    // Done, a place is free again.
    held.length = 0;
    assert.equal((await call("POST", "/images/generate", { prompt: "again" })).status, 202);
    for (let i = 0; i < 100 && !held.length; i++) await pause(10);
    json(held[0], { data: [{ b64_json: b64(PNG) }] });
    await settled();
    // A finished job is cleared when it has been seen.
    for (const job of (await call("GET", "/images/jobs")).body.jobs) assert.equal((await call("DELETE", `/images/jobs/${job.id}`)).status, 200);
    assert.deepEqual((await call("GET", "/images/jobs")).body.jobs, []);
    assert.equal((await call("DELETE", "/images/jobs/nothere")).status, 404);
  } finally {
    server.close();
    gone();
  }
});

test("a picture that is being made can be stopped: the request is dropped and no picture comes of it", async () => {
  const held: ServerResponse[] = [];
  const { origin, seen, server } = await fake((_req, res) => void held.push(res));
  await clearJobs();
  try {
    settings({ baseUrl: origin });
    const before = (await listed()).total;
    const { jobs } = (await call("POST", "/images/generate", { prompt: "slow" })).body;
    for (let i = 0; i < 100 && !seen.length; i++) await pause(10);
    assert.equal((await call("GET", "/images/jobs")).body.jobs[0].state, "running");
    assert.equal((await call("DELETE", `/images/jobs/${jobs[0].id}`)).status, 200);
    assert.deepEqual((await call("GET", "/images/jobs")).body.jobs, [], "nothing is left to show of it");
    for (let i = 0; i < 100 && !seen[0].closed; i++) await pause(10);
    assert.equal(seen[0].closed, true, "the endpoint was let go of");
    // Late or not, what the endpoint says is not wanted.
    for (const res of held) if (!res.destroyed) json(res, { data: [{ b64_json: b64(PNG) }] });
    await pause(50);
    assert.equal((await listed()).total, before);
    // The place is free again.
    assert.equal((await call("POST", "/images/generate", { prompt: "next", count: MAX_RUNNING })).status, 202);
    for (const j of (await call("GET", "/images/jobs")).body.jobs) await call("DELETE", `/images/jobs/${j.id}`);
  } finally {
    server.close();
    gone();
  }
});

test("a failure is said without the key, and a request that is no picture makes none", async () => {
  const answers: ((res: ServerResponse) => void)[] = [
    (res) => json(res, { error: { message: `bad key ${KEY} for this model` } }, 401),
    (res) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [{ b64_json: b64(SVG) }] })),
    (res) => json(res, { data: [] }),
  ];
  let n = 0;
  const { origin, server } = await fake((_req, res) => answers[n++](res));
  await clearJobs();
  try {
    settings({ baseUrl: origin });
    const before = (await listed()).total;
    for (const expected of [/answered 401: bad key \[key\] for this model/, /is not a PNG, JPEG, GIF or WebP/, /no picture in it/]) {
      await call("POST", "/images/generate", { prompt: "x" });
      const [job] = await settled();
      assert.equal(job.state, "failed");
      assert.match(job.error, expected);
      assert.ok(!JSON.stringify(job).includes(KEY));
      assert.equal(job.pictureId, undefined);
      await call("DELETE", `/images/jobs/${job.id}`);
    }
    assert.equal((await listed()).total, before);
  } finally {
    server.close();
    gone();
  }
});

test("nothing is made while the add-on is off, and a request is checked before it is sent", async () => {
  const { origin, seen, server } = await answering();
  try {
    settings({ baseUrl: origin, enabled: false });
    const off = await call("POST", "/images/generate", { prompt: "x" });
    assert.equal(off.status, 409);
    assert.match(off.body.error, /Settings → Add-ons → Images/);
    assert.equal((await call("POST", "/images/edit", { prompt: "x", sources: ["0123456789ab"] })).status, 409);
    settings({ baseUrl: origin });
    for (const bad of [{}, { prompt: "   " }, { prompt: "x".repeat(gen.MAX_PROMPT + 1) }, { prompt: "x", size: "huge" }, { prompt: "x", model: "m".repeat(201) }, { prompt: "x", extra: { n: 4 } }, { prompt: "x", extra: [1] }, { prompt: "x", count: 1.5 }, { prompt: "x", count: "2" }]) {
      assert.equal((await call("POST", "/images/generate", bad)).status, 400, JSON.stringify(bad).slice(0, 60));
    }
    assert.equal(seen.length, 0, "nothing went to the endpoint");
    // The edits a gallery cannot make: nothing to change, too many, not ids.
    settings({ baseUrl: origin, editEnabled: true });
    for (const bad of [{ prompt: "x" }, { prompt: "x", sources: [] }, { prompt: "x", sources: ["../etc/passwd"] }, { prompt: "x", sources: Array.from({ length: 9 }, () => "0123456789ab") }, { prompt: "", sources: ["0123456789ab"] }, { prompt: "x", sources: ["0123456789ab"], mask: 5 }, { prompt: "x", sources: ["0123456789ab"], mask: "not base64!" }]) {
      assert.equal((await call("POST", "/images/edit", bad)).status, 400, JSON.stringify(bad).slice(0, 80));
    }
  } finally {
    server.close();
    gone();
  }
});

test("a picture from the person's own files is kept only if its bytes say it is one, and under a name with no place in it", async () => {
  const before = (await listed()).total;
  const bad = await call("POST", "/images/upload?name=x.png", undefined, { raw: SVG, type: "image/png" });
  assert.equal(bad.status, 400, "what it is called does not make it a picture");
  assert.equal((await call("POST", "/images/upload?name=x.png", undefined, { raw: Buffer.alloc(0) })).status, 400);
  assert.equal((await call("POST", "/images/upload", undefined, { raw: Buffer.from("MZ") })).status, 400);
  const ok = await call("POST", "/images/upload?name=" + encodeURIComponent("../../etc/My photo.png"), undefined, { raw: png("up") });
  assert.equal(ok.status, 201);
  const { picture } = ok.body;
  assert.equal(picture.kind, "uploaded");
  assert.equal(picture.origin, "page");
  assert.equal(picture.prompt, "My photo.png");
  assert.equal(picture.from, null);
  assert.deepEqual(readFileSync(path.join(dir, `${picture.id}.png`)), png("up"));
  assert.equal((await listed()).total, before + 1);
  // As large as an edit takes: a larger one is not read.
  const huge = await call("POST", "/images/upload?name=huge.png", undefined, { raw: Buffer.concat([png(), Buffer.alloc(26 * 1024 * 1024)]) });
  assert.equal(huge.status, 413);
  assert.equal((await listed()).total, before + 1);
});

test("an edit is made from pictures of the gallery, with a mask if one is given, and the result is tied to the first of them", async () => {
  const { origin, seen, server } = await answering(png("edited"));
  await clearJobs();
  try {
    const first = (await call("POST", "/images/upload?name=a.png", undefined, { raw: png("one") })).body.picture;
    const second = (await call("POST", "/images/upload?name=b.png", undefined, { raw: png("two") })).body.picture;
    settings({ baseUrl: origin, editEnabled: true, editModel: "edit-model" });
    const started = await call("POST", "/images/edit", { prompt: "  make it night  ", sources: [first.id] });
    assert.equal(started.status, 202);
    assert.equal(started.body.jobs[0].kind, "edit");
    assert.equal(started.body.jobs[0].from, first.id, "the picture the frame shows under the wait");
    const [job] = await settled();
    assert.equal(job.state, "done", job.error);
    assert.match(seen[0].url!, /\/images\/edits$/);
    assert.equal(seen[0].auth, `Bearer ${KEY}`);
    const parts = partList(seen[0]);
    assert.deepEqual(parts.map((p) => p.name), ["image", "prompt", "model", "n"]);
    assert.deepEqual(parts[0].bytes, png("one"));
    assert.equal(parts[1].bytes.toString(), "make it night");
    assert.equal(parts[2].bytes.toString(), "edit-model");
    const made = (await listed()).pictures.find((p: any) => p.id === job.pictureId);
    assert.equal(made.kind, "edited");
    assert.equal(made.origin, "page");
    assert.equal(made.from, first.id);
    assert.deepEqual(made.params, { model: "edit-model", sources: [first.id] });
    assert.equal(made.prompt, "make it night");
    assert.deepEqual(readFileSync(path.join(dir, `${made.id}.png`)), png("edited"));

    // With a mask: sent as `mask`, said to have been, and not kept.
    const mask = png("mask");
    const files = readdirSync(dir).length;
    await call("POST", "/images/edit", { prompt: "only the sky", sources: [first.id], mask: `data:image/png;base64,${b64(mask)}` });
    const [masked] = await settled();
    assert.equal(masked.state, "done", masked.error);
    const sent = partList(seen[1]);
    assert.deepEqual(sent.map((p) => p.name), ["image", "mask", "prompt", "model", "n"]);
    assert.deepEqual(sent[1].bytes, mask);
    const maskedPicture = (await listed()).pictures.find((p: any) => p.id === masked.pictureId);
    assert.equal(maskedPicture.params.masked, true);
    assert.equal(readdirSync(dir).length, files + 1, "the mask is not a picture in the folder");

    // A mask that is no picture is refused before anything is sent.
    const sentBefore = seen.length;
    await call("POST", "/images/edit", { prompt: "x", sources: [first.id], mask: b64(SVG) });
    const [bad] = await settled();
    assert.equal(bad.state, "failed");
    assert.match(bad.error, /mask is not a PNG, JPEG, GIF or WebP/);
    assert.equal(seen.length, sentBefore);

    // Several pictures only to an endpoint that takes them, and then in the order given.
    const refused = await call("POST", "/images/edit", { prompt: "x", sources: [first.id, second.id] });
    assert.equal(refused.status, 400);
    assert.match(refused.body.error, /not set up to take several pictures/);
    settings({ baseUrl: origin, editEnabled: true, editMultiple: true });
    await call("POST", "/images/edit", { prompt: "the first like the second", sources: [second.id, first.id] });
    const [several] = await settled();
    assert.equal(several.state, "done", several.error);
    const list = partList(seen[seen.length - 1]);
    assert.deepEqual(list.filter((p) => p.name === "image[]").map((p) => p.bytes), [png("two"), png("one")]);
    const multi = (await listed()).pictures.find((p: any) => p.id === several.pictureId);
    assert.equal(multi.from, second.id);
    assert.deepEqual(multi.params.sources, [second.id, first.id]);

    const none = await call("POST", "/images/edit", { prompt: "x", sources: ["ffffffffffff"] });
    assert.equal(none.status, 400);
    assert.match(none.body.error, /no such picture/);
  } finally {
    server.close();
    gone();
  }
});

test("the agent's pictures are in the gallery with the chat they came from, and an edit is tied to what it was made from", async () => {
  const { origin, seen, server } = await answering();
  try {
    settings({ baseUrl: origin, size: "1024x1024", editEnabled: true });
    const folder = chat("chat-1", "Lighthouses");
    const generate = new GenerateImageTool(folder, () => [], "chat-1");
    const registered: any[] = [];
    generate.extension({ registerTool: (t: any) => registered.push(t) });
    const made = await registered[0].execute("id", { prompt: "a lighthouse", title: "Lighthouse" });
    const picture = (await listed("?origin=chat")).pictures[0];
    assert.equal(picture.origin, "chat");
    assert.deepEqual(picture.chat, { id: "chat-1", title: "Lighthouses" });
    assert.equal(picture.kind, "generated");
    assert.equal(picture.prompt, "a lighthouse");
    assert.deepEqual(picture.params, { model: "image-model", size: "1024x1024" });
    assert.equal(picture.fileName, path.basename(made.details.path));
    assert.equal(picture.from, null);
    const file = await call("GET", `/images/${picture.id}/file`);
    assert.equal(file.status, 200);
    assert.deepEqual(file.bytes, PNG);
    assert.equal(file.headers.get("cache-control"), "private, no-cache", "a file in a chat's folder is that folder's: the browser asks");

    const edit = new EditImageTool(folder, () => [], "chat-1");
    const edits: any[] = [];
    edit.extension({ registerTool: (t: any) => edits.push(t) });
    const changed = await edits[0].execute("id", { path: made.details.path, prompt: "at night" });
    const edited = (await listed("?origin=chat&kind=edited")).pictures[0];
    assert.equal(edited.from, picture.id);
    assert.equal(edited.prompt, "at night");
    assert.deepEqual(edited.params, { sources: [picture.id] });
    assert.equal(edited.fileName, path.basename(changed.details.path));
    // What an edit was made from is reached by its id, wherever it is in the list.
    const by = await listed(`?ids=${picture.id},${edited.id},ffffffffffff`);
    assert.deepEqual(by.pictures.map((p: any) => p.id), [picture.id, edited.id], "in the order given; a picture that is not there is left out");

    // A picture of the folder that the gallery does not know is no link.
    writeFileSync(path.join(folder, "mine.png"), PNG);
    await edits[0].execute("id", { path: "mine.png", prompt: "brighter" });
    const unknown = (await listed("?origin=chat&kind=edited")).pictures[0];
    assert.equal(unknown.prompt, "brighter");
    assert.equal(unknown.from, null);
    assert.equal(seen.length, 3);

    // A tool that was told no chat makes the picture and does not list it.
    const total = (await listed()).total;
    const lone = new GenerateImageTool(chat("chat-2"), () => []);
    const loneTool: any[] = [];
    lone.extension({ registerTool: (t: any) => loneTool.push(t) });
    await loneTool[0].execute("id", { prompt: "unlisted" });
    assert.equal((await listed()).total, total);
  } finally {
    server.close();
    gone();
  }
});

test("a picture in a chat's folder is deleted from the folder on purpose; what was made of it loses its link, and the rest stays", async () => {
  const { origin, server } = await answering();
  try {
    settings({ baseUrl: origin, editEnabled: true });
    const folder = chat("chat-3");
    const tool: any[] = [];
    new GenerateImageTool(folder, () => [], "chat-3").extension({ registerTool: (t: any) => tool.push(t) });
    const edit: any[] = [];
    new EditImageTool(folder, () => [], "chat-3").extension({ registerTool: (t: any) => edit.push(t) });
    const one = await tool[0].execute("id", { prompt: "one" });
    const two = await tool[0].execute("id", { prompt: "two" });
    await edit[0].execute("id", { path: one.details.path, prompt: "edited one" });
    const all = (await listed("?origin=chat")).pictures.filter((p: any) => p.chat.id === "chat-3");
    const [editedOne, pictureTwo, pictureOne] = [all.find((p: any) => p.kind === "edited"), all.find((p: any) => p.prompt === "two"), all.find((p: any) => p.prompt === "one")];
    assert.equal(editedOne.from, pictureOne.id);

    const deleted = await call("DELETE", `/images/${pictureOne.id}`);
    assert.equal(deleted.status, 200);
    assert.equal(existsSync(path.join(folder, one.details.path)), false, "the file is gone from the chat's folder");
    assert.equal(existsSync(path.join(folder, two.details.path)), true, "the others are not touched");
    const after = await listed(`?ids=${editedOne.id}`);
    assert.equal(after.pictures[0].from, null);
    assert.equal((await call("GET", `/images/${pictureOne.id}/file`)).status, 404);
    assert.equal((await call("DELETE", `/images/${pictureOne.id}`)).status, 404, "gone is gone");

    // Several at once: each as asked, and what could not be said for each.
    const page = (await call("POST", "/images/upload?name=p.png", undefined, { raw: png("p") })).body.picture;
    const several = await call("POST", "/images/delete", { ids: [pictureTwo.id, page.id, "ffffffffffff"] });
    assert.equal(several.status, 200);
    assert.deepEqual(several.body.deleted.sort(), [pictureTwo.id, page.id].sort());
    assert.deepEqual(several.body.failed.map((f: any) => f.id), ["ffffffffffff"]);
    assert.equal(existsSync(path.join(folder, two.details.path)), false);
    assert.equal(existsSync(path.join(dir, `${page.id}.png`)), false, "the page's own file goes too");
    assert.equal((await call("POST", "/images/delete", { ids: [] })).status, 400);
    assert.equal((await call("POST", "/images/delete", { ids: ["../../x"] })).status, 400);
    assert.equal((await call("POST", "/images/delete", {})).status, 400);
  } finally {
    server.close();
    gone();
  }
});

test("only what the portal knows is served: a row that points anywhere else is not, whatever put it there", async () => {
  const folder = chat("chat-4");
  const outside = path.join(temp, "outside.png");
  writeFileSync(outside, png("secret"));
  mkdirSync(path.join(folder, GENERATED_DIR));
  mkdirSync(path.join(folder, "notes"));
  writeFileSync(path.join(folder, "notes", "secret.png"), png("notes"));
  symlinkSync(outside, path.join(folder, GENERATED_DIR, "link.png"));
  writeFileSync(path.join(temp, "images", "..", "outside2.png"), png("secret2"));
  const row = (id: string, origin: string, session: string | null, file: string) =>
    getDb().prepare("INSERT INTO images (id, origin, session_id, path, kind, prompt, params, bytes, created_at) VALUES (?, ?, ?, ?, 'generated', 'x', '{}', 1, ?)").run(id, origin, session, file, Date.now());
  row("aaaaaaaaaaa1", "chat", "chat-4", "../outside.png");
  row("aaaaaaaaaaa2", "chat", "chat-4", "notes/secret.png");
  row("aaaaaaaaaaa3", "chat", "chat-4", `${GENERATED_DIR}/link.png`);
  row("aaaaaaaaaaa4", "chat", "chat-4", GENERATED_DIR);
  row("aaaaaaaaaaa5", "chat", "no-such-chat", `${GENERATED_DIR}/x.png`);
  row("aaaaaaaaaaa6", "chat", null, `${GENERATED_DIR}/x.png`);
  row("aaaaaaaaaaa7", "page", null, "../outside2.png");
  // Beginning in the folder of generated pictures is not being in it.
  row("aaaaaaaaaaa8", "chat", "chat-4", `${GENERATED_DIR}/../notes/secret.png`);
  const bad = ["aaaaaaaaaaa1", "aaaaaaaaaaa2", "aaaaaaaaaaa3", "aaaaaaaaaaa4", "aaaaaaaaaaa5", "aaaaaaaaaaa6", "aaaaaaaaaaa7", "aaaaaaaaaaa8"];
  for (const id of bad) {
    const r = await call("GET", `/images/${id}/file`);
    assert.notEqual(r.status, 200, id);
    assert.ok(![png("secret"), png("notes"), png("secret2")].some((b) => r.bytes.equals(b)), `${id} gave a file from outside`);
  }
  // A picture that was served nowhere is no picture the page is shown either.
  const ids = (await listed()).pictures.map((p: any) => p.id);
  for (const id of ["aaaaaaaaaaa3", "aaaaaaaaaaa4", "aaaaaaaaaaa5", "aaaaaaaaaaa6", "aaaaaaaaaaa8"]) assert.ok(!ids.includes(id), `${id} is not listed`);
  // Nor can deleting one take a file from anywhere else.
  for (const id of bad) await call("DELETE", `/images/${id}`);
  assert.equal(existsSync(outside), true);
  assert.equal(existsSync(path.join(temp, "outside2.png")), true);
  assert.equal(existsSync(path.join(folder, "notes", "secret.png")), true);
});

test("the gallery is paged newest first, filtered by where a picture is from and how it was made, and counted", async () => {
  // As many as it takes to want more than a page, spread over time as pictures are.
  const folder = chat("chat-5", "Many");
  const make = (n: number) => {
    for (let i = 0; i < n; i++) gallery.addPagePicture({ bytes: png(`p${i}`), ext: "png", kind: i % 5 === 0 ? "edited" : "generated", prompt: `picture ${i}`, params: {} });
  };
  getDb().prepare("DELETE FROM images").run();
  make(120);
  const missing = gallery.addPagePicture({ bytes: PNG, ext: "png", kind: "generated", prompt: "x", params: {} });
  rmSync(path.join(dir, `${missing.id}.png`));
  mkdirSync(path.join(folder, GENERATED_DIR), { recursive: true });
  for (let i = 0; i < 3; i++) {
    writeFileSync(path.join(folder, GENERATED_DIR, `c${i}.png`), png(`c${i}`));
    gallery.recordChatPicture({ sessionId: "chat-5", path: `${GENERATED_DIR}/c${i}.png`, kind: i === 0 ? "edited" : "generated", prompt: `chat ${i}`, params: {}, bytes: 70 });
  }
  const ids = (getDb().prepare("SELECT id FROM images ORDER BY rowid").all() as { id: string }[]).map((r) => r.id);
  ids.forEach((id, i) => getDb().prepare("UPDATE images SET created_at = ? WHERE id = ?").run(1_000_000 + Math.floor(i / 2), id));

  const first = await listed();
  assert.equal(first.pictures.length, 48, "a page of the default size, not all of them");
  assert.equal(first.total, 123, "the one whose file is gone is not counted: the first look drops it");
  assert.ok(first.pageBytes > 0);
  const seen = new Set<string>(first.pictures.map((p: any) => p.id));
  let page = first;
  let pages = 1;
  while (page.next) {
    page = await listed(`?before=${page.next}`);
    pages++;
    for (const p of page.pictures) assert.ok(!seen.has(p.id), "no picture twice");
    for (const p of page.pictures) seen.add(p.id);
  }
  assert.equal(pages, 3);
  assert.equal(seen.size, 123, "every picture once");
  const order = (await listed("?limit=100")).pictures.map((p: any) => p.createdAt);
  assert.deepEqual(order, [...order].sort((a, b) => b - a), "newest first");
  assert.equal((await listed("?limit=100")).next !== null, true);

  const mine = await listed("?origin=chat");
  assert.equal(mine.total, 3);
  assert.deepEqual(mine.pictures.map((p: any) => p.chat.title), ["Many", "Many", "Many"]);
  assert.equal((await listed("?origin=page")).total, 120);
  const edited = await listed("?kind=edited&limit=100");
  assert.equal(edited.total, 25);
  assert.ok(edited.pictures.every((p: any) => p.kind === "edited"));
  const both = await listed("?origin=chat&kind=edited");
  assert.equal(both.total, 1);
  assert.equal(both.pictures[0].prompt, "chat 0");
  assert.equal((await listed("?kind=uploaded")).total, 0);
  for (const bad of ["?origin=other", "?kind=nice", "?limit=0", "?limit=101", "?limit=x", "?before=not-a-cursor", "?ids=zzz"]) {
    assert.equal((await call("GET", `/images${bad}`)).status, 400, bad);
  }
  // Only the page that is asked for is made of rows; the pictures of the others are not touched.
  assert.equal((await listed("?limit=1")).pictures.length, 1);
});

test("a picture whose file is gone is dropped when the page looks, and the pictures of a chat go with it, the files staying", async () => {
  getDb().prepare("DELETE FROM images").run();
  const { origin, server } = await answering();
  try {
    settings({ baseUrl: origin, editEnabled: true });
    const first = gallery.addPagePicture({ bytes: png("a"), ext: "png", kind: "generated", prompt: "a", params: {} });
    const second = gallery.addPagePicture({ bytes: png("b"), ext: "png", kind: "edited", prompt: "b", params: { sources: [first.id] }, sourceId: first.id });
    assert.equal((await listed()).total, 2);
    rmSync(path.join(dir, `${first.id}.png`));
    const after = await listed();
    assert.deepEqual(after.pictures.map((p: any) => p.id), [second.id]);
    assert.equal(after.total, 1);
    assert.equal(after.pictures[0].from, null, "the edit no longer points at what is not there");

    const folder = chat("chat-6", "Going");
    const tool: any[] = [];
    new GenerateImageTool(folder, () => [], "chat-6").extension({ registerTool: (t: any) => tool.push(t) });
    const made = await tool[0].execute("id", { prompt: "stays" });
    assert.equal((await listed("?origin=chat")).total, 1);
    deleteSession("chat-6");
    assert.equal((await listed("?origin=chat")).total, 0, "the chat is gone, and so are its places in the gallery");
    assert.equal(existsSync(path.join(folder, made.details.path)), true, "its folder is not the chat's to take away");

    // A folder that cannot be reached for the moment is not a file that is gone.
    const away = chat("chat-7", "Away");
    const t2: any[] = [];
    new GenerateImageTool(away, () => [], "chat-7").extension({ registerTool: (t: any) => t2.push(t) });
    await t2[0].execute("id", { prompt: "kept" });
    const moved = `${away}-moved`;
    renameSync(away, moved);
    assert.equal((await listed("?origin=chat")).total, 1, "kept, to be shown when the folder is back");
    renameSync(moved, away);
    assert.equal((await listed("?origin=chat")).total, 1);
    rmSync(path.join(away, GENERATED_DIR), { recursive: true });
    assert.equal((await listed("?origin=chat")).total, 0, "its file was taken from the folder: it is gone from the gallery");
  } finally {
    server.close();
    gone();
  }
});

test("the page's own requests do not drop a chat's pictures while its folder cannot be reached, and a delete does not say it is done", async () => {
  getDb().prepare("DELETE FROM images").run();
  const { origin, server } = await answering();
  try {
    settings({ baseUrl: origin });
    const away = chat("chat-8", "Offline drive");
    const tool: any[] = [];
    new GenerateImageTool(away, () => [], "chat-8").extension({ registerTool: (t: any) => tool.push(t) });
    const made = await tool[0].execute("id", { prompt: "stays" });
    const id = (await listed("?origin=chat")).pictures[0].id;
    const moved = `${away}-moved`;
    renameSync(away, moved);
    // What every tile of the grid asks for: not found for the moment, and not a reason to forget it.
    assert.equal((await call("GET", `/images/${id}/file`)).status, 404);
    // A delete cannot reach the file, so it does not say the file is gone.
    assert.equal((await call("DELETE", `/images/${id}`)).status, 404);
    const several = await call("POST", "/images/delete", { ids: [id] });
    assert.deepEqual(several.body.deleted, []);
    assert.deepEqual(several.body.failed.map((f: any) => f.id), [id]);
    assert.equal((await listed("?origin=chat")).total, 1, "still listed");
    renameSync(moved, away);
    assert.equal((await listed("?origin=chat")).total, 1, "and still, with the folder back");
    assert.equal((await call("GET", `/images/${id}/file`)).status, 200, "shown again");
    assert.equal(existsSync(path.join(away, made.details.path)), true);
    // A file that is gone from a folder that is there is dropped by a request for it.
    rmSync(path.join(away, made.details.path));
    assert.equal((await call("GET", `/images/${id}/file`)).status, 404);
    assert.equal((await listed("?origin=chat")).total, 0);
    // A chat that is gone: a delete has nothing left to remove.
    getDb().prepare("INSERT INTO images (id, origin, session_id, path, kind, prompt, params, source_id, bytes, created_at) VALUES (?, 'chat', ?, ?, 'generated', 'orphan', '{}', NULL, 1, ?)").run("0000000000aa", "no-such-chat", `${GENERATED_DIR}/x.png`, Date.now());
    assert.equal((await call("DELETE", "/images/0000000000aa")).status, 200);
    assert.equal((await listed("?origin=chat")).total, 0);
  } finally {
    server.close();
    gone();
  }
});

test("a file name that comes back in a chat is a new picture, with its own words, time and links", async () => {
  getDb().prepare("DELETE FROM images").run();
  const folder = chat("chat-9", "Retries");
  mkdirSync(path.join(folder, GENERATED_DIR), { recursive: true });
  const write = (name: string, tag: string) => writeFileSync(path.join(folder, GENERATED_DIR, name), png(tag));
  const record = (over: Partial<Parameters<typeof gallery.recordChatPicture>[0]>) =>
    gallery.recordChatPicture({ sessionId: "chat-9", path: `${GENERATED_DIR}/x-edited.png`, kind: "edited", prompt: "", params: {}, bytes: 70, ...over });
  write("x.png", "x");
  record({ path: `${GENERATED_DIR}/x.png`, kind: "generated", prompt: "the original" });
  write("x-edited.png", "1");
  record({ prompt: "old edit", from: [`${GENERATED_DIR}/x.png`] });
  write("x-edited-edited.png", "2");
  record({ path: `${GENERATED_DIR}/x-edited-edited.png`, prompt: "edit of the old edit", from: [`${GENERATED_DIR}/x-edited.png`] });
  const old = (await listed("?origin=chat")).pictures.find((p: any) => p.prompt === "old edit");
  assert.ok(old);

  // The file was taken away by something that did not tell the list, and an edit of the original makes the name again.
  rmSync(path.join(folder, GENERATED_DIR, "x-edited.png"));
  write("x-edited.png", "3");
  record({ prompt: "new edit", from: [`${GENERATED_DIR}/x.png`], params: { model: "m2" } });
  const all = (await listed("?origin=chat")).pictures;
  const mine = all.filter((p: any) => p.fileName === "x-edited.png");
  assert.equal(mine.length, 1, "one picture for the name");
  assert.equal(mine[0].prompt, "new edit");
  assert.equal(mine[0].params.model, "m2");
  assert.notEqual(mine[0].id, old.id);
  assert.equal(all.some((p: any) => p.id === old.id), false);
  assert.equal(mine[0].from, all.find((p: any) => p.prompt === "the original").id);
  // What was made of the old one is not made of this.
  assert.equal(all.find((p: any) => p.prompt === "edit of the old edit").from, null);
  assert.ok(mine[0].createdAt >= old.createdAt, "it is as new as it is, not as old as the first");
});

test("chats in one folder share its files: a name that comes back replaces the other chat's old row too, and a picture of one is the other's original", async () => {
  getDb().prepare("DELETE FROM images").run();
  const folder = chat("chat-10", "Chat A");
  createSession({ id: "chat-11", title: "Chat B", workspace: folder, executor: "host" });
  const elsewhere = chat("chat-12", "Chat C in another folder");
  mkdirSync(path.join(folder, GENERATED_DIR), { recursive: true });
  const file = `${GENERATED_DIR}/photo-edited.png`;
  const write = (tag: string) => writeFileSync(path.join(folder, file), png(tag));
  const record = (sessionId: string, prompt: string, over: Partial<Parameters<typeof gallery.recordChatPicture>[0]> = {}) =>
    gallery.recordChatPicture({ sessionId, path: file, kind: "edited", prompt, params: {}, bytes: 70, ...over });
  const mine = async () => (await listed("?origin=chat")).pictures.filter((p: any) => p.fileName === "photo-edited.png");

  // Chat A's picture, whose file the person then takes away; chat B makes the name again.
  write("a");
  record("chat-10", "A: make it red");
  rmSync(path.join(folder, file));
  write("b");
  record("chat-11", "B: make it blue");
  const both = await mine();
  assert.equal(both.length, 1, "one file, one picture");
  assert.equal(both[0].prompt, "B: make it blue");
  assert.equal(both[0].chat.title, "Chat B");
  // Deleting it is deleting chat B's file, and that is what the entry says it is.
  assert.equal((await call("DELETE", `/images/${both[0].id}`)).status, 200);
  assert.equal(existsSync(path.join(folder, file)), false);
  assert.equal((await mine()).length, 0);

  // A chat in another folder with the same name is another file, and keeps its row.
  mkdirSync(path.join(elsewhere, GENERATED_DIR), { recursive: true });
  writeFileSync(path.join(elsewhere, file), png("c"));
  record("chat-12", "C: elsewhere");
  write("d");
  record("chat-10", "A again");
  const rows = await mine();
  assert.deepEqual(rows.map((p: any) => p.prompt).sort(), ["A again", "C: elsewhere"]);

  // What chat B edits that chat A made in the shared folder is linked to it.
  writeFileSync(path.join(folder, GENERATED_DIR, "base.png"), png("e"));
  record("chat-10", "the base", { path: `${GENERATED_DIR}/base.png`, kind: "generated" });
  writeFileSync(path.join(folder, GENERATED_DIR, "base-edited.png"), png("f"));
  record("chat-11", "B edits A's", { path: `${GENERATED_DIR}/base-edited.png`, from: [`${GENERATED_DIR}/base.png`] });
  const all = (await listed("?origin=chat")).pictures;
  const base = all.find((p: any) => p.prompt === "the base");
  const edit = all.find((p: any) => p.prompt === "B edits A's");
  assert.equal(edit.from, base.id);
  assert.deepEqual(edit.params.sources, [base.id]);
});

test("deleting a project takes the pictures of every chat that worked in it from the gallery, routine runs too, and no more", async () => {
  getDb().prepare("DELETE FROM images").run();
  const root = mkdtempSync(path.join(temp, "root-"));
  const project = path.join(root, "site");
  const sibling = path.join(root, "site-old");
  for (const dir of [project, sibling]) mkdirSync(path.join(dir, GENERATED_DIR), { recursive: true });
  createSession({ id: "run-1", title: "A run", workspace: project, executor: "host", kind: "routine" });
  createSession({ id: "chat-p", title: "In the project", workspace: project, executor: "host" });
  createSession({ id: "chat-s", title: "In its neighbour", workspace: sibling, executor: "host" });
  for (const [id, dir] of [["run-1", project], ["chat-p", project], ["chat-s", sibling]]) {
    writeFileSync(path.join(dir, GENERATED_DIR, `${id}.png`), png(id));
    gallery.recordChatPicture({ sessionId: id, path: `${GENERATED_DIR}/${id}.png`, kind: "generated", prompt: id, params: {}, bytes: 70 });
  }
  assert.equal((await listed("?origin=chat")).total, 3);
  // The folder goes, as the portal removes a project's: the run's session stays, as the record of what it did.
  rmSync(project, { recursive: true });
  assert.equal((await listed("?origin=chat")).total, 3, "a folder that cannot be reached is kept, since it may be a drive that is not mounted");
  assert.equal(gallery.forgetPicturesIn(project), 2);
  const left = (await listed("?origin=chat")).pictures;
  assert.deepEqual(left.map((p: any) => p.prompt), ["chat-s"], "the neighbour whose name starts the same is another folder");
});

test("a deleted chat's pictures leave the gallery and what was made of them no longer names them", async () => {
  getDb().prepare("DELETE FROM images").run();
  const folder = chat("chat-13", "Going");
  mkdirSync(path.join(folder, GENERATED_DIR), { recursive: true });
  writeFileSync(path.join(folder, GENERATED_DIR, "a.png"), png("a"));
  gallery.recordChatPicture({ sessionId: "chat-13", path: `${GENERATED_DIR}/a.png`, kind: "generated", prompt: "original", params: {}, bytes: 70 });
  const original = (await listed("?origin=chat")).pictures[0];
  const edited = gallery.addPagePicture({ bytes: png("b"), ext: "png", kind: "edited", prompt: "edit", params: { sources: [original.id] }, sourceId: original.id });
  assert.equal((await listed(`?ids=${edited.id}`)).pictures[0].from, original.id);
  deleteSession("chat-13");
  assert.equal((await listed(`?ids=${edited.id}`)).pictures[0].from, null, "no link to what is not in the list");
});

test("the sidebar is told whether the page is there: on while an address is set and the add-on is on", async () => {
  gone();
  gen.saveImageGeneration({ baseUrl: "https://images.example.com/v1" });
  assert.deepEqual((await call("GET", "/features/flags")).body.images, { enabled: false });
  gen.saveImageGeneration({ enabled: true });
  assert.deepEqual((await call("GET", "/features/flags")).body.images, { enabled: true });
  gone();
  // Changing pictures is set up apart from making them, and the page is there for either: the agent's changes are kept in it, and the server edits.
  gen.saveImageGeneration({ baseUrl: "", editEnabled: true, editBaseUrl: "https://edits.example.com/v1" });
  assert.deepEqual((await call("GET", "/features/flags")).body.images, { enabled: true }, "only changing is set up");
  const state = (await call("GET", "/features/images")).body.images;
  assert.equal(state.enabled, false);
  assert.equal(state.editReady, true);
  gen.saveImageGeneration({ editEnabled: false });
  assert.deepEqual((await call("GET", "/features/flags")).body.images, { enabled: false }, "an address for changes that is switched off is not a page");
  gone();
});
