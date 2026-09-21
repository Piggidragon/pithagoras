import { test } from "node:test";
import assert from "node:assert/strict";
import { FrameBus } from "../web/src/tui-frames.ts";

test("a frame reaches the terminal watching that screen", () => {
  const bus = new FrameBus();
  const seen: string[] = [];
  bus.subscribe("a", (d) => seen.push(d));
  bus.emit("a", "one");
  bus.emit("a", "two");
  assert.deepEqual(seen, ["one", "two"]);
});

test("a screen drawn before its dialog opened is not lost", () => {
  const bus = new FrameBus();
  bus.emit("a", "drawn first");
  const seen: string[] = [];
  bus.subscribe("a", (d) => seen.push(d));
  assert.deepEqual(seen, ["drawn first"]);
});

test("only the newest screen is replayed, because each one is the whole screen", () => {
  const bus = new FrameBus();
  bus.emit("a", "old");
  bus.emit("a", "new");
  const seen: string[] = [];
  bus.subscribe("a", (d) => seen.push(d));
  assert.deepEqual(seen, ["new"]);
});

test("frames go only to the screen they belong to", () => {
  const bus = new FrameBus();
  const a: string[] = [];
  const b: string[] = [];
  bus.subscribe("a", (d) => a.push(d));
  bus.subscribe("b", (d) => b.push(d));
  bus.emit("b", "for b");
  assert.deepEqual(a, []);
  assert.deepEqual(b, ["for b"]);
});

test("unsubscribing stops delivery, and a later terminal takes over cleanly", () => {
  const bus = new FrameBus();
  const first: string[] = [];
  const second: string[] = [];
  const stop = bus.subscribe("a", (d) => first.push(d));
  stop();
  bus.emit("a", "after");
  assert.deepEqual(first, []);
  bus.subscribe("a", (d) => second.push(d));
  assert.deepEqual(second, ["after"]);
});

test("a stale unsubscribe does not detach the terminal that replaced it", () => {
  const bus = new FrameBus();
  const first: string[] = [];
  const second: string[] = [];
  const stopFirst = bus.subscribe("a", (d) => first.push(d));
  bus.subscribe("a", (d) => second.push(d));
  // React can run the old effect's cleanup after the new one has set up.
  stopFirst();
  bus.emit("a", "still here");
  assert.deepEqual(second, ["still here"]);
  assert.deepEqual(first, []);
});

test("a finished screen is forgotten rather than kept for the tab's life", () => {
  const bus = new FrameBus();
  bus.emit("a", "done");
  bus.forget("a");
  const seen: string[] = [];
  bus.subscribe("a", (d) => seen.push(d));
  assert.deepEqual(seen, []);
});

test("opening another conversation clears every screen at once", () => {
  const bus = new FrameBus();
  bus.emit("a", "one");
  bus.emit("b", "two");
  bus.clear();
  const seen: string[] = [];
  bus.subscribe("a", (d) => seen.push(d));
  bus.subscribe("b", (d) => seen.push(d));
  assert.deepEqual(seen, []);
});
