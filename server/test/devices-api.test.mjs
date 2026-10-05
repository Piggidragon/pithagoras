import { test, before } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { freePort, serverEnv, startServer, testHome } from "./server-harness.mjs";

/**
 * The Devices add-on in the whole server, as it is deployed: the switch, the
 * routes behind the login, and the two sync routes in front of it, which a
 * device reaches with its code or token and nothing else.
 */
const PASSWORD = "correct horse battery";
let base;
let open;
before(async () => {
  ({ base } = await startServer(serverEnv(testHome("pithagoras-devices-api-"), await freePort(), { PORTAL_PASSWORD: PASSWORD, PORTAL_ALLOW_NO_PASSWORD: "" })));
  ({ base: open } = await startServer(serverEnv(testHome("pithagoras-devices-open-"), await freePort())));
});

let cookie;
async function api(route, { method = "GET", body, as = cookie, at = base } = {}) {
  const res = await fetch(at + route, { method, headers: { ...(as ? { Cookie: as } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
}

const ws = (path) => base.replace("http", "ws") + path;

/** A device that connects with its token, says hello and answers what the portal asks. */
function device(token, answers = {}) {
  return new Promise((resolve) => {
    const sock = new WebSocket(ws("/sync/v1/connect"), { headers: { Authorization: `Bearer ${token}` }, perMessageDeflate: false });
    const got = [];
    sock.on("unexpected-response", (_req, res) => resolve({ status: res.statusCode }));
    sock.on("error", () => {});
    const closed = new Promise((r) => sock.on("close", (code) => r(code)));
    sock.on("message", (data, isBinary) => {
      if (isBinary) return;
      const m = JSON.parse(String(data));
      got.push(m);
      const all = {
        "device.info": { name: "laptop", os: "linux", arch: "x86_64", os_release: null, hostname: "laptop", user: "alice", uid: 4242, home: "/home/alice", shell: "bash", session: "headless", mode: "ask", mode_expires_ms: null, folders: [], folders_shell: "landlock", tools: ["read", "bash"], mcp_tools: [], client_version: "0.1.0" },
        "device.probe": { found: false, sha256: null, user: "alice", uid: 4242 },
        "approval.list": { approvals: [{ id: 3, call: 1, chat: "c1", tool: "exec", target: "make", reasons: ["Ask mode"], preview: null, choices: ["once", "chat", "time", "deny"], max_minutes: 480, created_ms: 1, expires_ms: 2 }] },
        "policy.get": { portal_policy: "read", version: "v1", settings: { policy: { mode: "ask" }, exec: {} }, device_only: ["allow_root"] },
        "approval.answer": {},
        ...answers,
      };
      if (m.id !== undefined && m.method in all) {
        const a = all[m.method];
        sock.send(JSON.stringify(a.error ? { jsonrpc: "2.0", id: m.id, error: a.error } : { jsonrpc: "2.0", id: m.id, result: a }));
      }
    });
    sock.on("open", () => {
      sock.send(JSON.stringify({ jsonrpc: "2.0", method: "hello", params: { proto: 1, device_id: token.split(".")[0], client_version: "0.1.0", os: "linux", user: "alice", shell: "bash", capabilities: ["fs", "exec", "probe", "approvals", "policy"] } }));
      resolve({ status: 101, sock, got, closed });
    });
  });
}

const until = async (check, what) => {
  for (let i = 0; i < 300; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.fail(`waited in vain for ${what}`);
};

test("a portal without a password (a reverse proxy in front) can switch devices on", async () => {
  assert.equal((await api("/api/features/devices", { at: open, as: null })).body.enabled, false);
  const on = await api("/api/features/devices", { at: open, as: null, method: "PUT", body: { enabled: true } });
  assert.equal(on.status, 200);
  assert.equal(on.body.enabled, true);
  assert.equal((await api("/api/features/flags", { at: open, as: null })).body.devices.enabled, true);
});

test("the add-on is off at first, and its routes and the sync routes answer nothing until it is on", async () => {
  const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: PASSWORD }) });
  cookie = login.headers.getSetCookie()[0].split(";")[0];
  assert.equal((await api("/api/features/flags")).body.devices.enabled, false);
  assert.equal((await api("/api/devices")).status, 404);
  assert.equal((await api("/sync/v1/pair", { as: null, method: "POST", body: { code: "ABCDEFGH", name: "x", os: "linux", arch: "x86_64" } })).status, 404);
  assert.equal((await device("d0000000000000000.xxxxxxxxxxxxxxxxxxxx")).status, 503);
  // Behind the login, the switch and the page alike.
  assert.equal((await api("/api/features/devices", { as: null, method: "PUT", body: { enabled: true } })).status, 401);
  assert.equal((await api("/api/devices", { as: null })).status, 401);
  assert.equal((await api("/api/features/devices", { method: "PUT", body: { enabled: true } })).body.enabled, true);
  assert.equal((await api("/api/features/flags")).body.devices.enabled, true);
});

test("pairing, the list, rename, approvals, settings, and removal that cuts the device off", async () => {
  assert.equal((await api("/api/devices/pair", { as: null, method: "POST" })).status, 401);
  const code = await api("/api/devices/pair", { method: "POST" });
  assert.equal(code.status, 200);
  assert.match(code.body.code, /^[A-HJ-NP-Z2-9]{8}$/);
  assert.equal(code.headers.get("cache-control"), "no-store");
  assert.equal(code.body.spki, null, "plain HTTP: nothing to pin");
  assert.ok((await api("/api/devices")).body.pairing.expires);
  // The code is the device's login: the pair route is in front of the portal's.
  const paired = await api("/sync/v1/pair", { as: null, method: "POST", body: { code: code.body.code, name: "laptop", os: "linux", arch: "x86_64" } });
  assert.equal(paired.status, 200);
  assert.equal((await api("/api/devices")).body.pairing, null);
  const { device_id: id, connector_token: token } = paired.body;

  // The portal's upgrade listener for the browser leaves the sync path to the hub.
  const dev = await device(token);
  assert.equal(dev.status, 101);
  await until(async () => (await api("/api/devices")).body.devices[0]?.policy, "the device's settings");
  const [shown] = (await api("/api/devices")).body.devices;
  assert.equal(shown.online, true);
  assert.equal(shown.info.mode, "ask");
  assert.equal(shown.sameMachine, false);
  assert.equal(shown.hello.clientVersion, "0.1.0");
  assert.deepEqual(shown.approvals.map((a) => a.id), [3]);
  assert.equal(shown.policy.portal_policy, "read");
  assert.equal(shown.token_hash, undefined);
  assert.ok(!JSON.stringify(shown).includes(token.split(".")[1]));

  assert.equal((await api(`/api/devices/${id}`, { method: "PUT", body: { name: "Not Valid" } })).status, 400);
  assert.equal((await api(`/api/devices/${id}`, { method: "PUT", body: { name: "desk" } })).body.device.name, "desk");

  assert.equal((await api(`/api/devices/${id}/approvals/3`, { method: "POST", body: { answer: "always" } })).status, 400);
  assert.equal((await api(`/api/devices/${id}/approvals/3`, { method: "POST", body: { answer: "time" } })).status, 400);
  assert.equal((await api(`/api/devices/${id}/approvals/3`, { method: "POST", body: { answer: "time", minutes: 30 } })).status, 200);
  assert.deepEqual(dev.got.find((m) => m.method === "approval.answer").params, { id: 3, answer: "time", minutes: 30 });

  assert.equal((await api(`/api/devices/${id}/policy`)).body.policy.version, "v1");
  // The device decides whether the portal may change its settings; its refusal comes back as one.
  dev.sock.close(1000);
  await dev.closed;
  await until(async () => !(await api("/api/devices")).body.devices[0].online, "offline");
  const refusing = await device(token, { "policy.set": { error: { code: -32001, message: "portal_policy is read" } } });
  await until(async () => (await api("/api/devices")).body.devices[0]?.online, "online");
  const set = await api(`/api/devices/${id}/policy`, { method: "PUT", body: { settings: { policy: { mode: "full" } }, ifVersion: "v1" } });
  assert.equal(set.status, 403);
  assert.match(set.body.error, /portal_policy is read/);
  assert.deepEqual(refusing.got.find((m) => m.method === "policy.set").params, { settings: { policy: { mode: "full" } }, if_version: "v1" });

  assert.equal((await api(`/api/devices/${id}`, { method: "DELETE" })).status, 200);
  assert.equal(await refusing.closed, 4001);
  assert.equal((await device(token)).status, 401);
  assert.deepEqual((await api("/api/devices")).body.devices, []);
});

test("switching the add-on off drops connected devices and the open code", async () => {
  const code = (await api("/api/devices/pair", { method: "POST" })).body.code;
  const { connector_token: token } = (await api("/sync/v1/pair", { as: null, method: "POST", body: { code, name: "box", os: "linux", arch: "x86_64" } })).body;
  const dev = await device(token);
  await until(async () => (await api("/api/devices")).body.devices[0]?.online, "online");
  await api("/api/devices/pair", { method: "POST" });
  assert.equal((await api("/api/features/devices", { method: "PUT", body: { enabled: false } })).body.enabled, false);
  assert.equal(await dev.closed, 1001);
  assert.equal((await device(token)).status, 503);
  // The device stays paired: on again, it connects with the same token, and the old code is gone.
  await api("/api/features/devices", { method: "PUT", body: { enabled: true } });
  assert.equal((await api("/api/devices")).body.pairing, null);
  const back = await device(token);
  assert.equal(back.status, 101);
  back.sock.close(1000);
});
