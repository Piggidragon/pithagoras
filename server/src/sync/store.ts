import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { getDb, getSetting, putSetting } from "../db.js";
import { authEnabled } from "../auth.js";
import { isDeviceName } from "./protocol.js";

/**
 * The paired devices and the Devices add-on's switch, as the portal keeps them.
 *
 * A connector token is `<device id>.<43 characters of base64url>`: 256 random
 * bits behind the id. The id finds the row; the token is then compared with
 * the stored sha256 in constant time, so how long a refusal takes says nothing
 * about how close a guess was. Only the hash is kept, so the database alone
 * does not let anybody connect as a device.
 */

export interface DeviceRow {
  id: string;
  name: string;
  os: string;
  arch: string;
  token_hash: string;
  created_at: string;
  last_seen: string | null;
}

/** What is shown of a device: never its token's hash. */
export type DeviceRecord = Omit<DeviceRow, "token_hash">;

const SWITCH = "devices_enabled";

/** Whether the Devices add-on is on. Off in a fresh install. */
export const devicesEnabled = (): boolean => getSetting(SWITCH) === "1";

/**
 * Why the add-on cannot be switched on here, or undefined when it can. A portal
 * without a password would hand every paired computer to whoever reaches it.
 */
export const devicesRefused = (): string | undefined =>
  authEnabled ? undefined : "The portal runs without a password (PORTAL_ALLOW_NO_PASSWORD), and a paired computer would be open to anyone who reaches it. Set PORTAL_PASSWORD first.";

export function setDevicesEnabled(on: boolean): void {
  if (on && devicesRefused()) throw new Error(devicesRefused());
  putSetting(SWITCH, on ? "1" : "");
}

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export const listDevices = (): DeviceRecord[] =>
  getDb().prepare("SELECT id, name, os, arch, created_at, last_seen FROM devices ORDER BY name").all() as DeviceRecord[];

export const getDevice = (id: string): DeviceRecord | undefined =>
  getDb().prepare("SELECT id, name, os, arch, created_at, last_seen FROM devices WHERE id = ?").get(id) as DeviceRecord | undefined;

export const deviceByName = (name: string): DeviceRecord | undefined =>
  getDb().prepare("SELECT id, name, os, arch, created_at, last_seen FROM devices WHERE name = ?").get(name) as DeviceRecord | undefined;

/** The device a connector token belongs to, or undefined for one that is unknown, revoked or malformed. */
export function deviceOfToken(token: string): DeviceRecord | undefined {
  const dot = token.indexOf(".");
  if (dot <= 0 || token.length > 512) return undefined;
  const row = getDb().prepare("SELECT * FROM devices WHERE id = ?").get(token.slice(0, dot)) as DeviceRow | undefined;
  // Compared even when there is no row, against a hash nothing has: the time taken is the same either way.
  const stored = Buffer.from(row?.token_hash ?? "0".repeat(64), "hex");
  const given = Buffer.from(hash(token), "hex");
  if (!timingSafeEqual(stored, given) || !row) return undefined;
  const { token_hash: _h, ...record } = row;
  return record;
}

/**
 * The name a new device gets: the one it asked for, or with a number after it
 * when that is taken, as a computer paired again after `unpair` would be.
 */
function freeName(wanted: string): string {
  if (!deviceByName(wanted)) return wanted;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const name = wanted.slice(0, 24 - suffix.length) + suffix;
    if (!deviceByName(name)) return name;
  }
}

/** A new device and its connector token, which is said this once and never kept. */
export function addDevice(req: { name: string; os: string; arch: string }): { device: DeviceRecord; token: string } {
  if (!isDeviceName(req.name)) throw new Error("A device name is 1 to 24 of a-z, 0-9 and -, and not server or portal");
  const id = `d${randomBytes(8).toString("hex")}`;
  const token = `${id}.${randomBytes(32).toString("base64url")}`;
  const name = freeName(req.name);
  getDb().prepare("INSERT INTO devices (id, name, os, arch, token_hash) VALUES (?, ?, ?, ?, ?)").run(id, name, req.os, req.arch, hash(token));
  return { device: getDevice(id)!, token };
}

export class NameTaken extends Error {}

export function renameDevice(id: string, name: string): DeviceRecord | undefined {
  if (!isDeviceName(name)) throw new Error("A device name is 1 to 24 of a-z, 0-9 and -, and not server or portal");
  const other = deviceByName(name);
  if (other && other.id !== id) throw new NameTaken(`Another device is called ${name}`);
  getDb().prepare("UPDATE devices SET name = ? WHERE id = ?").run(name, id);
  return getDevice(id);
}

/** Forgets a device, its token and every chat's grant of it, in one go. The chats it was granted to are returned. */
export function removeDevice(id: string): string[] {
  const d = getDb();
  return d.transaction(() => {
    const chats = (d.prepare("SELECT session_id FROM session_devices WHERE device_id = ?").all(id) as { session_id: string }[]).map((r) => r.session_id);
    d.prepare("DELETE FROM session_devices WHERE device_id = ?").run(id);
    d.prepare("DELETE FROM devices WHERE id = ?").run(id);
    return chats;
  })();
}

export function touchDevice(id: string): void {
  getDb().prepare("UPDATE devices SET last_seen = datetime('now') WHERE id = ?").run(id);
}

// --- the pairing code ---

/** No 0/O or 1/I: the code is read off one screen and typed into another. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
export const CODE_MINUTES = 10;
/** Wrong codes in all, from anywhere, before the open code is cancelled. */
export const CODE_ATTEMPTS = 10;

/**
 * One code is open at a time, in memory: a restart cancels it. The attempts
 * are counted for the code, not per address: behind a reverse proxy every
 * request comes from the proxy, and a per-address count would count nothing.
 */
let open: { hash: string; expires: number; wrong: number } | undefined;

export function newPairingCode(now = Date.now()): { code: string; expires: number } {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  open = { hash: hash(code), expires: now + CODE_MINUTES * 60_000, wrong: 0 };
  return { code, expires: open.expires };
}

export function cancelPairingCode(): void {
  open = undefined;
}

/** When the open code runs out, or undefined when there is none. */
export function pairingOpen(now = Date.now()): { expires: number } | undefined {
  if (open && open.expires <= now) open = undefined;
  return open ? { expires: open.expires } : undefined;
}

/**
 * Takes the code: true once, for the open code before it runs out. A wrong one
 * counts against the open code, which is cancelled at the tenth.
 */
export function takePairingCode(code: string, now = Date.now()): boolean {
  if (!pairingOpen(now) || !open) return false;
  const right = timingSafeEqual(Buffer.from(open.hash, "hex"), Buffer.from(hash(code.toUpperCase()), "hex"));
  if (right) {
    open = undefined;
    return true;
  }
  if (++open.wrong >= CODE_ATTEMPTS) open = undefined;
  return false;
}
