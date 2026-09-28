import { test } from "node:test";
import assert from "node:assert/strict";
import { bounds, colourOf, layout } from "../web/src/memory-graph.ts";

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
  const box = bounds([only]);
  assert.ok(box.width > 0 && box.height > 0);
  assert.deepEqual(bounds([]), { x: -100, y: -100, width: 200, height: 200 });
});

test("a type keeps its colour", () => {
  assert.equal(colourOf("Deployment Process"), colourOf("Deployment Process"));
  assert.match(colourOf(undefined), /^#/);
});
