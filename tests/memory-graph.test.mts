import { test } from "node:test";
import assert from "node:assert/strict";
import { bounds, colours, layout } from "../web/src/memory-graph.ts";

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

test("linked notes end up closer than unlinked ones, the same way every time", () => {
  const paths = ["/a.md", "/b.md", "/c.md", "/d.md", "/e.md"];
  const edges = [{ source: "/a.md", target: "/b.md" }, { source: "/b.md", target: "/c.md" }, { source: "/gone.md", target: "/a.md" }];
  const one = layout(paths, edges);
  assert.deepEqual(one, layout(paths, edges));
  assert.ok(one.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
  const at = Object.fromEntries(one.map((p) => [p.path, p]));
  assert.ok(dist(at["/a.md"], at["/b.md"]) < dist(at["/a.md"], at["/e.md"]));
  // Nobody on top of anybody.
  for (const p of one) for (const q of one) if (p !== q) assert.ok(dist(p, q) > 20, `${p.path} and ${q.path} apart`);
});

test("one note, or none, is laid out and boxed without trouble", () => {
  assert.deepEqual(layout([], []), []);
  const [only] = layout(["/x.md"], []);
  assert.ok(Math.abs(only.x) < 1e-6 + 60 && Number.isFinite(only.y));
  // Never drawn closer than the least box: three notes do not fill the page.
  const box = bounds([only]);
  assert.deepEqual([box.width, box.height], [720, 480]);
  assert.ok(Math.abs(box.x + box.width / 2 - only.x) < 1e-6, "centred on it");
  assert.deepEqual(bounds([]), { x: -360, y: -240, width: 720, height: 480 });
});

test("the memory's types never share a colour, the first ten of them", () => {
  const types = ["People", "Test Infrastructure", "Deployment Process", "People"];
  const colourOf = colours(types);
  assert.equal(new Set(types.map(colourOf)).size, 3);
  assert.equal(colourOf("People"), colours(["People", "Test Infrastructure", "Deployment Process"])("People"), "the same memory, the same colours");
  assert.match(colourOf("Unheard of"), /^#/);
  assert.match(colourOf(undefined), /^#/);
});
