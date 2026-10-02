import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The tool lists learn what a chat registered. A chat that is open while image
 * generation or editing is switched on registers the tool after its reload
 * without the lists hearing of it, so the lists know the portal's own tools
 * from the settings: the person who has just switched editing on sees it.
 */
const home = mkdtempSync(path.join(tmpdir(), "pithagoras-tools-portal-picture-"));
process.env.DATA_DIR = home;
process.env.WORKSPACE_ROOT = path.join(home, "ws");
process.env.PI_CODING_AGENT_DIR = path.join(home, "agent");
mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });

const db = await import("../dist/db.js");
const gen = await import("../dist/image-generation.js");
const { sessions } = await import("../dist/session-manager.js");

const shown = () => Object.fromEntries(db.shownTools().filter((t) => /image/.test(t.name)).map((t) => [t.name, t.inline === true]));

test("a tool the settings just made is listed before any chat has reported it, and only while it is on", async () => {
  // As a chat reports them from before editing was switched on.
  db.rememberTools([{ name: "show_image", source: "pictures", package: null, inline: true }]);
  assert.deepEqual(shown(), { show_image: true });

  gen.saveImageGeneration({ baseUrl: "https://images.example.com/v1", enabled: true });
  assert.deepEqual(shown(), { generate_image: true, show_image: true });
  gen.saveImageGeneration({ editEnabled: true });
  assert.deepEqual(shown(), { edit_image: true, generate_image: true, show_image: true });
  // The lists of a chat that has not started, and of one in a project, are what is shown.
  db.createSession({ id: "idle", title: "idle", workspace: home, executor: "host" });
  const idle = (await sessions.getTools("idle")).tools;
  assert.deepEqual(idle.filter((t) => t.name === "edit_image").map((t) => [t.source, t.inline]), [["image-editing", true]]);
  assert.equal(db.knownTools().some((t) => t.name === "edit_image"), false, "nothing is written down that no chat has registered");

  gen.saveImageGeneration({ editEnabled: false });
  assert.deepEqual(shown(), { generate_image: true, show_image: true });
});

test("an extension's tool of the same name that a chat reported is left as it is", () => {
  gen.saveImageGeneration({ editEnabled: true });
  db.rememberTools([{ name: "edit_image", source: "my-images", package: "npm:my-images", inline: false }]);
  const theirs = db.shownTools().find((t) => t.name === "edit_image");
  assert.equal(theirs.source, "my-images");
  assert.equal(theirs.inline, undefined);
});
