import path from "node:path";
import { getDb, onSessionDeleted } from "../db.js";
import { isWithinText } from "../within.js";
import { linkOf } from "./hub.js";
import { hasControl, type DeviceInfo } from "./protocol.js";
import { devicesEnabled, getDevice, type DeviceRecord } from "./store.js";

/**
 * Which chat may use which device, and in which folder there: the grants
 * (architecture, 3.2). A chat starts with none, and nothing reaches a device
 * without one. A grant is the chat's, not the person's: the chat's agent acts
 * on the device, and only while the grant lasts.
 *
 * When a grant ends — taken back, the device removed, the chat deleted — the
 * device is told (`grant.end`), so that what was allowed "for this chat" ends
 * with it there too.
 */

export interface Grant {
  deviceId: string;
  /** Where relative paths and commands start on the device: absolute, in the device's form. */
  cwd: string;
}

export const grantsOf = (sessionId: string): Grant[] =>
  (getDb().prepare("SELECT device_id AS deviceId, cwd FROM session_devices WHERE session_id = ? ORDER BY rowid").all(sessionId) as Grant[]);

export const grantOf = (sessionId: string, deviceId: string): Grant | undefined =>
  getDb().prepare("SELECT device_id AS deviceId, cwd FROM session_devices WHERE session_id = ? AND device_id = ?").get(sessionId, deviceId) as Grant | undefined;

/** Whether the chat has any grant at all: what decides whether its tools take a `device`. */
export const hasGrants = (sessionId: string): boolean =>
  devicesEnabled() && Boolean(getDb().prepare("SELECT 1 FROM session_devices WHERE session_id = ? LIMIT 1").get(sessionId));

export function grantDevice(sessionId: string, deviceId: string, cwd: string): void {
  getDb()
    .prepare("INSERT INTO session_devices (session_id, device_id, cwd) VALUES (?, ?, ?) ON CONFLICT (session_id, device_id) DO UPDATE SET cwd = excluded.cwd")
    .run(sessionId, deviceId, cwd);
}

/** Takes a grant back, and tells the device. False when there was none. */
export function endGrant(sessionId: string, deviceId: string): boolean {
  const gone = getDb().prepare("DELETE FROM session_devices WHERE session_id = ? AND device_id = ?").run(sessionId, deviceId).changes > 0;
  if (gone) tellEnded(deviceId, sessionId);
  return gone;
}

/** The device forgets what it allowed this chat. A device that is not connected has nothing of it left: its approvals ended with the connection. */
export function tellEnded(deviceId: string, sessionId: string): void {
  linkOf(deviceId)?.notify("grant.end", { chat: sessionId });
}

// A deleted chat's grants go with its rows; its devices are told once the delete is done.
onSessionDeleted((sessionId, devices) => {
  for (const deviceId of devices) tellEnded(deviceId, sessionId);
});

// --- paths on the device ---

/** A Windows path as the device takes it: `C:\Users\x` is `/c/Users/x` (protocol.md, 6). */
function fromWindows(p: string): string {
  const drive = /^([A-Za-z]):(?:[\\/]|$)(.*)$/s.exec(p);
  const slashed = (drive ? `/${drive[1].toLowerCase()}/${drive[2]}` : p).replace(/\\/g, "/");
  return slashed;
}

/**
 * A path the agent gave, as an absolute path on the device: `~` is the
 * device's home, a relative path starts in the chat's folder there, and a
 * Windows drive is `/c/...`. pi would resolve both against the portal's own
 * home and folder, so this is done before pi sees the path. Undefined for one
 * that cannot be a path (a NUL byte).
 */
export function devicePath(given: string, info: Pick<DeviceInfo, "os" | "home">, cwd: string): string | undefined {
  if (given.includes("\0")) return undefined;
  let p = given.startsWith("@") ? given.slice(1) : given;
  const windows = info.os === "windows";
  if (windows) p = fromWindows(p);
  const home = windows ? fromWindows(info.home) : info.home;
  if (p === "~") p = home;
  else if (p.startsWith("~/")) p = path.posix.join(home, p.slice(2));
  else if (!p.startsWith("/")) p = path.posix.join(cwd, p || ".");
  const normal = path.posix.normalize(p);
  return normal.length > 1 ? normal.replace(/\/+$/, "") : normal;
}

/** The folder a new grant starts in: the first folder the device offers in Folders mode, its home otherwise. */
export function defaultCwd(info: DeviceInfo): string {
  if (info.mode === "folders" && info.folders[0]) return devicePath(info.folders[0].path, info, "/")!;
  return devicePath(info.home, info, "/")!;
}

/**
 * Why a chat cannot be given this device in this folder, or undefined when it
 * can. The device checks every call on its own; this only keeps the chip from
 * promising a folder the device would refuse.
 */
export function grantRefused(device: DeviceRecord, cwd: string): string | undefined {
  const link = linkOf(device.id);
  if (!link?.info) return `${device.name} is not connected`;
  if (link.sameMachine) return `${device.name} is the portal's own machine and user: the chat's own tools reach the same files`;
  if (!link.can("fs") && !link.can("exec")) return `${device.name} offers no files or commands`;
  if (cwd.length > 4096 || hasControl(cwd) || !cwd.startsWith("/") || cwd.split("/").includes("..")) return "The folder must be an absolute path, without control characters";
  if (link.info.mode === "folders" && !link.info.folders.some((f) => isWithinText(devicePath(f.path, link.info!, "/")!, cwd))) {
    return `${device.name} offers only its folders: ${link.info.folders.map((f) => f.path).join(", ") || "none"}`;
  }
  return undefined;
}

/** A granted device with its grant, by the name the agent passes. */
export function grantedByName(sessionId: string, name: string): { device: DeviceRecord; grant: Grant } | undefined {
  for (const grant of grantsOf(sessionId)) {
    const device = getDevice(grant.deviceId);
    if (device?.name === name) return { device, grant };
  }
  return undefined;
}
