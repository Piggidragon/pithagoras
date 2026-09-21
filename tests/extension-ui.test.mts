import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyExtensionUi,
  dismissNotice,
  NO_EXTENSION_UI,
  type ExtensionUi,
} from "../web/src/extension-ui.ts";

const feed = (...requests: Parameters<typeof applyExtensionUi>[1][]): ExtensionUi =>
  requests.reduce(applyExtensionUi, NO_EXTENSION_UI);

test("a widget arrives as the block it drew", () => {
  const ui = feed({ method: "setWidget", widgetKey: "todos", widgetContent: ["● Todos (0/1)", "└─ ○ one"] });
  assert.deepEqual(ui.widgets, [
    { key: "todos", lines: ["● Todos (0/1)", "└─ ○ one"], placement: "aboveEditor" },
  ]);
});

test("a widget that redraws stays where it was", () => {
  const ui = feed(
    { method: "setWidget", widgetKey: "todos", widgetContent: ["one"] },
    { method: "setWidget", widgetKey: "web", widgetContent: ["searching"] },
    { method: "setWidget", widgetKey: "todos", widgetContent: ["two"] },
  );
  assert.deepEqual(ui.widgets.map((w) => w.key), ["todos", "web"]);
  assert.deepEqual(ui.widgets[0].lines, ["two"]);
});

test("an extension takes its widget away by clearing it", () => {
  const ui = feed(
    { method: "setWidget", widgetKey: "todos", widgetContent: ["one"] },
    { method: "setWidget", widgetKey: "todos", widgetContent: undefined },
  );
  assert.deepEqual(ui.widgets, []);
});

test("a widget of nothing but blank lines is not an empty box", () => {
  const ui = feed({ method: "setWidget", widgetKey: "todos", widgetContent: ["", "  "] });
  assert.deepEqual(ui.widgets, []);
});

test("the terminal's trailing spacing is dropped, and its own blank lines kept", () => {
  const ui = feed({
    method: "setWidget",
    widgetKey: "todos",
    widgetContent: ["head", "", "tail", "", ""],
  });
  assert.deepEqual(ui.widgets[0].lines, ["head", "", "tail"]);
});

test("a status replaces the one under its own key", () => {
  const ui = feed(
    { method: "setStatus", statusKey: "web", statusText: "2 queries" },
    { method: "setStatus", statusKey: "web", statusText: "3 queries" },
  );
  assert.deepEqual(ui.statuses, [{ key: "web", text: "3 queries" }]);
});

test("an empty status clears it rather than showing a blank", () => {
  const ui = feed(
    { method: "setStatus", statusKey: "web", statusText: "busy" },
    { method: "setStatus", statusKey: "web", statusText: "" },
  );
  assert.deepEqual(ui.statuses, []);
});

test("messages stack, newest last, each with its own level", () => {
  const ui = feed(
    { method: "notify", message: "saved" },
    { method: "notify", message: "could not reach it", notifyType: "error" },
  );
  assert.deepEqual(ui.notices.map((n) => [n.text, n.level]), [
    ["saved", "info"],
    ["could not reach it", "error"],
  ]);
});

test("an extension in a loop cannot bury the page", () => {
  let ui = NO_EXTENSION_UI;
  for (let i = 0; i < 20; i++) ui = applyExtensionUi(ui, { method: "notify", message: `n${i}` });
  assert.equal(ui.notices.length, 4);
  assert.equal(ui.notices.at(-1)?.text, "n19");
});

test("two identical messages are two messages, each dismissable", () => {
  const ui = feed({ method: "notify", message: "same" }, { method: "notify", message: "same" });
  assert.equal(ui.notices.length, 2);
  const left = dismissNotice(ui, ui.notices[0].id);
  assert.deepEqual(left.notices.map((n) => n.id), [ui.notices[1].id]);
});

test("a message with nothing in it is not shown", () => {
  assert.deepEqual(feed({ method: "notify", message: "   " }).notices, []);
});

test("dismissing something already gone changes nothing at all", () => {
  const ui = feed({ method: "notify", message: "one" });
  assert.equal(dismissNotice(ui, 999), ui);
});

test("a dialog is somebody else's business, and does not re-render this", () => {
  const ui = feed({ method: "setWidget", widgetKey: "todos", widgetContent: ["one"] });
  // The same object back, not an equal one: the page re-renders on identity.
  assert.equal(applyExtensionUi(ui, { method: "select" }), ui);
  assert.equal(applyExtensionUi(ui, { method: "custom" }), ui);
});
