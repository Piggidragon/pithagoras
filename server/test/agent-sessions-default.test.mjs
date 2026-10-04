import { test, before } from "node:test";
import assert from "node:assert/strict";
import { freePort, inProcessHome, serverEnv, startServer } from "./server-harness.mjs";

/**
 * The Agent tab asks for the first agent's conversations without naming one. The
 * first agent is the one the portal calls that, not an id the code expects: a
 * database whose first agent has another id still has an Agent tab.
 */
const home = inProcessHome("pithagoras-agent-default-");
const { getDb } = await import("../dist/db.js");

let base;
before(async () => {
  ({ base } = await startServer(serverEnv(home, await freePort())));
});

test("the Agent tab without ?agent= answers for the first agent, whatever its id", async () => {
  const plain = await fetch(`${base}/api/agent/sessions`);
  assert.equal(plain.status, 200);

  getDb().prepare("UPDATE agents SET id = 'first-one' WHERE id = 'home'").run();
  const renamed = await fetch(`${base}/api/agent/sessions`);
  assert.equal(renamed.status, 200);
  assert.deepEqual(Object.keys(await renamed.json()).sort(), ["agentHome", "sessions"]);

  // An agent that is named and not there is still not found.
  assert.equal((await fetch(`${base}/api/agent/sessions?agent=nobody`)).status, 404);
});
