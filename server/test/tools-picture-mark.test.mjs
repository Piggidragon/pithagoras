import { test, before } from "node:test";
import assert from "node:assert/strict";
import { freePort, serverEnv, startServer, testHome } from "./server-harness.mjs";

/**
 * What /api/tools says of the picture tools, against the whole server: Settings
 * → Images keeps the portal's own, and Settings → Tools keeps an extension's of
 * the same name, and both go by the `inline` mark on the route's answer.
 */
const home = testHome("pithagoras-tools-picture-mark-");
process.env.DATA_DIR = home;
const db = await import("../dist/db.js");
db.rememberTools([
  { name: "show_image", source: "pictures", package: null, inline: true },
  // A loose extension file called image-generation.ts: the portal's label, reported as not its own.
  { name: "generate_image", source: "image-generation", package: null, inline: false },
  { name: "edit_image", source: "image-editing", package: null, inline: true },
  { name: "web_search", source: "pi-web-access", package: null, inline: false },
]);
// Kept before the mark was recorded: none at all, from no package, under the portal's label.
const kept = JSON.parse(db.getStoredSettings().tools_seen);
delete kept.find((t) => t.name === "edit_image").inline;
db.putSetting("tools_seen", JSON.stringify(kept));

let base;
before(async () => {
  ({ base } = await startServer(serverEnv(home, await freePort())));
});

test("the portal's picture tools are marked, also one kept before the mark; an extension's of the same name, even under the portal's label, and other tools are not", async () => {
  const { tools } = await (await fetch(`${base}/api/tools`)).json();
  const marked = Object.fromEntries(tools.map((t) => [t.name, t.inline === true]));
  assert.deepEqual(marked, { edit_image: true, generate_image: false, show_image: true, web_search: false });
});
