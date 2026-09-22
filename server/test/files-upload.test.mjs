import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const home = mkdtempSync(path.join(tmpdir(), "pithagoras-upload-"));
process.env.DATA_DIR = home;
process.env.WORKSPACE_ROOT = path.join(home, "ws");
process.env.PI_CODING_AGENT_DIR = path.join(home, "agent");
mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });

const { default: express } = await import("express");
const { filesRouter } = await import("../dist/api/files.js");
const { createSession } = await import("../dist/db.js");
const { numbered, writeText, baseDir } = await import("../dist/workspace-files.js");

const work = path.join(home, "work");
const outside = path.join(home, "outside");
mkdirSync(work);
mkdirSync(outside);
createSession({ id: "up", title: "up", workspace: work, executor: "host" });

async function withApi(fn) {
  const app = express();
  // As the portal does: an upload is not parsed, whatever type it says it is.
  app.use((req, res, next) => (req.path.endsWith("/upload") ? next() : express.json()(req, res, next)));
  app.use("/api", filesRouter());
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/sessions/up`;
  try {
    await fn(base);
  } finally {
    server.close();
  }
}

const upload = (base, dir, name, body, type = "application/octet-stream") =>
  fetch(`${base}/upload?path=${encodeURIComponent(dir)}&name=${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "Content-Type": type },
    body,
  }).then(async (r) => ({ status: r.status, ...(await r.json()) }));

test("an upload lands whole, and a taken name gets a number instead of replacing", async () => {
  await withApi(async (base) => {
    const first = await upload(base, "", "report.pdf", "one");
    assert.deepEqual([first.status, first.path, first.size], [200, "report.pdf", 3]);
    const second = await upload(base, "", "report.pdf", "two");
    assert.equal(second.path, "report (2).pdf");
    assert.equal(readFileSync(path.join(work, "report.pdf"), "utf8"), "one");
    assert.equal(readFileSync(path.join(work, "report (2).pdf"), "utf8"), "two");
    // A .json file is a file, not a request body to read.
    const json = await upload(base, "", "data.json", '{"a":1}', "application/json");
    assert.equal(readFileSync(path.join(work, json.path), "utf8"), '{"a":1}');
    // Nothing half-written is left behind.
    assert.deepEqual(readdirSync(work).filter((n) => n.endsWith(".upload")), []);
  });
});

test("an upload cannot be sent out of the folder, by path or by name", async () => {
  symlinkSync(outside, path.join(work, "escape"));
  await withApi(async (base) => {
    assert.equal((await upload(base, "..", "x.txt", "x")).status, 400);
    assert.equal((await upload(base, "escape", "x.txt", "x")).status, 400);
    assert.equal((await upload(base, "", "../x.txt", "x")).status, 400);
    assert.equal((await upload(base, "", "..", "x")).status, 400);
    assert.equal((await upload(base, "missing", "x.txt", "x")).status, 404);
  });
  assert.deepEqual(readdirSync(outside), []);
});

test("a new folder is made once, and a new file never replaces one", async () => {
  await withApi(async (base) => {
    const post = (url, body) =>
      fetch(base + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(
        async (r) => ({ status: r.status, ...(await r.json()) }),
      );
    const made = await post("/folder?path=", { name: "notes" });
    assert.equal(made.path, "notes");
    assert.equal((await post("/folder?path=", { name: "notes" })).status, 409);
    assert.equal((await post("/folder?path=", { name: "a/b" })).status, 400);

    writeFileSync(path.join(work, "notes", "keep.md"), "mine");
    const put = (body) =>
      fetch(`${base}/file?path=notes/keep.md`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await put({ content: "", create: true })).status, 409);
    assert.equal(readFileSync(path.join(work, "notes", "keep.md"), "utf8"), "mine");
  });
  // And one that is not there is made.
  writeText(baseDir(work), "notes/new.md", "", undefined, true);
  assert.ok(existsSync(path.join(work, "notes", "new.md")));
});

test("numbers go before the extension, and on the end without one", () => {
  assert.equal(numbered("a.txt", 1), "a.txt");
  assert.equal(numbered("a.tar.gz", 2), "a.tar (2).gz");
  assert.equal(numbered("Makefile", 3), "Makefile (3)");
  assert.equal(numbered(".env", 2), ".env (2)");
});
