import { X509Certificate, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import express, { type Router } from "express";
import { tlsFiles } from "../http-security.js";
import { sessions } from "../session-manager.js";
import { CLOSE, CODE, DeviceError, readPolicy, type Choice } from "../sync/protocol.js";
import { alertOf, clearAlert, dropAll, dropDevice, linkOf } from "../sync/hub.js";
import {
  CODE_ATTEMPTS,
  NameTaken,
  cancelPairingCode,
  devicesEnabled,
  devicesRefused,
  getDevice,
  listDevices,
  newPairingCode,
  pairingOpen,
  removeDevice,
  renameDevice,
  setDevicesEnabled,
  type DeviceRecord,
} from "../sync/store.js";

/**
 * The SPKI pin of the certificate the portal serves, for the pairing URI: the
 * client pins it, so a self-signed certificate works and no other does. Only
 * when the portal serves TLS itself; behind a TLS proxy the proxy's certificate
 * is the one the device sees, and the system's roots check it.
 */
function spkiPin(): string | null {
  const tls = tlsFiles();
  if (!tls) return null;
  try {
    const der = new X509Certificate(readFileSync(tls.cert)).publicKey.export({ type: "spki", format: "der" });
    return createHash("sha256").update(der).digest("base64url");
  } catch {
    return null;
  }
}

/** A device as the page shows it: the row, and what its live connection says. */
function shown(device: DeviceRecord) {
  const link = linkOf(device.id);
  return {
    ...device,
    online: Boolean(link),
    connectedAt: link ? new Date(link.connectedAt).toISOString() : null,
    hello: link ? { clientVersion: link.hello.client_version, user: link.hello.user, shell: link.hello.shell, capabilities: link.hello.capabilities } : null,
    info: link?.info ?? null,
    sameMachine: link?.sameMachine ?? null,
    approvals: link ? [...link.approvals.values()] : [],
    policy: link?.policy ?? null,
    alert: alertOf(device.id) ?? null,
  };
}

const failed = (res: express.Response, e: unknown) => {
  if (e instanceof DeviceError) {
    const status = e.code === CODE.DENIED ? 403 : e.code === CODE.CONFLICT ? 409 : e.code === CODE.NOT_FOUND ? 404 : e.code === CODE.INVALID_PARAMS ? 400 : 502;
    return res.status(status).json({ error: e.message, code: e.code });
  }
  res.status(500).json({ error: (e as Error).message });
};

const CHOICES: Choice[] = ["once", "chat", "time", "deny"];

/**
 * The Devices add-on: its switch, pairing, the list, and what the owner may do
 * with a connected device from the portal — answer its approvals, and read or
 * change its settings where its owner allowed that on the device.
 */
export function devicesRouter(): Router {
  const router = express.Router();

  router.get("/features/devices", (_req, res) => {
    res.json({ enabled: devicesEnabled(), refused: devicesRefused() ?? null });
  });

  router.put("/features/devices", async (req, res) => {
    const { enabled } = req.body ?? {};
    if (typeof enabled !== "boolean") return res.status(400).json({ error: "enabled must be true or false" });
    try {
      const was = devicesEnabled();
      setDevicesEnabled(enabled);
      if (!enabled) {
        cancelPairingCode();
        // The devices stay paired and try again on their own; until the add-on is back on nothing answers them.
        dropAll(CLOSE.goingAway, "devices switched off");
      }
      // Whether a chat has the device tools is settled when it loads.
      const { reloaded, waiting } = was !== enabled ? await sessions.reloadIdle() : { reloaded: 0, waiting: 0 };
      res.json({ enabled: devicesEnabled(), refused: devicesRefused() ?? null, reloaded, waiting });
    } catch (e) {
      res.status(409).json({ error: (e as Error).message });
    }
  });

  // Everything below only while the add-on is on.
  router.use("/devices", (_req, res, next) => {
    if (!devicesEnabled()) return res.status(404).json({ error: "Devices are switched off. Switch them on in Settings → Add-ons." });
    next();
  });

  router.get("/devices", (_req, res) => {
    const open = pairingOpen();
    res.json({ devices: listDevices().map(shown), pairing: open ? { expires: new Date(open.expires).toISOString() } : null, spki: spkiPin() });
  });

  /** A new one-time code, which replaces any open one. Said this once: only its expiry is kept to show again. */
  router.post("/devices/pair", (_req, res) => {
    const { code, expires } = newPairingCode();
    res.setHeader("Cache-Control", "no-store");
    res.json({ code, expires: new Date(expires).toISOString(), attempts: CODE_ATTEMPTS, spki: spkiPin() });
  });

  router.delete("/devices/pair", (_req, res) => {
    cancelPairingCode();
    res.json({ ok: true });
  });

  router.put("/devices/:id", (req, res) => {
    if (!getDevice(req.params.id)) return res.status(404).json({ error: "No such device" });
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    try {
      const device = renameDevice(req.params.id, name)!;
      // The chats that have it name it in their prompt: reloaded when idle.
      void sessions.reloadIdle().catch(() => {});
      res.json({ device: shown(device) });
    } catch (e) {
      res.status(e instanceof NameTaken ? 409 : 400).json({ error: (e as Error).message });
    }
  });

  /** Removes a device: its token stops working and its connection is closed now, before the answer. */
  router.delete("/devices/:id", (req, res) => {
    const device = getDevice(req.params.id);
    if (!device) return res.status(404).json({ error: "No such device" });
    const chats = removeDevice(device.id);
    dropDevice(device.id, CLOSE.revoked, "device removed");
    console.log(`[devices] removed ${device.name}`);
    if (chats.length) void sessions.reloadIdle().catch(() => {});
    res.json({ ok: true });
  });

  router.delete("/devices/:id/alert", (req, res) => {
    clearAlert(req.params.id);
    res.json({ ok: true });
  });

  /** The owner's answer to one of the device's approvals. */
  router.post("/devices/:id/approvals/:approval", async (req, res) => {
    const link = linkOf(req.params.id);
    if (!link) return res.status(409).json({ error: "The device is not connected" });
    const id = Number(req.params.approval);
    const { answer, minutes } = req.body ?? {};
    if (!Number.isInteger(id) || !CHOICES.includes(answer)) return res.status(400).json({ error: "answer must be once, chat, time or deny" });
    if (answer === "time" && !(Number.isInteger(minutes) && minutes >= 1)) return res.status(400).json({ error: "minutes must be a whole number of at least 1" });
    try {
      await link.answerApproval(id, answer, minutes);
      res.json({ ok: true });
    } catch (e) {
      failed(res, e);
    }
  });

  /** The device's settings, as it shares them; read anew, so the page shows what holds now. */
  router.get("/devices/:id/policy", async (req, res) => {
    const link = linkOf(req.params.id);
    if (!link) return res.status(409).json({ error: "The device is not connected" });
    if (!link.can("policy")) return res.status(403).json({ error: "The device's owner does not share its settings with the portal" });
    try {
      const policy = readPolicy(await link.call("policy.get", {}, { timeoutMs: 30_000 }));
      if (!policy) return res.status(502).json({ error: "The device answered something that is not its settings" });
      link.policy = policy;
      res.json({ policy });
    } catch (e) {
      failed(res, e);
    }
  });

  /**
   * Changes the device's settings: only where its owner set portal_policy to
   * write on the device, which the device checks, not the portal. Only this
   * route sends policy.set, and only the signed-in owner reaches it: no tool of
   * the agent's does.
   */
  router.put("/devices/:id/policy", async (req, res) => {
    const link = linkOf(req.params.id);
    if (!link) return res.status(409).json({ error: "The device is not connected" });
    const { settings, ifVersion } = req.body ?? {};
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) return res.status(400).json({ error: "settings must be an object" });
    if (ifVersion !== undefined && typeof ifVersion !== "string") return res.status(400).json({ error: "ifVersion must be text" });
    try {
      const policy = readPolicy(await link.call("policy.set", { settings, ...(ifVersion ? { if_version: ifVersion } : {}) }, { timeoutMs: 30_000 }));
      if (policy) link.policy = policy;
      res.json({ policy: policy ?? null });
    } catch (e) {
      failed(res, e);
    }
  });

  return router;
}
