import { randomBytes } from "node:crypto";
import { getDb, getStoredSettings } from "../db.js";
import { readModelsJson, storedKey } from "../providers.js";
import { containerState, dockerAvailable, imagePresent, pullImage, request } from "./docker.js";

/**
 * Understory, run by the portal: installed from Settings → Add-ons → Memory
 * like the browser, so the model that keeps the memory and how often it tidies
 * up can be chosen there.
 *
 * Understory reads all of that from its environment, once, when it starts —
 * its own settings page only shows it. So a change is saved here and the
 * container made again with it; the memory is in a volume and stays.
 *
 * Host networking, as the browser has: a model server the portal reaches on
 * localhost is reached the same way from here. Understory listens on every
 * interface, so it gets a token of its own, which only the portal holds — the
 * agent's MCP entry and the Memory page are its only callers.
 */

export const IMAGE = "ghcr.io/thecodacus/understory:latest";
export const CONTAINER = "pithagoras-understory";
export const VOLUME = process.env.UNDERSTORY_VOLUME || "pithagoras_understory-memory";
export const port = (): number => Number(process.env.UNDERSTORY_PORT) || 3800;
export const managedUrl = (): string => `http://127.0.0.1:${port()}/mcp`;

export type LlmFormat = "openai" | "anthropic";

/** Where the model that keeps the memory comes from: a provider set up here, or an address of its own. */
export type LlmChoice =
  | { source: "provider"; provider: string; model: string }
  | { source: "custom"; baseUrl: string; model: string; format: LlmFormat; apiKey?: string };

export interface UnderstoryConfig {
  llm: LlmChoice | null;
  /** How often it tidies the memory up — Understory's "dreaming" — as it reads it: "6h", "1d". Empty for never. */
  dreamInterval: string;
}

const KEY = "understory_config";
const TOKEN = "understory_token";

/** Understory's own reading of an interval, and its floor: five minutes. */
export function intervalMs(raw: string): number | null {
  const m = raw.trim().match(/^(\d+(?:\.\d+)?)\s*(m|h|d)$/i);
  if (!m) return null;
  return Math.round(Number(m[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2].toLowerCase() as "m" | "h" | "d"]);
}

export function validInterval(raw: string): boolean {
  if (!raw) return true;
  const ms = intervalMs(raw);
  return ms !== null && ms >= 5 * 60_000;
}

export function config(): UnderstoryConfig {
  try {
    const raw = JSON.parse((getStoredSettings() as Record<string, string>)[KEY] || "{}");
    return {
      llm: raw.llm && typeof raw.llm === "object" ? (raw.llm as LlmChoice) : null,
      dreamInterval: typeof raw.dreamInterval === "string" && validInterval(raw.dreamInterval) ? raw.dreamInterval : "",
    };
  } catch {
    return { llm: null, dreamInterval: "" };
  }
}

function put(key: string, value: string) {
  getDb()
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}

/**
 * Saved as given, except that a custom address sent without a key keeps the
 * one it had: the page never holds it, so it cannot send it back.
 */
export function saveConfig(next: UnderstoryConfig): UnderstoryConfig {
  const had = config().llm;
  let llm = next.llm;
  if (llm?.source === "custom" && llm.apiKey === undefined && had?.source === "custom") llm = { ...llm, apiKey: had.apiKey };
  put(KEY, JSON.stringify({ llm, dreamInterval: next.dreamInterval }));
  return config();
}

/** The token the container is given and the portal calls it with; made once. */
export function token(): string {
  const had = (getStoredSettings() as Record<string, string>)[TOKEN];
  if (had) return had;
  const made = randomBytes(24).toString("hex");
  put(TOKEN, made);
  return made;
}

/**
 * A key as pi keeps it may be the key, or the name of the variable holding
 * it. A command (`!…`) is pi's to run, not ours to hand a container.
 */
function resolveKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  if (key.startsWith("!")) throw new Error("That provider's key is a command pi runs; give Understory an address and key of its own instead");
  if (/^[A-Z_][A-Z0-9_]*$/.test(key) && process.env[key]) return process.env[key];
  return key;
}

/** What Understory is told about its model: the provider's address and key, looked up when the container is made. */
export function llmEnv(llm: LlmChoice): { baseUrl: string; apiKey: string; model: string; format: LlmFormat } {
  if (llm.source === "custom") return { baseUrl: llm.baseUrl, apiKey: llm.apiKey || "none", model: llm.model, format: llm.format };
  const raw = readModelsJson().providers?.[llm.provider];
  if (!raw || typeof raw.baseUrl !== "string") throw new Error(`There is no provider "${llm.provider}" with an address any more`);
  return {
    baseUrl: raw.baseUrl,
    // A local server without one still needs something: Understory refuses to start with no key.
    apiKey: resolveKey(storedKey(llm.provider)) || "none",
    model: llm.model,
    format: raw.api === "anthropic-messages" ? "anthropic" : "openai",
  };
}

export function spec(cfg: UnderstoryConfig, auth: string) {
  if (!cfg.llm) throw new Error("Choose the model that keeps the memory first");
  const llm = llmEnv(cfg.llm);
  return {
    Image: IMAGE,
    Env: [
      "BUNDLE_ROOT=/bundle",
      `PORT=${port()}`,
      `AUTH_TOKEN=${auth}`,
      `LLM_API_BASE_URL=${llm.baseUrl}`,
      `LLM_API_KEY=${llm.apiKey}`,
      `LLM_API_FORMAT=${llm.format}`,
      `LLM_MODEL=${llm.model}`,
      ...(cfg.dreamInterval ? [`DREAM_INTERVAL=${cfg.dreamInterval}`] : []),
    ],
    Labels: { "pithagoras.managed": "true" },
    HostConfig: {
      NetworkMode: "host",
      RestartPolicy: { Name: "unless-stopped" },
      Binds: [`${VOLUME}:/bundle`],
    },
  };
}

let pulling: { active: boolean; line: string; error?: string } = { active: false, line: "" };

export async function status() {
  if (!dockerAvailable()) return { available: false, image: false, container: "absent" as const, pulling };
  const [image, state] = await Promise.all([imagePresent(IMAGE), containerState(CONTAINER)]);
  return {
    available: true,
    image,
    container: (!state.exists ? "absent" : state.running ? "running" : "stopped") as "absent" | "stopped" | "running",
    pulling,
  };
}

/** Whether the portal runs Understory: its container is there. */
export async function installed(): Promise<boolean> {
  return dockerAvailable() && (await containerState(CONTAINER)).exists;
}

/** Pulls the image if it is not there, and makes the container anew with what is saved. */
export async function install(): Promise<void> {
  if (!dockerAvailable()) throw new Error("The portal cannot reach Docker here, so it cannot run Understory");
  const cfg = config();
  const made = spec(cfg, token());
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
  await request("POST", "/volumes/create", { Name: VOLUME });
  if ((await containerState(CONTAINER)).exists) await remove();
  const created = await request<{ message?: string }>("POST", `/containers/create?name=${CONTAINER}`, made);
  if (created.status >= 400) throw new Error(created.body?.message || `Create failed (${created.status})`);
  await start();
}

export async function start(): Promise<void> {
  const res = await request<{ message?: string }>("POST", `/containers/${CONTAINER}/start`);
  if (res.status >= 400 && res.status !== 304) throw new Error(res.body?.message || `Start failed (${res.status})`);
}

export async function stop(): Promise<void> {
  const res = await request<{ message?: string }>("POST", `/containers/${CONTAINER}/stop?t=10`);
  if (res.status >= 400 && res.status !== 304) throw new Error(res.body?.message || `Stop failed (${res.status})`);
}

/** Removes the container. The memory is in its volume, and stays. */
export async function remove(): Promise<void> {
  await request("POST", `/containers/${CONTAINER}/stop?t=10`).catch(() => {});
  const res = await request<{ message?: string }>("DELETE", `/containers/${CONTAINER}?force=true`);
  if (res.status >= 400 && res.status !== 404) throw new Error(res.body?.message || `Remove failed (${res.status})`);
}

/** Forgets the memory as well. Separate on purpose, and not undoable. */
export async function forgetMemory(): Promise<void> {
  await remove();
  const res = await request<{ message?: string }>("DELETE", `/volumes/${VOLUME}`);
  if (res.status >= 400 && res.status !== 404) throw new Error(res.body?.message || `Could not remove the memory (${res.status})`);
}
