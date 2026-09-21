import { test } from "node:test";
import assert from "node:assert/strict";

/** A localStorage that behaves, since node has none. */
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
};

const { hiddenStatuses, hideStatus, showAllStatuses } = await import("../web/src/status-hiding.ts");

test("nothing is hidden to begin with", () => {
  assert.deepEqual(hiddenStatuses(), []);
});

test("a status is hidden by its key, and hiding it twice is once", () => {
  assert.deepEqual(hideStatus("pi-lens-lsp"), ["pi-lens-lsp"]);
  assert.deepEqual(hideStatus("pi-lens-lsp"), ["pi-lens-lsp"]);
  assert.deepEqual(hideStatus("goal"), ["goal", "pi-lens-lsp"]);
  assert.deepEqual(hiddenStatuses(), ["goal", "pi-lens-lsp"]);
});

test("they all come back at once", () => {
  assert.deepEqual(showAllStatuses(), []);
  assert.deepEqual(hiddenStatuses(), []);
});

test("a store that has been scribbled in is not believed", () => {
  store.set("hiddenStatuses", "{not json");
  assert.deepEqual(hiddenStatuses(), []);
  store.set("hiddenStatuses", JSON.stringify({ key: "value" }));
  assert.deepEqual(hiddenStatuses(), []);
  store.set("hiddenStatuses", JSON.stringify(["ok", 7, null]));
  assert.deepEqual(hiddenStatuses(), ["ok"]);
});

test("a browser that refuses to remember still hides for this page", () => {
  const real = (globalThis as any).localStorage.setItem;
  (globalThis as any).localStorage.setItem = () => {
    throw new Error("denied");
  };
  assert.doesNotThrow(() => hideStatus("anything"));
  (globalThis as any).localStorage.setItem = real;
});
