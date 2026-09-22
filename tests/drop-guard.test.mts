import { test } from "node:test";
import assert from "node:assert/strict";
import { guardStrayDrops, type DragLike, type DropHost } from "../web/src/drop-guard.ts";

function host() {
  const listeners = new Map<string, (e: DragLike) => void>();
  const h: DropHost & { fire(e: DragLike): void; count(): number } = {
    addEventListener: (type, l) => listeners.set(type, l),
    removeEventListener: (type) => listeners.delete(type),
    fire: (e) => listeners.get(e.type)?.(e),
    count: () => listeners.size,
  };
  return h;
}

const drag = (type: string, types: string[], claimed = false) => {
  const e = {
    type,
    defaultPrevented: claimed,
    dataTransfer: { types, dropEffect: "copy" },
    preventDefault() {
      e.defaultPrevented = true;
    },
  };
  return e;
};

test("a file dropped where nothing takes it is refused, not opened", () => {
  const h = host();
  guardStrayDrops(h);
  const over = drag("dragover", ["Files"]);
  h.fire(over);
  assert.equal(over.defaultPrevented, true);
  assert.equal(over.dataTransfer.dropEffect, "none");
  const drop = drag("drop", ["Files"]);
  h.fire(drop);
  assert.equal(drop.defaultPrevented, true);
});

test("what a drop target took is left to it", () => {
  const h = host();
  guardStrayDrops(h);
  const over = drag("dragover", ["Files"], true);
  h.fire(over);
  assert.equal(over.dataTransfer.dropEffect, "copy");
});

test("dragging text around the page is not a file, and is left alone", () => {
  const h = host();
  guardStrayDrops(h);
  const over = drag("dragover", ["text/plain"]);
  h.fire(over);
  assert.equal(over.defaultPrevented, false);
  assert.equal(over.dataTransfer.dropEffect, "copy");
});

test("it can be taken off again", () => {
  const h = host();
  const stop = guardStrayDrops(h);
  assert.equal(h.count(), 2);
  stop();
  assert.equal(h.count(), 0);
});
