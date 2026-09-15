import { randomBytes } from "node:crypto";
import { getStoredSettings, getDb } from "../db.js";
import { containerState, dockerAvailable, imagePresent, pullImage, request } from "./docker.js";
import * as local from "./browser-local.js";

/**
 * The agent's browser, as something the portal installs rather than something
 * every deployment carries.
 *
 * It used to be a service in docker-compose.yml, which meant everyone who never
 * wanted a browser still had it in their file, still had to know why it was
 * there, and — for a while — could not start the portal without setting its
 * password. Installed from the UI instead: nothing exists until somebody asks,
 * and removing it leaves no trace but the profile.
 */

export const IMAGE = "lscr.io/linuxserver/chromium:latest";
export const CONTAINER = "pithagoras-browser";
/** The name compose used, so an existing profile — and its logins — carries over. */
export const VOLUME = process.env.BROWSER_VOLUME || "pithagoras_browser-profile";

export interface BrowserConfig {
  user: string;
  password: string;
  port: string;
  httpsPort: string;
}

/**
 * Settings first, environment second.
 *
 * The environment is how the compose version was configured, and a deployment
 * upgrading from it should not have to retype anything.
 */
export function config(): BrowserConfig {
  const s = getStoredSettings() as Record<string, string>;
  return {
    user: s.browser_user || process.env.BROWSER_USER || "agent",
    password: s.browser_password || process.env.BROWSER_PASSWORD || "",
    port: s.browser_port || process.env.BROWSER_PORT || "3010",
    httpsPort: s.browser_https_port || process.env.BROWSER_HTTPS_PORT || "3011",
  };
}

export function saveConfig(patch: Partial<BrowserConfig>): BrowserConfig {
  const upsert = getDb().prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  const map: Record<keyof BrowserConfig, string> = {
    user: "browser_user",
    password: "browser_password",
    port: "browser_port",
    httpsPort: "browser_https_port",
  };
  for (const [k, v] of Object.entries(patch)) {
    if (typeof v === "string" && v) upsert.run(map[k as keyof BrowserConfig], v);
  }
  return config();
}

/** Progress of a pull in flight, so a multi-gigabyte download is not silence. */
let pulling: { active: boolean; line: string; error?: string } = { active: false, line: "" };
export const pullState = () => pulling;

/**
 * Which of the two ways this deployment can run a browser.
 *
 * Docker first where it is available: a container costs nothing to anyone who
 * does not install it, and gives a real headful browser whatever the host looks
 * like. A local Chrome is the fallback for deployments with no socket, and uses
 * what is already on the machine rather than adding to the image.
 */
export async function status() {
  if (process.env.BROWSER_EXTERNAL === 'true') {
    let running = false;
    try {
      const response = await fetch(`${process.env.BROWSER_CDP_URL || 'http://127.0.0.1:9222'}/json/version`, {signal: AbortSignal.timeout(4000)});
      running = response.ok && typeof (await response.json() as {Browser?:string}).Browser === 'string';
    } catch { /* An externally managed browser can be stopped independently. */ }
    return {available:false, mode:'external' as const, image:true, container:running ? 'running' as const : 'stopped' as const, pulling};
  }
  if (!dockerAvailable()) {
    const l = local.status();
    return {
      available: l.available,
      mode: "local" as const,
      image: l.available,
      container: (l.running ? "running" : l.available ? "stopped" : "unavailable") as
        | "absent"
        | "stopped"
        | "running"
        | "unavailable",
      binary: l.binary,
      headless: l.headless,
      pulling,
    };
  }
  const [image, state] = await Promise.all([imagePresent(IMAGE), containerState(CONTAINER)]);
  return {
    available: true,
    mode: "docker" as const,
    image,
    container: (!state.exists ? "absent" : state.running ? "running" : "stopped") as
      | "absent"
      | "stopped"
      | "running",
    pulling,
  };
}

/**
 * The container, as validated by hand before any of this was automated.
 *
 * seccomp:unconfined is chromium's own sandbox needing room; the alternative is
 * --no-sandbox, which is worse. Host networking is what puts the debugging port
 * on the same loopback as the portal without publishing it anywhere.
 */
function spec(cfg: BrowserConfig) {
  return {
    Image: IMAGE,
    Env: [
      "PUID=0",
      "PGID=0",
      `TZ=${process.env.TZ || "Etc/UTC"}`,
      `CUSTOM_USER=${cfg.user}`,
      `PASSWORD=${cfg.password}`,
      `CUSTOM_PORT=${cfg.port}`,
      `CUSTOM_HTTPS_PORT=${cfg.httpsPort}`,
      "CHROME_CLI=--remote-debugging-port=9222",
      // The image restarts the app when it exits; without this, closing the
      // window leaves a healthy container with no browser in it.
      "RESTART_APP=true",
    ],
    HostConfig: {
      NetworkMode: "host",
      SecurityOpt: ["seccomp=unconfined"],
      ShmSize: 1024 * 1024 * 1024,
      RestartPolicy: { Name: "unless-stopped" },
      Binds: [`${VOLUME}:/config`],
    },
  };
}

export async function install(): Promise<void> {
  if (process.env.BROWSER_EXTERNAL === 'true') throw new Error('This browser is managed outside the portal');
  // Nothing to install without Docker: the local runner uses a browser that is
  // already there, so installing is just starting it.
  if (!dockerAvailable()) return local.start();

  const cfg = config();
  if (!cfg.password) {
    // Refused rather than defaulted: an unauthenticated browser holding live
    // logins is the one outcome worth failing over.
    throw new Error("Set a password before installing — it guards a browser holding live logins");
  }

  if (!(await imagePresent(IMAGE))) {
    pulling = { active: true, line: "starting" };
    try {
      await pullImage(IMAGE, (line) => (pulling = { active: true, line }));
      pulling = { active: false, line: "done" };
    } catch (e) {
      pulling = { active: false, line: "", error: (e as Error).message };
      throw e;
    }
  }

  await request("POST", `/volumes/create`, { Name: VOLUME });

  const existing = await containerState(CONTAINER);
  if (existing.exists) await remove();

  const created = await request<{ Id?: string; message?: string }>(
    "POST",
    `/containers/create?name=${CONTAINER}`,
    spec(cfg)
  );
  if (created.status >= 400) throw new Error(created.body?.message || `Create failed (${created.status})`);
  await start();
}

export async function start(): Promise<void> {
  if (process.env.BROWSER_EXTERNAL === 'true') throw new Error('This browser is managed outside the portal');
  if (!dockerAvailable()) return local.start();
  const res = await request<{ message?: string }>("POST", `/containers/${CONTAINER}/start`);
  // 304 is "already running", which is the state being asked for.
  if (res.status >= 400 && res.status !== 304) {
    throw new Error(res.body?.message || `Start failed (${res.status})`);
  }
}

export async function stop(): Promise<void> {
  if (process.env.BROWSER_EXTERNAL === 'true') throw new Error('This browser is managed outside the portal');
  if (!dockerAvailable()) return local.stop();
  const res = await request<{ message?: string }>("POST", `/containers/${CONTAINER}/stop?t=10`);
  if (res.status >= 400 && res.status !== 304) {
    throw new Error(res.body?.message || `Stop failed (${res.status})`);
  }
}

/** Removes the container. The profile volume is left alone — that is the logins. */
export async function remove(): Promise<void> {
  if (process.env.BROWSER_EXTERNAL === 'true') throw new Error('This browser is managed outside the portal');
  if (!dockerAvailable()) return local.stop();
  await request("POST", `/containers/${CONTAINER}/stop?t=10`).catch(() => {});
  const res = await request<{ message?: string }>("DELETE", `/containers/${CONTAINER}?force=true`);
  if (res.status >= 400 && res.status !== 404) {
    throw new Error(res.body?.message || `Remove failed (${res.status})`);
  }
}

/** Forgets the logins as well. Separate on purpose, and not undoable. */
export async function forgetProfile(): Promise<void> {
  if (process.env.BROWSER_EXTERNAL === 'true') throw new Error('This browser is managed outside the portal');
  await remove();
  const res = await request<{ message?: string }>("DELETE", `/volumes/${VOLUME}`);
  if (res.status >= 400 && res.status !== 404) {
    throw new Error(res.body?.message || `Could not remove the profile (${res.status})`);
  }
}

export const suggestPassword = () => randomBytes(12).toString("hex");
