import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const pub = new URL("../web/public/", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, pub));

/** A PNG's width and height, from its IHDR chunk. */
const pngSize = (buf: Buffer) => [buf.readUInt32BE(16), buf.readUInt32BE(20)];

test("the manifest makes the portal installable", () => {
  const manifest = JSON.parse(read("manifest.webmanifest").toString());
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/");
  for (const icon of manifest.icons) {
    const [w, h] = pngSize(read(icon.src.slice(1)));
    assert.equal(`${w}x${h}`, icon.sizes, icon.src);
  }
  const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
  assert.ok(sizes.includes("192x192") && sizes.includes("512x512"));
  assert.ok(manifest.icons.some((i: { purpose?: string }) => i.purpose === "maskable"));
});

test("the page links the manifest and registers the worker", () => {
  const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
  assert.match(html, /<link rel="manifest" href="\/manifest.webmanifest"/);
  assert.match(html, /<script src="\/register-sw.js"/);
});

/** The worker's fetch handler, and whether it answered a request itself. */
function worker() {
  const listeners: Record<string, (e: unknown) => void> = {};
  const self = { location: { origin: "https://portal.test" }, addEventListener: (t: string, f: (e: unknown) => void) => (listeners[t] = f) };
  const pending = () => new Promise(() => {});
  runInNewContext(read("sw.js").toString(), { self, URL, caches: { match: pending, open: pending }, fetch: pending, Response });
  return (url: string, init: { method?: string; mode?: string } = {}) => {
    let answered = false;
    listeners.fetch({ request: { url, method: init.method ?? "GET", mode: init.mode ?? "cors" }, respondWith: () => (answered = true) });
    return answered;
  };
}

test("the worker leaves the live parts of the portal to the server", () => {
  const handles = worker();
  assert.equal(handles("https://portal.test/api/sessions"), false);
  assert.equal(handles("https://portal.test/api/sessions/x/events", { mode: "navigate" }), false);
  assert.equal(handles("https://portal.test/browser-ui/", { mode: "navigate" }), false);
  assert.equal(handles("https://portal.test/voice-assets/silero_vad_v5.onnx"), false);
  assert.equal(handles("https://portal.test/assets/index-abc.js", { method: "POST" }), false);
  assert.equal(handles("https://elsewhere.test/assets/index-abc.js"), false);
});

test("the worker serves pages and built assets", () => {
  const handles = worker();
  assert.equal(handles("https://portal.test/s/abc", { mode: "navigate" }), true);
  assert.equal(handles("https://portal.test/assets/index-abc.js"), true);
  assert.equal(handles("https://portal.test/icon-192.png"), true);
});
