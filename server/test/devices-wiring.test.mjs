import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import express from "express";
import { fakeModel, resultsIn } from "./fake-model.mjs";
import { inProcessHome } from "./server-harness.mjs";

/**
 * The device tools as pi runs them: registered by the portal's own client for
 * a chat with a grant, offered to a model, called by it, and checked by the
 * guard. The other tests call the tools by hand; this is the one that would
 * notice pi changing how a tool of a built-in name is registered or activated.
 */
const home = inProcessHome("pithagoras-devices-wiring-");
process.env.PORTAL_PASSWORD = "a-long-enough-password";
mkdirSync(path.join(process.env.PI_CODING_AGENT_DIR, "extensions"), { recursive: true });

// A package's tool that runs commands, as a background-task package's would: it knows nothing of devices.
const marker = path.join(home, "ran-on-the-server");
writeFileSync(path.join(process.env.PI_CODING_AGENT_DIR, "extensions", "bg.ts"), `
import { writeFileSync } from "node:fs";
export default function (pi) {
  pi.registerTool({
    name: "bg_run",
    label: "Run in the background",
    description: "Run a command in the background",
    parameters: { type: "object", properties: { command: { type: "string" } } },
    async execute() {
      writeFileSync(${JSON.stringify(marker)}, "x");
      return { content: [{ type: "text", text: "started" }], details: {} };
    },
  });
}
`);

let script = [];
const model = await fakeModel((request) => script[resultsIn(request)] ?? "Done.");
writeFileSync(path.join(process.env.PI_CODING_AGENT_DIR, "models.json"), JSON.stringify(model.models()));

const { SdkPiClient } = await import("../dist/pi/sdk-client.js");
const { pairRouter } = await import("../dist/sync/pair.js");
const { attachSyncUpgrade, linkOf, dropDevice } = await import("../dist/sync/hub.js");
const store = await import("../dist/sync/store.js");
const grants = await import("../dist/sync/grants.js");
const { createSession } = await import("../dist/db.js");
const { connect, until } = await import("./fake-device.mjs");

let server;
let base;
before(async () => {
  const app = express();
  app.use(pairRouter());
  server = http.createServer(app);
  attachSyncUpgrade(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `127.0.0.1:${server.address().port}`;
  store.setDevicesEnabled(true);
});
after(() => {
  for (const d of store.listDevices()) dropDevice(d.id);
  server.closeAllConnections();
  server.close();
});

const textOf = (result) => JSON.stringify(result.result);
const nameOf = (tool) => tool.function?.name ?? tool.name;

test("a granted chat's model is offered the tools with a device, calls one on the device, and cannot take another tool there", async () => {
  const { code } = store.newPairingCode();
  const paired = await fetch(`http://${base}/sync/v1/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name: "laptop", os: "linux", arch: "x86_64" }) }).then((r) => r.json());
  const { device } = await connect(base, paired.connector_token, {
    answers: { "fs.read": (params, id, d) => d.sendFile(params, id, "on the laptop\n") },
  });
  await until(() => linkOf(paired.device_id)?.info, "the device");

  const cwd = mkdtempSync(path.join(process.env.WORKSPACE_ROOT, "chat-"));
  createSession({ id: "granted", title: "granted", workspace: cwd, executor: "host", kind: "task" });
  grants.grantDevice("granted", paired.device_id, "/home/alice/src");
  const client = await SdkPiClient.create({ cwd, sessionDir: mkdtempSync(path.join(home, "pi-")), provider: "fake", modelId: "m", sessionId: "granted", devices: true });
  const results = [];
  let settled;
  client.on("event", (e) => {
    if (e?.type === "tool_execution_end") results.push(e);
    if (e?.type === "agent_settled") settled?.();
  });
  const run = async (steps) => {
    script = steps;
    results.length = 0;
    const done = new Promise((r) => (settled = r));
    await client.prompt("Go on");
    await done;
    return [...results];
  };
  try {
    const session = client.session;
    // The devices' tools in place of pi's own, grep, find and ls among the active ones.
    const own = (name) => session.getAllTools().find((t) => t.name === name)?.sourceInfo?.path;
    for (const name of ["read", "write", "edit", "bash", "grep", "find", "ls"]) assert.equal(own(name), "<inline:devices>", name);
    for (const name of ["grep", "find", "ls"]) assert.ok(session.getActiveToolNames().includes(name), name);

    const [read, foreign] = await run([
      { name: "read", args: { path: "notes.txt", device: "laptop" } },
      { name: "bg_run", args: { command: "make", device: "laptop" } },
    ]);
    assert.equal(read.isError, false, textOf(read));
    assert.match(textOf(read), /on the laptop/);
    assert.equal(device.asked("fs.read")[0].params.path, "/home/alice/src/notes.txt");
    assert.equal(device.asked("fs.read")[0].params.ctx.chat, "granted");
    assert.equal(foreign.isError, true);
    assert.match(textOf(foreign), /bg_run does not run on paired devices/);
    assert.equal(existsSync(marker), false, "nor on the server instead");

    const request = model.requests.at(-1);
    const offered = request.tools.find((t) => nameOf(t) === "read");
    assert.ok((offered.function?.parameters ?? offered.parameters).properties.device, "read takes a device");
    assert.match(JSON.stringify(request.messages[0]), /Devices granted to this chat: laptop \(linux, folder \\"\/home\/alice\/src\\"\)/);

    // Taken back: the tools stay and fail closed; grep, find and ls are off again, and the prompt says nothing of devices.
    grants.endGrant("granted", paired.device_id);
    await client.reload();
    for (const name of ["grep", "find", "ls"]) assert.ok(!session.getActiveToolNames().includes(name), name);
    assert.equal(own("read"), "<inline:devices>");
    // The script goes by the results in the conversation: two are there already.
    const [after] = await run([undefined, undefined, { name: "read", args: { path: "notes.txt", device: "laptop" } }]);
    assert.equal(after.isError, true);
    assert.match(textOf(after), /No device is granted to this chat/);
    assert.equal(device.asked("fs.read").length, 1);
    assert.doesNotMatch(JSON.stringify(model.requests.at(-1).messages[0]), /Devices granted/);
  } finally {
    client.dispose();
  }
});

test("a chat never granted a device keeps pi's own tools", async () => {
  const cwd = mkdtempSync(path.join(process.env.WORKSPACE_ROOT, "chat-"));
  createSession({ id: "plain", title: "plain", workspace: cwd, executor: "host", kind: "task" });
  const client = await SdkPiClient.create({ cwd, sessionDir: mkdtempSync(path.join(home, "pi-")), provider: "fake", modelId: "m", sessionId: "plain", devices: true });
  try {
    assert.equal(client.session.getAllTools().find((t) => t.name === "read").sourceInfo.path, "<builtin:read>");
    assert.deepEqual(client.session.getActiveToolNames().filter((n) => ["grep", "find", "ls"].includes(n)), []);
  } finally {
    client.dispose();
  }
});
