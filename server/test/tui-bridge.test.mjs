import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFrame, plainChoices, plainLines, plainText, TuiSurface } from "../dist/pi/tui-bridge.js";
import { tuiRuntime } from "../dist/pi/tui-runtime.js";

const HOME = "\u001b[?25l\u001b[H";
const ERASE_BELOW = "\u001b[J";
const CURSOR_MARKER = "\u001b_pi:c\u0007";

/** Frames are produced on a timer, as pi's own renderer does. */
const settled = () => new Promise((r) => setTimeout(r, 40));

/** A component that says what it was told to say and remembers what it was typed. */
function stub(lines = ["hello"]) {
  return {
    lines,
    typed: [],
    invalidated: 0,
    disposed: 0,
    render() {
      return this.lines;
    },
    handleInput(data) {
      this.typed.push(data);
    },
    invalidate() {
      this.invalidated++;
    },
    dispose() {
      this.disposed++;
    },
  };
}

test("a frame repaints the viewport from the top and does not scroll it", () => {
  const frame = buildFrame(["one", "two"], 10);
  assert.ok(frame.startsWith(HOME));
  assert.ok(frame.endsWith(ERASE_BELOW));
  assert.ok(frame.includes("one"));
  assert.ok(frame.includes("\r\n"));
  // A newline after the last line would push the screen up by one every frame.
  assert.ok(!frame.slice(0, -ERASE_BELOW.length).endsWith("\r\n"));
});

test("styles are reset before the line is erased, so no background bleeds across", () => {
  const frame = buildFrame(["\u001b[41mred"], 10);
  const reset = frame.indexOf("\u001b[0m");
  const erase = frame.indexOf("\u001b[K");
  assert.ok(reset > 0 && erase > reset);
});

test("a screen taller than the viewport keeps its bottom", () => {
  const frame = buildFrame(["a", "b", "c", "d"], 2);
  assert.ok(!frame.includes("a"));
  assert.ok(frame.includes("c") && frame.includes("d"));
});

test("the cursor marker is taken out rather than written to the terminal", () => {
  const frame = buildFrame([`> text${CURSOR_MARKER}`], 5);
  assert.ok(!frame.includes(CURSOR_MARKER));
  assert.ok(frame.includes("> text"));
});

test("an empty screen still clears what was there before", () => {
  assert.equal(buildFrame([], 5), HOME + ERASE_BELOW);
});

test("attaching a component paints it, and says how tall it came out", async () => {
  const frames = [];
  const surface = new TuiSurface({ cols: 20, rows: 5, onFrame: (f) => frames.push(f) });
  surface.attach(stub(["menu", "here"]));
  await settled();
  assert.equal(frames.length, 1);
  assert.ok(frames[0].data.includes("menu"));
  // What the page sizes its terminal to, so a short screen is not a tall box.
  assert.equal(frames[0].lines, 2);
  surface.dispose();
});

test("keystrokes reach the focused component and produce a new frame", async () => {
  const frames = [];
  const surface = new TuiSurface({ cols: 20, rows: 5, onFrame: (f) => frames.push(f) });
  const component = stub(["one"]);
  surface.attach(component);
  await settled();
  component.lines = ["two"];
  surface.input("\u001b[B");
  await settled();
  assert.deepEqual(component.typed, ["\u001b[B"]);
  assert.ok(frames.at(-1).data.includes("two"));
  surface.dispose();
});

test("an input listener can rewrite a keystroke or keep it", async () => {
  const surface = new TuiSurface({ cols: 20, rows: 5, onFrame: () => {} });
  const component = stub();
  surface.attach(component);
  const stopRewriting = surface.addInputListener((data) => ({ data: data + "!" }));
  surface.input("a");
  assert.deepEqual(component.typed, ["a!"]);
  stopRewriting();
  surface.addInputListener(() => ({ consume: true }));
  surface.input("b");
  assert.deepEqual(component.typed, ["a!"]);
  surface.dispose();
});

test("an overlay is drawn under the screen and takes the keyboard until it is hidden", async () => {
  const frames = [];
  const surface = new TuiSurface({ cols: 20, rows: 10, onFrame: (f) => frames.push(f) });
  const base = stub(["base"]);
  const over = stub(["over"]);
  surface.attach(base);
  const handle = surface.showOverlay(over);
  await settled();
  const frame = frames.at(-1).data;
  assert.ok(frame.indexOf("base") < frame.indexOf("over"));
  assert.ok(surface.hasOverlay());
  surface.input("x");
  assert.deepEqual(over.typed, ["x"]);
  assert.deepEqual(base.typed, []);
  handle.hide();
  surface.input("y");
  assert.deepEqual(base.typed, ["y"]);
  assert.ok(!surface.hasOverlay());
  surface.dispose();
});

test("closing nested overlays hands the keyboard back to the screen underneath", () => {
  const surface = new TuiSurface({ cols: 20, rows: 10, onFrame: () => {} });
  const base = stub(["base"]);
  surface.attach(base);
  // A picker that opens a confirmation, which is the shape that used to leave
  // the keyboard on an overlay that had already closed.
  const first = surface.showOverlay(stub(["picker"]));
  const second = surface.showOverlay(stub(["confirm"]));
  second.hide();
  first.hide();
  surface.input("y");
  assert.deepEqual(base.typed, ["y"]);
  surface.dispose();
});

test("overlays closed out of order do not leave the keyboard on one that has gone", () => {
  const surface = new TuiSurface({ cols: 20, rows: 10, onFrame: () => {} });
  const base = stub(["base"]);
  surface.attach(base);
  const first = surface.showOverlay(stub(["picker"]));
  const second = surface.showOverlay(stub(["confirm"]));
  // The one underneath goes first, so what the top one saved to hand back is
  // no longer on the screen.
  first.hide();
  second.hide();
  surface.input("k");
  assert.deepEqual(base.typed, ["k"]);
  surface.dispose();
});

test("a borrowed component survives the surface that drew it", () => {
  const surface = new TuiSurface({ cols: 20, rows: 5, onFrame: () => {} });
  const component = stub(["row"]);
  surface.attach(component);
  assert.deepEqual(surface.lines(), ["row"]);
  surface.release();
  assert.equal(component.disposed, 0);
  surface.dispose();
  assert.equal(component.disposed, 0);
});

test("a non-capturing overlay is drawn but leaves the keyboard alone", async () => {
  const surface = new TuiSurface({ cols: 20, rows: 10, onFrame: () => {} });
  const base = stub(["base"]);
  surface.attach(base);
  surface.showOverlay(stub(["hint"]), { nonCapturing: true });
  surface.input("z");
  assert.deepEqual(base.typed, ["z"]);
  surface.dispose();
});

test("resizing tells the component to lay itself out again", async () => {
  const widths = [];
  const surface = new TuiSurface({ cols: 20, rows: 5, onFrame: () => {} });
  const component = stub();
  component.render = (width) => {
    widths.push(width);
    return ["x"];
  };
  surface.attach(component);
  await settled();
  surface.resize(60, 12);
  await settled();
  assert.ok(widths.includes(60));
  assert.equal(component.invalidated, 1);
  // The same size again is not a change, so nothing is redrawn for it.
  const before = widths.length;
  surface.resize(60, 12);
  await settled();
  assert.equal(widths.length, before);
  surface.dispose();
});

test("a size the browser could not have meant is brought into range", async () => {
  const widths = [];
  const surface = new TuiSurface({ cols: 20, rows: 5, onFrame: () => {} });
  const component = stub();
  component.render = (width) => {
    widths.push(width);
    return ["x"];
  };
  surface.attach(component);
  surface.resize(0, 0);
  await settled();
  assert.ok(widths.every((w) => w >= 20));
  surface.dispose();
});

test("a component that throws while drawing loses its screen, not the session", async () => {
  const frames = [];
  const surface = new TuiSurface({ cols: 20, rows: 5, onFrame: (f) => frames.push(f) });
  surface.attach({
    render() {
      throw new Error("no layout");
    },
    invalidate() {},
  });
  await settled();
  assert.ok(frames.at(-1).data.includes("no layout"));
  surface.dispose();
});

test("a component that throws on a keystroke says so and stops", async () => {
  const frames = [];
  const surface = new TuiSurface({ cols: 20, rows: 5, onFrame: (f) => frames.push(f) });
  surface.attach({
    render: () => ["fine"],
    handleInput() {
      throw new Error("bad key");
    },
    invalidate() {},
  });
  await settled();
  surface.input("q");
  assert.ok(frames.at(-1).data.includes("bad key"));
  surface.dispose();
});

test("disposing stops the frames and the component", async () => {
  const frames = [];
  const surface = new TuiSurface({ cols: 20, rows: 5, onFrame: (f) => frames.push(f) });
  const component = stub();
  surface.attach(component);
  await settled();
  const seen = frames.length;
  surface.dispose();
  surface.input("a");
  await settled();
  assert.equal(frames.length, seen);
  assert.equal(component.disposed, 1);
  assert.deepEqual(component.typed, []);
});

test("the current screen can be asked for without waiting for a redraw", () => {
  const surface = new TuiSurface({ cols: 20, rows: 5, onFrame: () => {} });
  surface.attach(stub(["now"]));
  assert.equal(surface.frame().lines, 1);
  assert.ok(surface.frame().data.includes("now"));
  surface.dispose();
});

test("a widget's lines are flattened to what they say", () => {
  assert.deepEqual(
    plainLines(["\u001b[38;5;69m→ \u001b[39mpick  ", `link${CURSOR_MARKER}`]),
    ["→ pick", "link"]
  );
});

/**
 * The point of the whole bridge: a component nobody here wrote, rendered and
 * driven to an answer through this surface alone.
 */
test("one of pi's own components can be shown and answered", async (t) => {
  const runtime = await tuiRuntime();
  if (!runtime) return t.skip("pi's TUI runtime is not available in this install");
  const { ExtensionSelectorComponent } = await import("@earendil-works/pi-coding-agent");

  const frames = [];
  const surface = new TuiSurface({ cols: 60, rows: 20, onFrame: (f) => frames.push(f) });
  let chosen;
  surface.attach(
    new ExtensionSelectorComponent(
      "Pick one",
      ["alpha", "beta", "gamma"],
      (option) => {
        chosen = option;
      },
      () => {
        chosen = null;
      }
    )
  );
  await settled();
  const opened = frames.at(-1).data;
  assert.ok(opened.includes("Pick one"));
  assert.ok(opened.includes("alpha") && opened.includes("gamma"));

  // Down, then enter — the same bytes a terminal sends, which is all the
  // browser ever has to produce.
  surface.input("\u001b[B");
  await settled();
  surface.input("\r");
  assert.equal(chosen, "beta");
  surface.dispose();
});

test("a widget's lines can be read back as often as it repaints", async () => {
  const painted = [];
  const surface = new TuiSurface({
    cols: 40,
    rows: 200,
    onFrame: () => painted.push(plainLines(surface.lines())),
  });
  const component = stub(["\u001b[38;5;69m● Todos (0/1)\u001b[39m"]);
  surface.attach(component);
  await settled();
  assert.deepEqual(painted.at(-1), ["● Todos (0/1)"]);

  // A widget registers its component once and repaints by asking the surface,
  // which is what rpiv-todo's overlay does on every task change.
  component.lines = ["● Todos (0/2)", "├─ ○ one", "└─ ○ two"];
  surface.requestRender();
  await settled();
  assert.deepEqual(painted.at(-1), ["● Todos (0/2)", "├─ ○ one", "└─ ○ two"]);
  surface.dispose();
});

test("a line an extension coloured for a terminal arrives as its words", () => {
  // What pi-lens puts in the status bar, which read as escape codes in the page.
  assert.equal(plainText("\u001b[38;5;241mLSP Inactive\u001b[39m"), "LSP Inactive");
  assert.equal(plainText("\u001b[1m\u001b[31mfailed\u001b[0m  "), "failed");
  assert.equal(
    plainText("\u001b]8;;https://example.com\u0007docs\u001b]8;;\u0007"),
    "docs"
  );
  assert.equal(plainText("nothing to take out"), "nothing to take out");
});

test("a menu is labelled plainly and answers with what was offered", () => {
  const raw = "\u001b[32mkeep\u001b[39m";
  const { labels, original } = plainChoices([raw, "discard"]);
  assert.deepEqual(labels, ["keep", "discard"]);
  // The extension compares the answer against the options it put in.
  assert.equal(original("keep"), raw);
  assert.equal(original("discard"), "discard");
  assert.equal(original("something else"), "something else");
});

test("an option that is not a string is passed through untouched", () => {
  const odd = { label: "x" };
  const { labels, original } = plainChoices([odd]);
  assert.deepEqual(labels, [odd]);
  assert.equal(original(odd), odd);
});
