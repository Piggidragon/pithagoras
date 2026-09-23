import { test } from "node:test";
import assert from "node:assert/strict";
import { createDrafts, withUnsent } from "../web/src/drafts.ts";
import { guarded, type RawStorage } from "../web/src/safe-storage.ts";

const mapStorage = (): RawStorage & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
};

test("storage that throws reads as empty and drops writes", () => {
  const store = guarded(() => {
    throw new Error("SecurityError");
  });
  assert.equal(store.get("a"), null);
  assert.doesNotThrow(() => store.set("a", "1"));
  assert.doesNotThrow(() => store.remove("a"));
});

test("storage that works is passed through", () => {
  const raw = mapStorage();
  const store = guarded(() => raw);
  store.set("a", "1");
  assert.equal(store.get("a"), "1");
  store.remove("a");
  assert.equal(store.get("a"), null);
});

test("each chat has its own draft", () => {
  const d = createDrafts(guarded(mapStorage));
  d.set("a", "half a thought");
  assert.equal(d.get("a"), "half a thought");
  assert.equal(d.get("b"), "");
});

test("an emptied draft is forgotten, in memory and in storage", () => {
  const raw = mapStorage();
  const d = createDrafts(guarded(() => raw));
  d.set("a", "text");
  assert.equal(raw.map.size, 1);
  d.set("a", "");
  assert.equal(d.get("a"), "");
  assert.equal(raw.map.size, 0);
});

test("a draft outlives a reload: a new store reads what the last one wrote", () => {
  const raw = mapStorage();
  createDrafts(guarded(() => raw)).set("a", "still here");
  assert.equal(createDrafts(guarded(() => raw)).get("a"), "still here");
});

test("drafts still work while the page is open when storage is blocked", () => {
  const d = createDrafts(
    guarded(() => {
      throw new Error("blocked");
    }),
  );
  d.set("a", "kept in memory");
  assert.equal(d.get("a"), "kept in memory");
});

test("an unsent message goes back before what was typed since", () => {
  assert.equal(withUnsent("", "hello"), "hello");
  assert.equal(withUnsent("   ", "hello"), "hello");
  assert.equal(withUnsent("and this", "hello"), "hello\nand this");
});
