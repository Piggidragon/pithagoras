import { test } from "node:test";
import assert from "node:assert/strict";
import { createPending, fitWithin, isImage, needsShrinking, sortFiles, uploadedNote, MAX_EDGE, MAX_IMAGE_BYTES } from "../web/src/attachments.ts";
import { buildTranscript } from "../web/src/transcript.ts";
import type { PortalEvent } from "../web/src/api.ts";

test("a picture keeps its shape when it is made to fit", () => {
  assert.deepEqual(fitWithin(4032, 3024), { width: MAX_EDGE, height: 1536 });
  assert.deepEqual(fitWithin(1000, 8000), { width: 256, height: MAX_EDGE });
  assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 });
  // A sliver is never drawn at nothing.
  assert.deepEqual(fitWithin(100_000, 1), { width: MAX_EDGE, height: 1 });
});

test("only a picture that is too big is redrawn, and a GIF never is", () => {
  assert.equal(needsShrinking("image/png", 200_000, 1920, 1080), false);
  assert.equal(needsShrinking("image/jpeg", 3_000_000, 4032, 3024), true);
  assert.equal(needsShrinking("image/png", MAX_IMAGE_BYTES + 1, 1000, 1000), true);
  assert.equal(needsShrinking("image/gif", MAX_IMAGE_BYTES * 2, 4000, 4000), false);
});

test("pictures go to the model; everything else goes in the folder", () => {
  const file = (name: string, type: string) => new File(["x"], name, { type });
  const { images, others } = sortFiles([
    file("shot.png", "image/png"),
    file("report.pdf", "application/pdf"),
    file("photo.heic", "image/heic"),
    file("a.webp", "image/webp"),
  ]);
  assert.deepEqual(images.map((f) => f.name), ["shot.png", "a.webp"]);
  // A picture the model cannot take is still a file the agent can work with.
  assert.deepEqual(others.map((f) => f.name), ["report.pdf", "photo.heic"]);
  assert.equal(isImage("image/svg+xml"), false);
});

test("the message says which files were put in the folder", () => {
  assert.equal(uploadedNote([]), "");
  assert.equal(uploadedNote(["report.pdf"]), "(I put `report.pdf` in the folder.)");
  assert.equal(uploadedNote(["a.csv", "b (2).csv"]), "(I put these in the folder: `a.csv`, `b (2).csv`.)");
});

test("pictures waiting in the box belong to their chat", () => {
  const pending = createPending();
  const pic = { id: "1", name: "a.png", mimeType: "image/png", data: "data:image/png;base64,AA==" };
  pending.set("one", [pic]);
  assert.deepEqual(pending.get("one"), [pic]);
  assert.deepEqual(pending.get("two"), []);
  pending.set("one", []);
  assert.deepEqual(pending.get("one"), []);
});

test("a sent message shows the pictures that went with it, even with no words", () => {
  const events = [
    { seq: 1, type: "portal_prompt", payload: { message: "", images: [{ name: "x.png", mimeType: "image/png" }] } },
    { seq: 2, type: "portal_prompt", payload: { message: "plain" } },
    { seq: 3, type: "portal_prompt", payload: { message: "odd", images: [{ nope: 1 }] } },
  ] as unknown as PortalEvent[];
  const items = buildTranscript(events);
  assert.deepEqual(items[0].kind === "user" && items[0].images, [{ name: "x.png", mimeType: "image/png" }]);
  assert.equal(items[1].kind === "user" && items[1].images, undefined);
  assert.equal(items[2].kind === "user" && items[2].images, undefined);
});
