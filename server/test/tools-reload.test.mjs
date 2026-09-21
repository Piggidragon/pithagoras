import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "pithagoras-reload-"));

const { SdkPiClient } = await import("../dist/pi/sdk-client.js");

const TOOLS = ["read", "web_search", "browser_browser_click"];

/**
 * pi's own reload, as it is in 0.82: it ends by putting every extension tool
 * back into the active set, whatever was active before.
 */
function fakeSession() {
  const session = {
    active: [...TOOLS],
    getAllTools: () => TOOLS.map((name) => ({ name })),
    setActiveToolsByName(names) {
      session.active = names;
    },
    async reload() {
      session.active = [...TOOLS];
    },
  };
  return session;
}

test("a reload does not bring back what was switched off", async () => {
  const session = fakeSession();
  const client = new SdkPiClient(session, {}, () => {});
  await client.setToolsOff(["browser_browser_click"]);
  assert.deepEqual(session.active, ["read", "web_search"]);

  await client.reload();

  assert.deepEqual(session.active, ["read", "web_search"]);
});

test("a reload with nothing switched off leaves pi's active set alone", async () => {
  const session = fakeSession();
  const client = new SdkPiClient(session, {}, () => {});
  await client.reload();
  assert.deepEqual(session.active, TOOLS);
});
