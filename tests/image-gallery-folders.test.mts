import { test, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync, truncateSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

// The gallery lists the pictures that lie in the folders the agent's tools write into, recorded or not. A database from before it did, with its rows, is what these run on.
const temp = realpathSync(mkdtempSync(path.join(tmpdir(), "pitha-folders-")));
after(() => rmSync(temp, { recursive: true, force: true }));
process.env.DATA_DIR = temp;
process.env.SESSION_DIR = path.join(temp, "sessions");
process.env.PI_CODING_AGENT_DIR = path.join(temp, "agent");
process.env.AGENT_HOME = path.join(temp, "agent-home");
process.env.WORKSPACE_ROOT = path.join(temp, "workspaces");
const root = process.env.WORKSPACE_ROOT;
const home = process.env.AGENT_HOME;
mkdirSync(root, { recursive: true });
mkdirSync(home, { recursive: true });

// The first bytes of each kind a browser draws, padded: that is all the check reads. `tag` tells two apart.
const pad = (head: number[] | Buffer, tag = "", to = 64) => Buffer.concat([Buffer.from(head), Buffer.from(tag), Buffer.alloc(to)]);
const png = (tag = "") => pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], tag);
const jpeg = (tag = "") => pad([0xff, 0xd8, 0xff], tag);
const gif = (tag = "") => pad(Buffer.from("GIF89a"), tag);
const webp = (tag = "") => Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.from(tag), Buffer.alloc(16)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

// The portal as it was before: a gallery table without the column for where a picture was found, and a picture of the page in it.
mkdirSync(path.join(temp, "images"), { recursive: true });
writeFileSync(path.join(temp, "images", "a1a1a1a1a1a1.png"), png("old"));
const legacy = new Database(path.join(temp, "portal.db"));
legacy.exec(`
  CREATE TABLE images (
    id TEXT PRIMARY KEY, origin TEXT NOT NULL, session_id TEXT, path TEXT NOT NULL, kind TEXT NOT NULL,
    prompt TEXT NOT NULL DEFAULT '', params TEXT NOT NULL DEFAULT '{}', source_id TEXT, bytes INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX idx_images_chat_file ON images(session_id, path) WHERE session_id IS NOT NULL;
`);
legacy.prepare("INSERT INTO images (id, origin, path, kind, prompt, bytes, created_at) VALUES ('a1a1a1a1a1a1', 'page', 'a1a1a1a1a1a1.png', 'generated', 'from before', 68, 1000)").run();
legacy.close();

const express = (await import("express")).default;
const gallery = await import("../server/src/image-gallery.ts");
const { imagesRouter } = await import("../server/src/api/images.ts");
const { createSession, deleteSession, getDb } = await import("../server/src/db.ts");
const { GENERATED_DIR } = gallery;

const app = express().use(express.json({ limit: "2mb" })).use("/api", imagesRouter());
const portal = app.listen(0, "127.0.0.1");
await new Promise((r) => portal.once("listening", r));
after(() => portal.close());
const at = `http://127.0.0.1:${(portal.address() as { port: number }).port}/api`;
const call = async (method: string, p: string, body?: unknown) => {
  const r = await fetch(`${at}${p}`, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const bytes = Buffer.from(await r.arrayBuffer());
  const type = r.headers.get("content-type") ?? "";
  return { status: r.status, headers: r.headers, bytes, body: type.includes("json") ? JSON.parse(bytes.toString("utf8")) : undefined };
};
const listed = async (query = "") => (await call("GET", `/images${query ? `${query}&` : "?"}limit=100`)).body;
const names = (list: any) => list.pictures.map((p: any) => p.fileName).sort();

/** A project: a folder under the workspace root, with a folder of generated pictures if asked. */
const project = (name: string, generated = true) => {
  const folder = path.join(root, name);
  mkdirSync(generated ? path.join(folder, GENERATED_DIR) : folder, { recursive: true });
  return folder;
};
/** A file in a folder's generated pictures, made at a time. */
const put = (folder: string, name: string, bytes: Buffer = png(name), time?: number) => {
  mkdirSync(path.join(folder, GENERATED_DIR), { recursive: true });
  const file = path.join(folder, GENERATED_DIR, name);
  writeFileSync(file, bytes);
  if (time !== undefined) utimesSync(file, time / 1000, time / 1000);
  return file;
};
const chatIn = (id: string, workspace: string, title = id) => createSession({ id, title, workspace, executor: "host" });
const T = Date.UTC(2026, 0, 2, 12, 0, 0);

test("a database from before the gallery knew where pictures were found is carried on, with its rows, and kept to one place for each file", async () => {
  const columns = (getDb().prepare("PRAGMA table_info(images)").all() as { name: string }[]).map((c) => c.name);
  assert.ok(columns.includes("folder"));
  assert.deepEqual((getDb().prepare("SELECT id, prompt FROM images").all() as any[]).map((r) => r.prompt), ["from before"]);
  const row = (id: string) =>
    getDb().prepare("INSERT INTO images (id, origin, session_id, folder, path, kind, created_at) VALUES (?, 'folder', NULL, '/some/folder', 'generated-images/x.png', 'unknown', 1)").run(id);
  row("b1b1b1b1b1b1");
  assert.throws(() => row("b2b2b2b2b2b2"), /UNIQUE/, "the same file of the same folder is one picture");
  getDb().prepare("DELETE FROM images WHERE origin = 'folder'").run();
  const listing = await listed();
  assert.deepEqual(listing.pictures.map((p: any) => [p.id, p.origin, p.folder, p.prompt]), [["a1a1a1a1a1a1", "page", null, "from before"]]);
});

test("every picture in the folders the tools write into is listed, recorded or not, and nothing else is", async () => {
  const alpha = project("alpha");
  const gamma = project("gamma", false);
  const outside = path.join(temp, "outside");
  mkdirSync(path.join(outside, "pictures"), { recursive: true });
  writeFileSync(path.join(outside, "secret.png"), png("secret"));
  writeFileSync(path.join(outside, "pictures", "linked-dir.png"), png("linked-dir"));

  // What is a picture of the folder: by its bytes, whatever it is called, of each kind a browser draws.
  put(alpha, "image-20260102-120000-abc123.png", png("g"), T);
  put(alpha, "photo-edited.png", png("e"), T + 1000);
  put(alpha, "holiday.jpg", jpeg("j"), T + 2000);
  put(alpha, "movie.gif", gif("m"), T + 3000);
  put(alpha, "no extension", webp("w"), T + 4000);
  put(alpha, "disguised.txt", png("d"), T + 5000);
  put(alpha, "image-20260102-120500-aaa111-edited (2).png", png("ee"), T + 6000);
  // What is not: no picture by its bytes, an empty file, a hidden one (what is half written is called so), one too large for a picture.
  put(alpha, "notes.txt", Buffer.from("hello"));
  put(alpha, "fake.png", Buffer.from("<html><script>alert(1)</script></html>"));
  put(alpha, "vector.svg", SVG);
  put(alpha, "empty.png", Buffer.alloc(0));
  put(alpha, ".half-written.upload", png("half"));
  truncateSync(put(alpha, "huge.png", png("huge")), 26 * 1024 * 1024);
  // Links: one out of the folder to a picture, one to a picture in it, one to a folder with pictures.
  symlinkSync(path.join(outside, "secret.png"), path.join(alpha, GENERATED_DIR, "linked.png"));
  symlinkSync(path.join(alpha, GENERATED_DIR, "photo-edited.png"), path.join(alpha, GENERATED_DIR, "alias.png"));
  symlinkSync(path.join(outside, "pictures"), path.join(gamma, GENERATED_DIR));
  // Not where the tools write: beside the folder, below it, and in a folder of the workspace that no chat works in.
  writeFileSync(path.join(alpha, "loose.png"), png("loose"));
  mkdirSync(path.join(alpha, GENERATED_DIR, "sub"));
  writeFileSync(path.join(alpha, GENERATED_DIR, "sub", "deep.png"), png("deep"));
  put(path.join(alpha, "work"), "stray.png", png("stray"), T - 5000);
  // A chat's folder outside the workspace is not one either.
  const elsewhere = path.join(temp, "elsewhere");
  chatIn("chat-elsewhere", elsewhere);
  mkdirSync(elsewhere, { recursive: true });
  put(elsewhere, "image-20260102-110000-eee555.png", png("elsewhere"));
  // And Home, which every chat without a project works in.
  chatIn("chat-home", home, "In Home");
  put(home, "image-20260102-130000-def456.png", png("home"), T + 7000);
  // The folder of a chat that works in a folder of a project is looked in as well.
  chatIn("chat-work", path.join(alpha, "work"), "In work");

  const found = await listed("?origin=folder");
  assert.deepEqual(names(found), [
    "disguised.txt",
    "holiday.jpg",
    "image-20260102-120000-abc123.png",
    "image-20260102-120500-aaa111-edited (2).png",
    "image-20260102-130000-def456.png",
    "movie.gif",
    "no extension",
    "photo-edited.png",
    "stray.png",
  ]);
  assert.equal(found.total, 9);
  const by = (name: string) => found.pictures.find((p: any) => p.fileName === name);
  // The kind is told by the name the tools give: nothing else tells, and nothing is guessed.
  assert.equal(by("image-20260102-120000-abc123.png").kind, "generated");
  assert.equal(by("photo-edited.png").kind, "edited");
  assert.equal(by("image-20260102-120500-aaa111-edited (2).png").kind, "edited");
  for (const unknown of ["holiday.jpg", "movie.gif", "no extension", "disguised.txt", "stray.png"]) assert.equal(by(unknown).kind, "unknown", unknown);
  // Where it was found, which chat made it is not known, and nothing was asked of anybody.
  for (const p of found.pictures) {
    assert.equal(p.origin, "folder");
    assert.equal(p.chat, null);
    assert.equal(p.prompt, "");
    assert.deepEqual(p.params, {});
    assert.equal(p.from, null);
  }
  assert.deepEqual(by("holiday.jpg").folder, { name: "alpha", home: false });
  assert.deepEqual(by("stray.png").folder, { name: "alpha/work", home: false }, "the way to a folder a chat works in, under the root");
  assert.deepEqual(by("image-20260102-130000-def456.png").folder, { name: "", home: true });
  // When it was made is when its file was written, and what it weighs is what it does.
  assert.equal(by("image-20260102-120000-abc123.png").createdAt, T);
  assert.equal(by("movie.gif").bytes, gif("m").length);
  assert.equal(by("image-20260102-130000-def456.png").fileName, "image-20260102-130000-def456.png");
  // Newest first, with the page's own picture among them by its time.
  const everything = await listed();
  assert.equal(everything.total, 10);
  assert.equal(everything.pictures[0].fileName, "image-20260102-130000-def456.png");
  assert.equal(everything.pictures.at(-1).id, "a1a1a1a1a1a1");

  // Listed again, not listed again: the same pictures under the same ids, and nothing new is made of them.
  const ids = found.pictures.map((p: any) => p.id).sort();
  assert.deepEqual((await listed("?origin=folder")).pictures.map((p: any) => p.id).sort(), ids);
  assert.equal(gallery.scanFolders(), 0);
  assert.equal((getDb().prepare("SELECT COUNT(*) AS n FROM images WHERE origin = 'folder'").get() as { n: number }).n, 9);

  // The filters know them.
  assert.equal((await listed("?origin=chat")).total, 0);
  assert.equal((await listed("?origin=page")).total, 1);
  assert.deepEqual(names(await listed("?kind=unknown")), ["disguised.txt", "holiday.jpg", "movie.gif", "no extension", "stray.png"]);
  assert.deepEqual(names(await listed("?origin=folder&kind=generated")), ["image-20260102-120000-abc123.png", "image-20260102-130000-def456.png"]);
  assert.deepEqual(names(await listed("?origin=folder&kind=edited")), ["image-20260102-120500-aaa111-edited (2).png", "photo-edited.png"]);
  assert.equal((await call("GET", "/images?kind=nice")).status, 400);
  assert.equal((await call("GET", "/images?origin=nowhere")).status, 400);
});

test("a picture that was found is shown and sent as any picture is, by its bytes, and is only ever read through its folder", async () => {
  const found = (await listed("?origin=folder")).pictures;
  const jpg = found.find((p: any) => p.fileName === "holiday.jpg");
  const shown = await call("GET", `/images/${jpg.id}/file`);
  assert.equal(shown.status, 200);
  assert.equal(shown.headers.get("content-type"), "image/jpeg");
  assert.ok(shown.bytes.equals(jpeg("j")));
  assert.equal(shown.headers.get("cache-control"), "private, no-cache", "a file of a folder can change, unlike the page's own");
  // Called a text file, drawn as what it is.
  const disguised = found.find((p: any) => p.fileName === "disguised.txt");
  assert.equal((await call("GET", `/images/${disguised.id}/file`)).headers.get("content-type"), "image/png");
  assert.equal((await call("GET", `/images?ids=${jpg.id}`)).body.pictures[0].folder.name, "alpha");

  // Rows that name anything else are not served, whatever wrote them: a folder that is not Home or in the root, a path that leaves the folder, one that is not under the tools' folder.
  const row = (id: string, folder: string, rel: string) =>
    getDb().prepare("INSERT INTO images (id, origin, session_id, folder, path, kind, bytes, created_at) VALUES (?, 'folder', NULL, ?, ?, 'unknown', 70, ?)").run(id, folder, rel, T);
  writeFileSync(path.join(temp, "outside", "secret2.png"), png("secret2"));
  row("c1c1c1c1c1c1", path.join(temp, "outside"), "generated-images/secret.png");
  row("c2c2c2c2c2c2", path.join(root, "alpha"), "generated-images/../../outside/secret.png");
  row("c3c3c3c3c3c3", path.join(root, "alpha"), "loose.png");
  row("c4c4c4c4c4c4", path.join(root, "alpha"), "generated-images/linked.png");
  row("c5c5c5c5c5c5", temp, "generated-images/x.png");
  for (const id of ["c1c1c1c1c1c1", "c2c2c2c2c2c2", "c3c3c3c3c3c3", "c4c4c4c4c4c4", "c5c5c5c5c5c5"]) {
    const r = await call("GET", `/images/${id}/file`);
    assert.notEqual(r.status, 200, id);
    assert.ok(![png("secret"), png("secret2"), png("loose")].some((b) => r.bytes.equals(b)), `${id} gave a file from outside`);
  }
  // Nor is one of them listed again, and a delete takes nothing from anywhere else.
  const after = (await listed()).pictures.map((p: any) => p.id);
  for (const id of ["c1c1c1c1c1c1", "c2c2c2c2c2c2", "c3c3c3c3c3c3", "c4c4c4c4c4c4", "c5c5c5c5c5c5"]) assert.ok(!after.includes(id), `${id} is not listed`);
  for (const id of ["c1c1c1c1c1c1", "c2c2c2c2c2c2", "c3c3c3c3c3c3", "c4c4c4c4c4c4", "c5c5c5c5c5c5"]) await call("DELETE", `/images/${id}`);
  assert.equal(existsSync(path.join(temp, "outside", "secret.png")), true);
  assert.equal(existsSync(path.join(root, "alpha", "loose.png")), true);
});

test("a picture that was found and a picture that was recorded are one picture, whichever came first", async () => {
  const beta = project("beta");
  chatIn("chat-beta", beta, "Beta chat");
  // Found first: the page looks between the tool saving the file and saying so.
  const first = "image-20260102-140000-111111.png";
  put(beta, first, png("first"), T);
  const looked = (await listed("?origin=folder")).pictures.filter((p: any) => p.fileName === first);
  assert.equal(looked.length, 1);
  gallery.recordChatPicture({ sessionId: "chat-beta", path: `${GENERATED_DIR}/${first}`, kind: "generated", prompt: "a fox", params: { size: "512x512" }, bytes: 70 });
  const now = (await listed()).pictures.filter((p: any) => p.fileName === first);
  assert.equal(now.length, 1, "the same file is one entry");
  assert.equal(now[0].origin, "chat");
  assert.equal(now[0].prompt, "a fox");
  assert.deepEqual(now[0].chat, { id: "chat-beta", title: "Beta chat" });
  assert.equal(now[0].folder, null);
  assert.ok(!(await listed()).pictures.some((p: any) => p.id === looked[0].id), "the entry that was found is replaced");
  // Recorded first: nothing is made of it again.
  const second = "image-20260102-141000-222222.png";
  put(beta, second, png("second"), T + 1000);
  gallery.recordChatPicture({ sessionId: "chat-beta", path: `${GENERATED_DIR}/${second}`, kind: "generated", prompt: "a bear", params: {}, bytes: 70 });
  assert.equal(gallery.scanFolders(), 0);
  assert.equal((await listed()).pictures.filter((p: any) => p.fileName === second).length, 1);
  assert.equal((await listed("?origin=folder")).pictures.filter((p: any) => [first, second].includes(p.fileName)).length, 0);
  // An edit of a picture that was found is tied to it.
  const original = "shot.png";
  put(beta, original, png("shot"), T + 2000);
  const photo = (await listed("?origin=folder")).pictures.find((p: any) => p.fileName === original);
  put(beta, "shot-edited.png", png("shot-edited"), T + 3000);
  gallery.recordChatPicture({ sessionId: "chat-beta", path: `${GENERATED_DIR}/shot-edited.png`, kind: "edited", prompt: "night", params: {}, from: [`${GENERATED_DIR}/${original}`], bytes: 70 });
  const edit = (await listed("?kind=edited")).pictures.find((p: any) => p.fileName === "shot-edited.png");
  assert.equal(edit.from, photo.id);
  assert.deepEqual(edit.params.sources, [photo.id]);
  // A chat that goes takes its recorded pictures; the files are still in the folder the page looks in, and are found again as the folder's.
  deleteSession("chat-beta");
  const back = (await listed()).pictures.filter((p: any) => [first, second, "shot-edited.png"].includes(p.fileName));
  assert.deepEqual(back.map((p: any) => [p.fileName, p.origin, p.kind]).sort(), [
    [first, "folder", "generated"],
    [second, "folder", "generated"],
    ["shot-edited.png", "folder", "edited"],
  ].sort());
  assert.ok(back.every((p: any) => p.prompt === "" && p.chat === null));
});

test("what goes from a folder goes from the gallery, and what comes into it comes into the gallery", async () => {
  const delta = project("delta");
  const a = put(delta, "a.png", png("a"), T);
  const b = put(delta, "b.png", png("b"), T + 1000);
  const c = put(delta, "c.png", png("c"), T + 2000);
  const mine = async () => names({ pictures: (await listed("?origin=folder")).pictures.filter((p: any) => p.folder?.name === "delta") });
  assert.deepEqual(await mine(), ["a.png", "b.png", "c.png"]);
  // Taken by hand, or turned into a link out of the folder: not shown, and nothing is served from it.
  const id = (await listed("?origin=folder")).pictures.find((p: any) => p.fileName === "b.png").id;
  rmSync(a);
  rmSync(b);
  symlinkSync(path.join(temp, "outside", "secret.png"), b);
  assert.deepEqual(await mine(), ["c.png"], "a link is no picture of the folder, found or not");
  assert.equal((await call("GET", `/images/${id}/file`)).status, 404);
  rmSync(b);
  // A file that went between the look and the open is no failure of the list either: the row names a file that is not there.
  getDb().prepare("INSERT INTO images (id, origin, session_id, folder, path, kind, bytes, created_at) VALUES ('d1d1d1d1d1d1', 'folder', NULL, ?, 'generated-images/vanished.png', 'unknown', 70, ?)").run(delta, T);
  assert.equal((await call("GET", "/images/d1d1d1d1d1d1/file")).status, 404);
  assert.deepEqual((await call("GET", "/images?ids=d1d1d1d1d1d1")).body.pictures, [], "dropped when it was asked for");

  // What is no picture is not opened again until it changes; then it is looked at again.
  const late = put(delta, "late.png", Buffer.from("x".repeat(70)), T + 3000);
  assert.deepEqual(await mine(), ["c.png"]);
  writeFileSync(late, png("late").subarray(0, 70));
  utimesSync(late, (T + 3000) / 1000, (T + 3000) / 1000);
  assert.deepEqual(await mine(), ["c.png"], "the file is as it was, to the size and the minute: it is not opened again");
  utimesSync(late, (T + 4000) / 1000, (T + 4000) / 1000);
  assert.deepEqual(await mine(), ["c.png", "late.png"], "changed: looked at again");
  // New files appear as they are made.
  put(delta, "image-20260102-150000-333333.png", png("new"), T + 5000);
  assert.deepEqual(await mine(), ["c.png", "image-20260102-150000-333333.png", "late.png"]);

  // A folder that is not there or cannot be read is no failure of the gallery, and its pictures are not kept as its chat's are: they are found again with it.
  const away = path.join(temp, "away");
  mkdirSync(away);
  renameSync(delta, path.join(away, "delta"));
  assert.deepEqual(await mine(), []);
  assert.equal((await call("GET", "/images?limit=1")).status, 200);
  renameSync(path.join(away, "delta"), delta);
  assert.deepEqual(await mine(), ["c.png", "image-20260102-150000-333333.png", "late.png"]);
  if (process.getuid?.() !== 0) {
    chmodSync(path.join(delta, GENERATED_DIR), 0);
    try {
      assert.equal((await call("GET", "/images?limit=1")).status, 200);
    } finally {
      chmodSync(path.join(delta, GENERATED_DIR), 0o755);
    }
  }
  // Deleted with its project: the folder goes, and so do the pictures found in it.
  rmSync(delta, { recursive: true });
  assert.deepEqual(await mine(), []);
  assert.equal(existsSync(c), false);
});

test("a picture that was found is deleted from its folder on purpose, one at a time or with others, and stays deleted", async () => {
  const epsilon = project("epsilon");
  const keep = put(epsilon, "keep.png", png("keep"), T);
  const one = put(epsilon, "one.png", png("one"), T + 1000);
  const two = put(epsilon, "two.png", png("two"), T + 2000);
  const three = put(epsilon, "three.png", png("three"), T + 3000);
  const pictures = (await listed("?origin=folder")).pictures.filter((p: any) => p.folder?.name === "epsilon");
  const id = (name: string) => pictures.find((p: any) => p.fileName === name).id;
  assert.equal((await call("DELETE", `/images/${id("one.png")}`)).status, 200);
  assert.equal(existsSync(one), false, "the file is taken from the folder");
  const several = await call("POST", "/images/delete", { ids: [id("two.png"), id("three.png")] });
  assert.deepEqual(several.body.deleted.sort(), [id("two.png"), id("three.png")].sort());
  assert.equal(existsSync(two) || existsSync(three), false);
  assert.equal(existsSync(keep), true);
  assert.deepEqual(names({ pictures: (await listed("?origin=folder")).pictures.filter((p: any) => p.folder?.name === "epsilon") }), ["keep.png"], "not found again");
  // One whose file went by hand is as good as deleted.
  rmSync(keep);
  assert.equal((await call("DELETE", `/images/${id("keep.png")}`)).status, 200);
});

test("a gallery of hundreds in a folder is listed once and paged, and looking again is a read of the names", async () => {
  const many = project("many");
  for (let i = 0; i < 300; i++) put(many, `image-20260102-1${String(i).padStart(5, "0")}-${i.toString(16).padStart(6, "0")}.png`, png(`m${i}`), T + i * 1000);
  const first = await listed("?origin=folder");
  assert.equal(first.total >= 300, true);
  assert.equal(first.pictures.length, 100);
  assert.ok(first.next);
  let all = first.pictures.length;
  let page = first;
  while (page.next) {
    page = (await call("GET", `/images?origin=folder&limit=100&before=${page.next}`)).body;
    all += page.pictures.length;
  }
  assert.equal(all, first.total, "every one once");
  const before = (getDb().prepare("SELECT COUNT(*) AS n FROM images").get() as { n: number }).n;
  assert.equal(gallery.scanFolders(), 0);
  assert.equal((getDb().prepare("SELECT COUNT(*) AS n FROM images").get() as { n: number }).n, before);
});
