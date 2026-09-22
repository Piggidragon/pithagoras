import { test } from "node:test";
import assert from "node:assert/strict";
import { isEnter, isEscape, opensComposer, stopsRun } from "../web/src/shortcuts.ts";

test("a slash on the bare page opens the message box", () => {
  assert.equal(opensComposer({ key: "/", target: { tagName: "BODY" } }), true);
  assert.equal(opensComposer({ key: "/", target: { tagName: "BUTTON" } }), true);
  assert.equal(opensComposer({ key: "/", target: null }), true);
});

test("a slash typed into a field is a slash", () => {
  for (const tagName of ["INPUT", "TEXTAREA", "SELECT", "textarea"]) {
    assert.equal(opensComposer({ key: "/", target: { tagName } }), false, tagName);
  }
  assert.equal(opensComposer({ key: "/", target: { tagName: "DIV", isContentEditable: true } }), false);
});

test("a slash with a modifier belongs to the browser", () => {
  assert.equal(opensComposer({ key: "/", ctrlKey: true }), false);
  assert.equal(opensComposer({ key: "/", metaKey: true }), false);
  assert.equal(opensComposer({ key: "/", altKey: true }), false);
});

test("other keys open nothing", () => {
  assert.equal(opensComposer({ key: "a" }), false);
});

const base = { key: "Escape", running: true, empty: true, composing: false, paletteOpen: false };

test("Escape stops a run when there is nothing typed", () => {
  assert.equal(stopsRun(base), true);
});

test("Escape never costs typed words, and does nothing when nothing runs", () => {
  assert.equal(stopsRun({ ...base, empty: false }), false);
  assert.equal(stopsRun({ ...base, running: false }), false);
});

test("Escape belongs to the input method and the command list first", () => {
  assert.equal(stopsRun({ ...base, composing: true }), false);
  assert.equal(stopsRun({ ...base, paletteOpen: true }), false);
});

test("only Escape stops", () => {
  assert.equal(stopsRun({ ...base, key: "Enter" }), false);
});

test("Enter is Enter only when no input method is using it", () => {
  assert.equal(isEnter({ key: "Enter", keyCode: 13, nativeEvent: { isComposing: false } }), true);
  assert.equal(isEnter({ key: "Enter", keyCode: 13 }), true);
  // Confirming a candidate: while composing, and Safari's late keydown.
  assert.equal(isEnter({ key: "Enter", keyCode: 229, nativeEvent: { isComposing: true } }), false);
  assert.equal(isEnter({ key: "Enter", keyCode: 229, nativeEvent: { isComposing: false } }), false);
  assert.equal(isEnter({ key: "Enter", isComposing: true }), false);
  assert.equal(isEnter({ key: "a", keyCode: 65 }), false);
});

test("Escape is Escape only when no input method is using it", () => {
  assert.equal(isEscape({ key: "Escape", keyCode: 27, nativeEvent: { isComposing: false } }), true);
  // A DOM event, as the dialogs listen on the document.
  assert.equal(isEscape({ key: "Escape", keyCode: 27, isComposing: false }), true);
  // Taking back a candidate: while composing, and Safari's late keydown.
  assert.equal(isEscape({ key: "Escape", keyCode: 229, nativeEvent: { isComposing: true } }), false);
  assert.equal(isEscape({ key: "Escape", keyCode: 229 }), false);
  assert.equal(isEscape({ key: "Escape", isComposing: true }), false);
  assert.equal(isEscape({ key: "Enter", keyCode: 13 }), false);
});
