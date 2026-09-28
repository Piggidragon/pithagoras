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

/**
 * Where the model that keeps the memory comes from: the chat's (the one the
 * chat asking is on — see memory-llm.ts), a provider set up here, or an
 * address of its own.
 */
export type LlmChoice =
  | { source: "auto" }
  | { source: "provider"; provider: string; model: string }
  | { source: "custom"; baseUrl: string; model: string; format: LlmFormat; apiKey?: string };

export interface UnderstoryConfig {
  llm: LlmChoice;
  /** How often it tidies the memory up — Understory's "dreaming" — as it reads it: "6h", "1d". Empty for never. */
  dreamInterval: string;
  /**
   * Or once a day at this time, "03:00", in the portal's time zone: the
   * portal starts the pass itself, since Understory only counts from its own
   * start. Wins over the interval.
   */
  dreamAt: string;
}

const KEY = "understory_config";
const TOKEN = "understory_token";
const LLM_TOKEN = "understory_llm_token";
const LAST_DREAM = "understory_last_dream";

/** Understory's own reading of an interval, and its floor: five minutes. */
export function intervalMs(raw: string): number | null {
  const m = raw.trim().match(/^(\d+(?:\.\d+)?)\s*(m|h|d)$/i);
  if (!m) return null;
  return Math.round(Number(m[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2].toLowerCase() as "m" | "h" | "d"]);
}

/** A time of day, "HH:MM", or empty. */
export const validTime = (raw: string): boolean => !raw || /^([01]\d|2[0-3]):[0-5]\d$/.test(raw);

export function validInterval(raw: string): boolean {
  if (!raw) return true;
  const ms = intervalMs(raw);
  return ms !== null && ms >= 5 * 60_000;
}

export function config(): UnderstoryConfig {
  try {
    const raw = JSON.parse((getStoredSettings() as Record<string, string>)[KEY] || "{}");
    return {
      // Nothing chosen is the chat's: the model already loaded, which asks nothing of anyone.
      llm: raw.llm && typeof raw.llm === "object" ? (raw.llm as LlmChoice) : { source: "auto" },
      dreamInterval: typeof raw.dreamInterval === "string" && validInterval(raw.dreamInterval) ? raw.dreamInterval : "",
      dreamAt: typeof raw.dreamAt === "string" && validTime(raw.dreamAt) ? raw.dreamAt : "",
    };
  } catch {
    return { llm: { source: "auto" }, dreamInterval: "", dreamAt: "" };
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
  // A set time wins, and Understory's own timer is left off: two passes a day would be one too many.
  put(KEY, JSON.stringify({ llm, dreamInterval: next.dreamAt ? "" : next.dreamInterval, dreamAt: next.dreamAt }));
  scheduleDreams();
  return config();
}

function secret(key: string): string {
  const had = (getStoredSettings() as Record<string, string>)[key];
  if (had) return had;
  const made = randomBytes(24).toString("hex");
  put(key, made);
  return made;
}

/** The token the container is given and the portal calls it with; made once. */
export const token = (): string => secret(TOKEN);

/** The key Understory calls the portal's model server with, in "the chat's" mode; made once. */
export const llmToken = (): string => secret(LLM_TOKEN);

/**
 * Where Understory reaches the portal's model server: on the host network,
 * the portal's own port on loopback. Not over the portal's own TLS, whose
 * certificate Understory has no reason to trust — then there is no "the
 * chat's", and a model of its own is needed.
 */
export function portalLlmBase(): string | undefined {
  if (process.env.PORTAL_TLS_CERT && process.env.PORTAL_TLS_KEY) return undefined;
  return `http://127.0.0.1:${Number(process.env.PORT || 4100)}/understory-llm/v1`;
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
  if (llm.source === "auto") {
    const baseUrl = portalLlmBase();
    if (!baseUrl) throw new Error("The portal serves its own TLS, which Understory cannot reach it through; give Understory a model of its own");
    return { baseUrl, apiKey: llmToken(), model: "auto", format: "openai" };
  }
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
      // At a set time the portal starts the pass itself: Understory's timer stays off.
      ...(cfg.dreamInterval && !cfg.dreamAt ? [`DREAM_INTERVAL=${cfg.dreamInterval}`] : []),
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

// --- tidying up at a set time ---

/** What the last pass the portal started came to. */
export interface DreamRun {
  at: string;
  ok: boolean;
  /** It found something to do. */
  ran?: boolean;
  /** What it did, or why it did nothing, or what went wrong. */
  said: string;
}

export function lastDream(): DreamRun | null {
  try {
    const raw = (getStoredSettings() as Record<string, string>)[LAST_DREAM];
    return raw ? (JSON.parse(raw) as DreamRun) : null;
  } catch {
    return null;
  }
}

/**
 * Code run inside Understory's container, with its own library, settings and
 * bundle — Understory has no API that writes, and none that tidies up on
 * demand, but its library does both, keeping index.md and log.md right as it
 * goes. Its input is handed over base64'd in the environment; it prints what
 * it came to, as JSON, as its last line.
 */
function script(body: string): string {
  return `(async () => {
  const m = await import("@understory/core");
  const kb = new m.KnowledgeBase(process.env.BUNDLE_ROOT, { gitAutocommit: process.env.GIT_AUTOCOMMIT === "true" });
  const input = process.env.PORTAL_INPUT ? JSON.parse(Buffer.from(process.env.PORTAL_INPUT, "base64").toString("utf8")) : {};
  const health = async () => {
    const lint = await kb.lint();
    const valid = await kb.validate();
    return { healthy: lint.healthy && valid.conformant, orphans: lint.orphans, brokenLinks: lint.brokenLinks, issues: valid.issues };
  };
  ${body}
})().catch((e) => { console.log(JSON.stringify({ error: String(e?.message ?? e) })); process.exit(1); });`;
}

const SCRIPTS = {
  dream: script(`console.log(JSON.stringify(await m.runDream(kb)));`),
  health: script(`console.log(JSON.stringify({ health: await health() }));`),
  save: script(`const concept = await kb.writeConcept(input.path, input.frontmatter, input.body, input.summary);
  console.log(JSON.stringify({ concept, health: await health() }));`),
  delete: script(`await kb.deleteConcept(input.path, input.summary);
  console.log(JSON.stringify({ health: await health() }));`),
  // Every folder's index.md written anew, deepest first, after the empty ones
  // are gone: what Understory does for one folder after each change, for all.
  reindex: script(`const pruned = await m.pruneEmptyDirs(kb.bundle);
  const dirs = [];
  const walk = (n) => { if (n.kind === "directory") { dirs.push(n.path); (n.children ?? []).forEach(walk); } };
  walk(await kb.listTree());
  for (const dir of dirs.sort((a, b) => b.length - a.length)) await m.regenerateIndex(kb.bundle, dir === "/" ? undefined : dir);
  console.log(JSON.stringify({ pruned, reindexed: dirs.length, health: await health() }));`),
} as const;

/** The report a run printed last, from all it printed. */
export function readReport(output: string): Record<string, any> | null {
  const lines = output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].startsWith("{")) continue;
    try {
      return JSON.parse(lines[i]);
    } catch {
      // Not the report; look further up.
    }
  }
  return null;
}

// One at a time: two writers in the bundle at once would each rewrite the index the other just wrote.
let queue: Promise<unknown> = Promise.resolve();

/** Runs one of the scripts in the container, after whatever runs there now. */
function run(name: keyof typeof SCRIPTS, input?: unknown): Promise<Record<string, any>> {
  const next = queue.then(async () => {
    if (!(await containerState(CONTAINER)).running) throw new Error("Understory is not running");
    const exec = await request<{ Id?: string; message?: string }>("POST", `/containers/${CONTAINER}/exec`, {
      Cmd: ["node", "-e", SCRIPTS[name]],
      WorkingDir: "/app/server",
      Env: input === undefined ? [] : [`PORTAL_INPUT=${Buffer.from(JSON.stringify(input)).toString("base64")}`],
      AttachStdout: true,
      AttachStderr: true,
      // A terminal: its output comes back as it was printed, not in Docker's framed stream.
      Tty: true,
    });
    if (exec.status >= 400 || !exec.body?.Id) throw new Error(exec.body?.message || `Could not reach Understory (${exec.status})`);
    const out = await request<unknown>("POST", `/exec/${exec.body.Id}/start`, { Detach: false, Tty: true });
    const report = readReport(typeof out.body === "string" ? out.body : JSON.stringify(out.body ?? ""));
    if (!report) throw new Error("Understory ended without saying what it did");
    if (report.error) throw new Error(report.error);
    return report;
  });
  queue = next.catch(() => {});
  return next;
}

/** What `lint` and `validate` say about the bundle: what a change may have left behind. */
export interface Health {
  healthy: boolean;
  orphans: { path: string; title?: string }[];
  brokenLinks: { path: string; target: string }[];
  issues: { path: string; severity: string; message: string }[];
}

/** The largest note the portal will write: it travels in the environment. */
export const NOTE_MAX = 100_000;

export async function noteHealth(): Promise<Health> {
  return (await run("health")).health;
}

/** A note written by hand, through Understory's own write path: its index and log follow. */
export async function saveNote(path: string, frontmatter: Record<string, unknown>, body: string): Promise<{ concept: unknown; health: Health }> {
  const r = await run("save", { path, frontmatter, body, summary: `Edited [${frontmatter.title ?? path}](${path}) by hand in the portal.` });
  return { concept: r.concept, health: r.health };
}

export async function deleteNote(path: string): Promise<{ health: Health }> {
  const r = await run("delete", { path, summary: `Deleted ${path} by hand in the portal.` });
  return { health: r.health };
}

/** Every index.md written anew, and folders left empty removed. No model involved. */
export async function reindex(): Promise<{ pruned: string[]; reindexed: number; health: Health }> {
  const r = await run("reindex");
  return { pruned: r.pruned ?? [], reindexed: r.reindexed ?? 0, health: r.health };
}

let dreaming = false;
export const isDreaming = () => dreaming;

/** Tidies the memory up now, and keeps what came of it. */
export async function dreamNow(): Promise<DreamRun> {
  if (dreaming) throw new Error("It is tidying up already");
  if (!(await containerState(CONTAINER)).running) throw new Error("Understory is not running");
  dreaming = true;
  let result: DreamRun;
  try {
    const report = await run("dream");
    result = {
      at: new Date().toISOString(),
      ok: true,
      ran: report.ran === true,
      said: report.ran
        ? `${report.filesChanged?.length ?? 0} ${report.filesChanged?.length === 1 ? "file" : "files"} changed${report.summary ? ` — ${String(report.summary).slice(0, 300)}` : ""}`
        : report.reason || "Nothing to do",
    };
  } catch (e) {
    result = { at: new Date().toISOString(), ok: false, said: (e as Error).message };
  } finally {
    dreaming = false;
  }
  put(LAST_DREAM, JSON.stringify(result));
  return result;
}

/** The next time `at` ("HH:MM") comes round after `from`, in the portal's time zone. */
export function nextAt(at: string, from = new Date()): Date {
  const [h, m] = at.split(":").map(Number);
  const next = new Date(from);
  next.setHours(h, m, 0, 0);
  if (next <= from) next.setDate(next.getDate() + 1);
  return next;
}

let timer: NodeJS.Timeout | undefined;
let nextDream: Date | undefined;
export const nextDreamAt = () => nextDream;

/**
 * The pass at the set time, once a day, while the portal runs Understory.
 * Set anew whenever the settings are saved, and when the portal starts.
 */
export function scheduleDreams(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  nextDream = undefined;
  const { dreamAt } = config();
  if (!dreamAt) return;
  nextDream = nextAt(dreamAt);
  timer = setTimeout(async () => {
    try {
      if (dockerAvailable() && (await containerState(CONTAINER)).running) await dreamNow();
    } catch (e) {
      console.error(`[portal] tidying the memory up failed: ${(e as Error).message}`);
    }
    scheduleDreams();
  }, nextDream.getTime() - Date.now());
  // Never what keeps the portal running.
  timer.unref();
}
