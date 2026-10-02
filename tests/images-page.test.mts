import test from "node:test";
import assert from "node:assert/strict";
import { appendPage, fieldsOf, fieldsText, madeButNotListed, mergeTop, parseFields, readFilter, readForm, sameList, tiles, typed, viewerList, viewerPicture } from "../web/src/images-gallery.ts";
import type { GalleryPicture, PictureJob } from "../web/src/api.ts";

let n = 0;
const picture = (over: Partial<GalleryPicture> = {}): GalleryPicture => {
  n++;
  return { id: n.toString(16).padStart(12, "0"), origin: "page", chat: null, folder: null, kind: "generated", prompt: `p${n}`, params: {}, from: null, createdAt: 1000 + n, bytes: 1, fileName: `f${n}.png`, ...over };
};
/** A list as the server gives it: newest first. */
const newestFirst = (...p: GalleryPicture[]) => [...p].sort((a, b) => b.createdAt - a.createdAt);
const ids = (p: { id: string }[]) => p.map((x) => x.id);
const job = (over: Partial<PictureJob> = {}): PictureJob => ({ id: `j${++n}`, kind: "generate", state: "running", prompt: "j", startedAt: 5000 + n, ...over });

test("the filters are read from the address, and what is not a filter is none", () => {
  assert.deepEqual(readFilter(new URLSearchParams("origin=chat&kind=edited")), { origin: "chat", kind: "edited" });
  assert.deepEqual(readFilter(new URLSearchParams("kind=uploaded")), { kind: "uploaded" });
  assert.deepEqual(readFilter(new URLSearchParams("origin=folder&kind=unknown")), { origin: "folder", kind: "unknown" });
  assert.deepEqual(readFilter(new URLSearchParams("origin=elsewhere&kind=nonsense&other=1")), {});
  assert.deepEqual(readFilter(new URLSearchParams("")), {});
});

test("the top of the list asked for again takes the place of the head, and keeps what was loaded further down", () => {
  const all = Array.from({ length: 10 }, () => picture());
  const sorted = newestFirst(...all);
  // Loaded: the newest six. A page is four.
  const loaded = sorted.slice(0, 6);
  const fresh = picture();
  const page = { pictures: [fresh, ...sorted.slice(0, 3)], next: "more" };
  const merged = mergeTop(loaded, page);
  assert.deepEqual(ids(merged), [fresh.id, ...ids(sorted.slice(0, 3)), ...ids(sorted.slice(3, 6))]);
});

test("a picture taken away from the head goes from what is shown, and one deeper down stays where it is", () => {
  const sorted = newestFirst(...Array.from({ length: 8 }, () => picture()));
  const loaded = sorted.slice(0, 7);
  // The second newest was deleted; the page has the next three after it.
  const page = { pictures: [sorted[0], ...sorted.slice(2, 4)], next: "more" };
  assert.deepEqual(ids(mergeTop(loaded, page)), [sorted[0].id, ...ids(sorted.slice(2, 7))]);
});

test("a picture that came back as it was is the one that was shown, and one that changed is the new one", () => {
  const sorted = newestFirst(...Array.from({ length: 3 }, () => picture()));
  // The same pictures, made again from what the server said, as a second answer is.
  const answer = sorted.map((p) => JSON.parse(JSON.stringify(p)) as GalleryPicture);
  const merged = mergeTop(sorted, { pictures: answer, next: null });
  assert.ok(sameList(merged, sorted));
  answer[1].prompt = "changed";
  const again = mergeTop(sorted, { pictures: answer, next: null });
  assert.equal(again[0], sorted[0]);
  assert.equal(again[1], answer[1]);
  assert.equal(sameList(again, sorted), false);
});

test("a list that fits in the fresh page is that page", () => {
  const sorted = newestFirst(...Array.from({ length: 4 }, () => picture()));
  assert.deepEqual(ids(mergeTop(sorted, { pictures: sorted.slice(0, 3), next: null })), ids(sorted.slice(0, 3)));
  assert.deepEqual(mergeTop(sorted, { pictures: [], next: null }), []);
});

test("a page loaded further down joins the end, and what was already there is not drawn twice", () => {
  const sorted = newestFirst(...Array.from({ length: 6 }, () => picture()));
  assert.deepEqual(ids(appendPage(sorted.slice(0, 3), sorted.slice(2, 6))), ids(sorted));
});

test("an original that is further down than the gallery has gone is put in the viewer's list after the first edit that names it", () => {
  const original = picture();
  const other = picture();
  const edit = picture({ kind: "edited", from: original.id });
  const again = picture({ kind: "edited", from: original.id });
  const loaded = [again, edit, other];
  const list = viewerList(loaded, new Map([[original.id, original]]));
  assert.deepEqual(ids(list), [again.id, original.id, edit.id, other.id]);
  // Not twice, and not at all when it is not known or is loaded.
  assert.deepEqual(ids(viewerList(loaded, new Map())), ids(loaded));
  assert.deepEqual(ids(viewerList([...loaded, original], new Map([[original.id, original]]))), [...ids(loaded), original.id]);
});

test("the viewer is given a picture's file, its description and where it was made from", () => {
  const original = picture();
  const edit = picture({ kind: "edited", from: original.id, prompt: "make it blue", fileName: "blue.png" });
  assert.deepEqual(viewerPicture(edit, (id) => `/f/${id}`), { id: edit.id, src: `/f/${edit.id}`, alt: "make it blue", caption: "make it blue", fileName: "blue.png", from: original.id });
  // Nothing said of it: the file's name is what a screen reader has, and there is no caption.
  const bare = viewerPicture(picture({ prompt: "", fileName: "x.png" }), (id) => id);
  assert.equal(bare.alt, "x.png");
  assert.equal("caption" in bare, false);
  assert.equal("from" in bare, false);
});

test("the grid has the jobs that have no picture first, newest first, and then the gallery; a job whose picture is loaded holds that picture's place and the picture is not drawn twice", () => {
  const a = picture();
  const b = picture();
  const running = job({ startedAt: 100 });
  const failed = job({ state: "failed", startedAt: 300, error: "no" });
  const done = job({ state: "done", startedAt: 200, pictureId: a.id });
  const all = tiles([b, a], [running, failed, done], {});
  assert.deepEqual(all.map((t) => t.key), [`job:${failed.id}`, `job:${running.id}`, b.id, `job:${done.id}`]);
  assert.equal(all[3].picture?.id, a.id);
  // A job that is done and whose picture the list has not got yet still has its place in front, and the picture to show from the job.
  const early = tiles([b], [job({ state: "done", pictureId: "0000000000ff" })], {});
  assert.equal(early[0].picture, undefined);
  assert.equal(early[0].job?.pictureId, "0000000000ff");
});

test("a picture made on the page does not stay above pictures that came after it: the grid is in the order the viewer steps through", () => {
  const made = picture();
  const uploaded = picture({ kind: "uploaded" });
  const fromChat = picture({ origin: "chat", chat: { id: "c", title: "t" } });
  const done = job({ state: "done", pictureId: made.id });
  // The server's order: newest first, and the one made on the page is the oldest.
  const list = newestFirst(made, uploaded, fromChat);
  const all = tiles(list, [done], {});
  assert.deepEqual(ids(all.map((t) => t.picture!)), ids(viewerList(list, new Map())));
  assert.equal(all[all.length - 1].key, `job:${done.id}`, "it keeps its tile, and the place the list has for it");
  // The same tile from when it was being made to when it is in the list, so that it is not drawn again.
  const waiting = tiles([uploaded, fromChat], [done], {});
  assert.equal(waiting[0].key, `job:${done.id}`);
});

test("a picture that was deleted is not shown by its job, and a done job without one is nothing to show", () => {
  const a = picture();
  const done = job({ state: "done", pictureId: a.id });
  assert.deepEqual(tiles([a], [done], {}, new Set([a.id])).map((t) => t.key), [a.id]);
  assert.deepEqual(tiles([], [done], {}, new Set([a.id])), []);
  assert.deepEqual(tiles([], [job({ state: "done" })], {}), []);
});

test("a filter leaves out the jobs that make what it does not show", () => {
  const generating = job({ kind: "generate" });
  const editing = job({ kind: "edit" });
  const keys = (filter: Parameters<typeof tiles>[2]) => tiles([], [generating, editing], filter).map((t) => t.job?.kind);
  // Newest first: the edit was started after.
  assert.deepEqual(keys({}), ["edit", "generate"]);
  assert.deepEqual(keys({ kind: "edited" }), ["edit"]);
  assert.deepEqual(keys({ kind: "generated" }), ["generate"]);
  assert.deepEqual(keys({ kind: "uploaded" }), []);
  // What the page makes is of the page, not of a chat.
  assert.deepEqual(keys({ origin: "chat" }), []);
  assert.deepEqual(keys({ origin: "folder" }), []);
  assert.deepEqual(keys({ kind: "unknown" }), [], "what is made here is never one nothing is known of");
  assert.deepEqual(keys({ origin: "page", kind: "edited" }), ["edit"]);
});

test("a picture that a job made and the list has not got is asked for, unless the filter leaves the job out or it was deleted here", () => {
  const listed = picture();
  const there = job({ state: "done", pictureId: listed.id });
  const lost = job({ state: "done", pictureId: "0000000000aa" });
  const edit = job({ state: "done", kind: "edit", pictureId: "0000000000bb" });
  const removed = job({ state: "done", pictureId: "0000000000cc" });
  const running = job();
  const all = [there, lost, edit, removed, running, job({ state: "failed", error: "no" }), job({ state: "done" })];
  const have = new Set([listed.id]);
  assert.deepEqual(madeButNotListed(all, have, new Set(["0000000000cc"]), {}), ["0000000000aa", "0000000000bb"]);
  // What a filter does not show is not of the list it is looked for in.
  assert.deepEqual(madeButNotListed(all, have, new Set(["0000000000cc"]), { kind: "edited" }), ["0000000000bb"]);
  assert.deepEqual(madeButNotListed(all, have, new Set(), { origin: "chat" }), []);
});

test("extra fields are read one to a line, with what is wrong with a line said by its number", () => {
  assert.deepEqual(parseFields("quality=high\n\n  seed = 42 \nstyle=\"natural\"\r\nnote=a=b"), { fields: { quality: "high", seed: "42", style: '"natural"', note: "a=b" } });
  assert.deepEqual(parseFields(""), { fields: {} });
  assert.deepEqual(parseFields("quality=high\nnonsense"), { error: "missing", line: 2 });
  assert.deepEqual(parseFields("=value"), { error: "missing", line: 1 });
  assert.deepEqual(parseFields("a=1\nb=2\na=3"), { error: "twice", line: 3 });
  // A name that is also on the object's prototype is a name like another.
  assert.deepEqual(parseFields("constructor=1"), { fields: { constructor: "1" } });
  assert.deepEqual(Object.keys(parseFields("__proto__=1").fields ?? {}), ["__proto__"]);
});

test("extra fields read back as they were sent: text that looks like a number or a switch keeps its quotes", () => {
  assert.equal(typed("high"), "high");
  assert.equal(typed("42"), '"42"');
  assert.equal(typed("true"), '"true"');
  assert.equal(typed(42), "42");
  assert.equal(typed(1.5), "1.5");
  assert.equal(typed(false), "false");
  assert.deepEqual(fieldsOf({ quality: "high", seed: "42", steps: 30, hd: true }), { quality: "high", seed: '"42"', steps: "30", hd: "true" });
  assert.deepEqual(fieldsOf(undefined), {});
  assert.equal(fieldsText({ quality: "high", seed: "42" }), 'quality=high\nseed="42"');
  assert.equal(fieldsText(undefined), "");
});

test("what the form kept is read back as far as it still makes sense", () => {
  const kept = JSON.stringify({ model: "draw-2", size: "768x512", count: 3, extra: "quality=high", open: true });
  assert.deepEqual(readForm(kept, 4), { model: "draw-2", size: "768x512", count: 3, extra: "quality=high", open: true });
  // Fewer may be made at once now than when it was kept.
  assert.equal(readForm(kept, 2).count, 2);
  // Nothing, or what is not it: the form as it starts.
  const start = { model: "", size: "", count: 1, extra: "", open: false };
  assert.deepEqual(readForm(null, 4), start);
  assert.deepEqual(readForm("not json", 4), start);
  assert.deepEqual(readForm('"text"', 4), start);
  assert.deepEqual(readForm(JSON.stringify({ model: 5, count: -2, extra: {}, open: "yes" }), 4), start);
});
