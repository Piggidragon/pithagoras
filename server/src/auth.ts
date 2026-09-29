import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { isSignedOut, recordSignOut } from "./db.js";

/**
 * Shared-password gate.
 *
 * This portal can run arbitrary code on the host, so even on a Tailscale-only
 * network it should not be drivable by anything that happens to reach the port.
 * The cookie is an HMAC of an expiry stamp — no session store needed, except
 * for the ones signed out early, which are remembered until they would expire.
 */
const PASSWORD = process.env.PORTAL_PASSWORD || "";
const SECRET = process.env.PORTAL_SECRET || crypto.randomBytes(32).toString("hex");
const COOKIE = (process.env.VOICE_COMPARISON === "true" || process.env.VOICE_PIPELINE_MODE === "sequential") ? "pi_portal_sequential_auth" : "pi_portal_auth";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const authEnabled = PASSWORD.length > 0;
/** Running without a login is a deliberate choice, never what an empty .env falls back to. */
const allowNoPassword = /^(1|true|yes)$/i.test(process.env.PORTAL_ALLOW_NO_PASSWORD ?? "");

if (!authEnabled && !allowNoPassword) {
  console.error(
    "\n  PORTAL_PASSWORD is not set. This portal runs arbitrary commands on the\n" +
      "  host, so it refuses to start without a login rather than open the port.\n" +
      "  Set PORTAL_PASSWORD (and PORTAL_SECRET to keep logins across restarts),\n" +
      "  or set PORTAL_ALLOW_NO_PASSWORD=1 when a reverse proxy authenticates in\n" +
      "  front of it and nothing else can reach the port.\n"
  );
  process.exit(1);
}

if (!authEnabled) {
  console.warn(
    "\n  WARNING: PORTAL_ALLOW_NO_PASSWORD is set and PORTAL_PASSWORD is not — the\n" +
      "  portal is open to anyone who can reach it, and it can run arbitrary\n" +
      "  commands on this machine. Only the proxy in front of it stops them.\n" +
      "  It binds loopback unless ALLOW_OPEN=1 explicitly exposes it.\n"
  );
}

function sign(expiry: number): string {
  const mac = crypto.createHmac("sha256", SECRET).update(String(expiry)).digest("hex");
  return `${expiry}.${mac}`;
}

/** The token's expiry and signature, if it is one this portal signed and it has not run out. */
function genuine(token: string | undefined): { expiry: number; mac: string } | null {
  if (!token) return null;
  const [expiryStr, mac] = token.split(".");
  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return null;
  const expected = crypto.createHmac("sha256", SECRET).update(expiryStr).digest("hex");
  const a = Buffer.from(mac ?? "");
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? { expiry, mac } : null;
}

function verify(token: string | undefined): boolean {
  const login = genuine(token);
  return login !== null && !isSignedOut(login.mac);
}

export function issueCookie(res: Response): void {
  res.cookie(COOKIE, sign(Date.now() + MAX_AGE_MS), {
    httpOnly: true,
    sameSite: "lax",
    maxAge: MAX_AGE_MS,
  });
}

/**
 * Ends this browser's login: the cookie is cleared, and the login it held is
 * refused from now on, so a copy of it taken elsewhere stops working too.
 */
export function signOut(req: Request, res: Response): void {
  const login = genuine(req.cookies?.[COOKIE]);
  if (login) recordSignOut(login.mac, login.expiry);
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: "lax" });
}

export function checkPassword(candidate: unknown): boolean {
  if (typeof candidate !== "string" || !authEnabled) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!authEnabled) return next();
  if (verify(req.cookies?.[COOKIE])) return next();
  res.status(401).json({ error: "Unauthorized" });
}

export function isAuthed(req: Request): boolean {
  return !authEnabled || verify(req.cookies?.[COOKIE]);
}
