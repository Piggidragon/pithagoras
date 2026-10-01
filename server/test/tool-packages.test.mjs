import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Which package a tool came from, as the portal keeps it. A user's package is
 * the entry of pi's settings; a project's is the entry of the project's, kept
 * apart because the first is what the lists of known tools are cleaned by.
 */
const home = mkdtempSync(path.join(tmpdir(), "pithagoras-tool-packages-"));
process.env.DATA_DIR = home;
process.env.WORKSPACE_ROOT = path.join(home, "ws");
process.env.PI_CODING_AGENT_DIR = path.join(home, "agent");
mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });
writeFileSync(path.join(process.env.PI_CODING_AGENT_DIR, "settings.json"), JSON.stringify({ packages: ["npm:user-pack"] }));

const { SdkPiClient } = await import("../dist/pi/sdk-client.js");
const { knownTools, rememberTools, remembered, shownTools } = await import("../dist/db.js");

const tool = (name, sourceInfo) => ({ name, description: "does " + name, sourceInfo });
const client = Object.assign(Object.create(SdkPiClient.prototype), {
  wanted: new Set(),
  switchedOff: new Set(),
  session: {
    getAllTools: () => [
      tool("user_tool", { origin: "package", scope: "user", source: "npm:user-pack@1.0.0", path: "/x/node_modules/user-pack/index.js" }),
      tool("project_tool", { origin: "package", scope: "project", source: "npm:project-pack@2.0.0", path: "/p/.pi/npm/node_modules/project-pack/index.js" }),
      tool("loose_tool", { origin: "top-level", scope: "project", source: "auto", path: "/p/.pi/extensions/loose.ts" }),
    ],
  },
});

test("a tool says which package brought it: the user's, or the project's, and neither for a loose file", async () => {
  const tools = await client.getTools();
  const by = (name) => tools.find((t) => t.name === name);
  assert.equal(by("user_tool").package, "npm:user-pack@1.0.0");
  assert.equal(by("user_tool").projectPackage, undefined);
  assert.equal(by("project_tool").package, undefined, "nothing of the user's brought it");
  assert.equal(by("project_tool").projectPackage, "npm:project-pack@2.0.0");
  assert.equal(by("loose_tool").package, undefined);
  assert.equal(by("loose_tool").projectPackage, undefined);
});

test("the project's package is remembered with its tool, and is not shown as a package of the user's", async () => {
  rememberTools((await client.getTools()).map(remembered));
  const known = knownTools();
  const project = known.find((t) => t.name === "project_tool");
  assert.equal(project.package, null, "no package of the user's, so it is never cleaned away with one");
  assert.equal(project.projectPackage, "npm:project-pack@2.0.0");
  assert.equal(known.find((t) => t.name === "user_tool").projectPackage, undefined);
  // What the settings page and an idle chat are given has neither: bookkeeping.
  assert.ok(shownTools().every((t) => !("package" in t) && !("projectPackage" in t)));
  assert.deepEqual(shownTools().map((t) => t.name), ["loose_tool", "project_tool", "user_tool"]);
});
