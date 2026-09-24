import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { piAgentDir } from "./pi-settings.js";

/**
 * Where models come from, as the Settings → Models page offers them.
 *
 * pi keeps this in two files of its own: `models.json` for servers it reaches
 * by URL (llama.cpp, llama-swap, Ollama, anything OpenAI-compatible), and
 * `auth.json` for the keys of services whose catalogue it already ships
 * (OpenRouter, Anthropic, OpenAI …). The portal writes both the way pi reads
 * them, so what is set up here also works for pi on the command line, and a
 * file edited by hand keeps whatever the forms know nothing about.
 */
export const modelsJsonPath = () => path.join(piAgentDir(), "models.json");
export const authJsonPath = () => path.join(piAgentDir(), "auth.json");

/** What a provider is, as the page offers them — not a field pi knows about. */
export type ProviderKind = "llama-cpp" | "llama-swap" | "ollama" | "openrouter" | "hosted" | "custom";

export interface Preset {
  kind: ProviderKind;
  label: string;
  description: string;
  /** The name it is filed under, unless the person picks another. */
  id: string;
  /** A server the portal reaches by URL and asks for its models. */
  endpoint: boolean;
  baseUrl?: string;
  /** Whether it takes a key: local servers mostly do not. */
  key: "none" | "optional" | "required";
  /** pi only lists a model whose provider has a key, so a keyless server is given this one. */
  placeholderKey?: string;
  compat?: Record<string, unknown>;
}

export const PRESETS: Preset[] = [
  {
    kind: "llama-cpp", label: "llama.cpp", id: "llama-server", endpoint: true, key: "optional", placeholderKey: "none",
    baseUrl: "http://127.0.0.1:8080/v1",
    description: "A llama-server on this machine or the network. Shows how far it is through a long prompt.",
  },
  {
    kind: "llama-swap", label: "llama-swap", id: "llama-swap", endpoint: true, key: "optional", placeholderKey: "none",
    baseUrl: "http://127.0.0.1:8080/v1",
    description: "A llama-swap gateway that starts the right llama-server for each model.",
  },
  {
    kind: "ollama", label: "Ollama", id: "ollama", endpoint: true, key: "none", placeholderKey: "ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    // Ollama's OpenAI endpoint knows neither the developer role nor reasoning_effort.
    compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
    description: "Models pulled with Ollama.",
  },
  {
    kind: "openrouter", label: "OpenRouter", id: "openrouter", endpoint: false, key: "required",
    description: "Hundreds of hosted models behind one key.",
  },
  {
    kind: "hosted", label: "Another hosted service", id: "", endpoint: false, key: "required",
    description: "Anthropic, OpenAI, Google, Mistral, Groq and the other services pi knows — by API key.",
  },
  {
    kind: "custom", label: "Custom endpoint", id: "", endpoint: true, key: "optional", placeholderKey: "none",
    description: "Any server that speaks the OpenAI API — vLLM, LM Studio, a proxy, a gateway.",
  },
];

/** The APIs pi can speak to a server it reaches by URL. */
export const APIS = ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"] as const;

export interface ModelEntry {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  input?: string[];
  reasoning?: boolean;
  [key: string]: unknown;
}

/** How a key is shown: never itself, only enough to tell one from another. */
export interface KeyInfo {
  set: boolean;
  /** "sk-o…3f9a", an environment variable's name, or a command — what it is, not what it holds. */
  hint?: string;
  /** Where pi finds it, when not in the portal's files. */
  source?: string;
}

export interface ProviderInfo {
  id: string;
  kind: ProviderKind;
  label: string;
  baseUrl?: string;
  api?: string;
  key: KeyInfo;
  models: ModelEntry[];
  /** Kept in models.json — a server reached by URL. */
  endpoint: boolean;
}

// --- files ---

type Json = Record<string, any>;

function readJson(file: string): Json {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Through a temp file and a rename, so pi never reads half a file; readable by its owner only, as pi makes them. */
function writeJson(file: string, data: Json) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(data, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  renameSync(temp, file);
}

let chain: Promise<unknown> = Promise.resolve();
/** One change at a time, so two saves cannot each drop the other's. */
function serial<T>(fn: () => T): Promise<T> {
  const next = chain.then(fn);
  chain = next.catch(() => {});
  return next;
}

export const readModelsJson = () => readJson(modelsJsonPath());
export const readAuthJson = () => readJson(authJsonPath());

/** When either file last changed, for whoever keeps something built from them. */
export function configStamp(): string {
  return [modelsJsonPath(), authJsonPath()]
    .map((f) => { try { return String(statSync(f).mtimeMs); } catch { return "-"; } })
    .join("|");
}

// --- reading ---

/** What kind of server a models.json entry is, from its name and address. */
export function inferKind(id: string, baseUrl?: string): ProviderKind {
  if (id === "llama.cpp" || id.startsWith("llama-server") || id.startsWith("llama-cpp")) return "llama-cpp";
  if (id.startsWith("llama-swap")) return "llama-swap";
  if (id.startsWith("ollama") || /:11434(\/|$)/.test(baseUrl ?? "")) return "ollama";
  if (id === "openrouter") return "openrouter";
  return "custom";
}

export function keyHint(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  if (value.startsWith("!")) return "from a command";
  if (/^\$\{?[A-Z_][A-Z0-9_]*\}?$/i.test(value)) return value.replace(/[${}]/g, "");
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

/** A key that only exists because pi wants one, not because the server does. */
const isPlaceholder = (key: unknown) => typeof key === "string" && ["none", "ollama", "local", "sk-no-key-required"].includes(key);

const presetFor = (kind: ProviderKind) => PRESETS.find((p) => p.kind === kind)!;

/**
 * Everything set up: servers from models.json, and keys from auth.json.
 * `names` gives each hosted service the name pi gives it; `envKeyed` lists the
 * ones pi finds a key for elsewhere — the environment — which are shown too,
 * as set up, since they are.
 */
export function listProviders(names: Record<string, string> = {}, envKeyed: Record<string, string> = {}): ProviderInfo[] {
  const models = readModelsJson().providers ?? {};
  const auth = readAuthJson();
  const out: ProviderInfo[] = [];
  for (const [id, raw] of Object.entries<Json>(models)) {
    if (!raw || typeof raw !== "object") continue;
    // Without a list of models it is an override of a built-in service — its
    // address, or a model's details — not a server of its own.
    if (!Array.isArray(raw.models)) continue;
    const kind = inferKind(id, raw.baseUrl);
    const stored = auth[id]?.type === "api_key" ? auth[id].key : undefined;
    const key = stored ?? raw.apiKey;
    out.push({
      // Its own name: the one it is filed and chosen under.
      id, kind, label: id,
      baseUrl: typeof raw.baseUrl === "string" ? raw.baseUrl : undefined,
      api: typeof raw.api === "string" ? raw.api : undefined,
      key: isPlaceholder(key) || !key ? { set: false } : { set: true, hint: keyHint(key) },
      models: Array.isArray(raw.models) ? raw.models.filter((m: Json) => m && typeof m.id === "string") : [],
      endpoint: true,
    });
  }
  const listed = new Set(out.map((p) => p.id));
  for (const [id, cred] of Object.entries<Json>(auth)) {
    if (listed.has(id) || !cred || typeof cred !== "object") continue;
    listed.add(id);
    out.push({
      id, kind: id === "openrouter" ? "openrouter" : "hosted", label: names[id] ?? id, models: [], endpoint: false,
      key: cred.type === "oauth" ? { set: true, hint: "signed in", source: "account" } : { set: true, hint: keyHint(cred.key) },
    });
  }
  for (const [id, source] of Object.entries(envKeyed)) {
    if (listed.has(id)) continue;
    out.push({ id, kind: id === "openrouter" ? "openrouter" : "hosted", label: names[id] ?? id, models: [], endpoint: false, key: { set: true, source } });
  }
  return out;
}

// --- finding a server's models ---

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined);

/**
 * The models a server lists at /models, with whatever it says about them.
 *
 * The OpenAI shape is `{ data: [{ id }] }`; the rest is each server's own:
 * OpenRouter's `context_length` and modalities, llama.cpp's `meta`, vLLM's
 * `max_model_len`. What none of them says is left for pi's defaults.
 */
export function parseModels(json: unknown): ModelEntry[] {
  const body = json as Json;
  const list: unknown[] = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : Array.isArray(body) ? body : [];
  const seen = new Set<string>();
  const out: ModelEntry[] = [];
  for (const item of list as Json[]) {
    const id = typeof item === "string" ? item : item?.id ?? item?.model ?? item?.name;
    if (typeof id !== "string" || !id || seen.has(id)) continue;
    seen.add(id);
    const entry: ModelEntry = { id };
    if (typeof item === "object") {
      if (typeof item.name === "string" && item.name !== id) entry.name = item.name;
      const ctx = num(item.context_length) ?? num(item.max_model_len) ?? num(item.context_window) ?? num(item.meta?.n_ctx) ?? num(item.meta?.n_ctx_train);
      if (ctx) entry.contextWindow = ctx;
      const modalities = item.architecture?.input_modalities;
      if (Array.isArray(modalities) && modalities.includes("image")) entry.input = ["text", "image"];
      if (Array.isArray(item.supported_parameters) && item.supported_parameters.includes("reasoning")) entry.reasoning = true;
    }
    out.push(entry);
  }
  return out;
}

/** An address as typed — "localhost:8080", a trailing slash — made into the base pi wants. */
export function normalizeBaseUrl(raw: string, kind: ProviderKind): string {
  let url = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  const parsed = new URL(url);
  // The local servers all serve the OpenAI API under /v1; an address without a path means that.
  if ((kind === "llama-cpp" || kind === "llama-swap" || kind === "ollama") && (parsed.pathname === "/" || parsed.pathname === "")) url += "/v1";
  return url.replace(/\/models$/, "");
}

/** A key as pi would read it: an environment variable is looked up, a command is not run here. */
function resolveKey(key: string | undefined): string | undefined {
  if (!key || isPlaceholder(key)) return undefined;
  const env = /^\$\{?([A-Z_][A-Z0-9_]*)\}?$/i.exec(key);
  if (env) return process.env[env[1]];
  return key.startsWith("!") ? undefined : key;
}

async function getJson(url: string, key: string | undefined, ms = 6000, init: RequestInit = {}): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { accept: "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}), ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(ms),
    });
  } catch (e) {
    const cause = (e as { cause?: { code?: string } }).cause?.code;
    if ((e as Error).name === "TimeoutError") throw new ProbeError(`No answer from ${new URL(url).host} within ${ms / 1000} seconds.`);
    throw new ProbeError(cause === "ENOTFOUND" ? `There is no ${new URL(url).hostname} to reach.` : `Nothing answered at ${new URL(url).host} — is the server running, and reachable from here?`);
  }
  if (res.status === 401 || res.status === 403) throw new ProbeError(key ? "The server turned the key down." : "The server wants an API key.");
  if (!res.ok) throw new ProbeError(`The server answered ${res.status} at ${new URL(url).pathname}.`);
  try {
    return await res.json();
  } catch {
    throw new ProbeError("The server answered, but not with a list of models. Is this the API address?");
  }
}

export class ProbeError extends Error {}

/**
 * What llama-server itself says about the one model it has loaded: the window
 * each chat really gets (`-c` over `--parallel`), and whether it sees images.
 * Not asked of llama-swap, which answers /props by loading a model.
 */
async function llamaProps(base: string, key?: string): Promise<Partial<ModelEntry>> {
  try {
    const props = (await getJson(base.replace(/\/v1$/, "") + "/props", key, 2500)) as Json;
    const out: Partial<ModelEntry> = {};
    const ctx = num(props?.default_generation_settings?.n_ctx);
    if (ctx) out.contextWindow = ctx;
    if (props?.modalities?.vision) out.input = ["text", "image"];
    return out;
  } catch {
    return {};
  }
}

/** What Ollama knows of a model: its window and whether it sees or thinks. */
async function ollamaShow(base: string, model: string): Promise<Partial<ModelEntry>> {
  try {
    const info = (await getJson(base.replace(/\/v1$/, "") + "/api/show", undefined, 2500, {
      method: "POST", body: JSON.stringify({ model }), headers: { "content-type": "application/json" },
    })) as Json;
    const out: Partial<ModelEntry> = {};
    const ctxKey = Object.keys(info?.model_info ?? {}).find((k) => k.endsWith(".context_length"));
    const ctx = ctxKey ? num(info.model_info[ctxKey]) : undefined;
    if (ctx) out.contextWindow = ctx;
    const caps: unknown = info?.capabilities;
    if (Array.isArray(caps) && caps.includes("vision")) out.input = ["text", "image"];
    if (Array.isArray(caps) && caps.includes("thinking")) out.reasoning = true;
    return out;
  } catch {
    return {};
  }
}

/**
 * Ask a server which models it has. `storedKey` is for a provider being
 * edited: the key never comes back to the page, so the page cannot send it.
 */
export async function probeModels(kind: ProviderKind, baseUrl: string, key?: string, storedKey?: string): Promise<{ baseUrl: string; models: ModelEntry[] }> {
  const base = normalizeBaseUrl(baseUrl, kind);
  const auth = resolveKey(key) ?? resolveKey(storedKey);
  let models: ModelEntry[];
  let at = base;
  try {
    models = parseModels(await getJson(`${base}/models`, auth));
  } catch (e) {
    // A custom address given without its /v1: try once with it before giving up.
    if (kind !== "custom" || /\/v\d+$/.test(base)) throw e;
    at = `${base}/v1`;
    const retried = await getJson(`${at}/models`, auth).then(parseModels, () => []);
    if (!retried.length) throw e;
    models = retried;
  }
  if (kind === "llama-cpp") {
    const props = await llamaProps(at, auth);
    // One model per server: what it says of itself belongs to that one.
    if (models.length === 1) models = [{ ...models[0], ...props }];
  }
  if (kind === "ollama") models = await Promise.all(models.slice(0, 40).map(async (m) => ({ ...m, ...(await ollamaShow(at, m.id)) })));
  return { baseUrl: at, models };
}

// --- whether a server answers now ---

export interface ProviderStatus {
  state: "up" | "down";
  /** How long it took to list its models. */
  ms?: number;
  message?: string;
  /** How many models it lists. */
  listed?: number;
  /** Chosen models it no longer lists: picking one would fail. */
  missing?: string[];
  /** What llama-swap has loaded now, when it says. */
  loaded?: string[];
}

/** Which models llama-swap has loaded: its own /running, beside the API. */
async function swapRunning(base: string, key?: string): Promise<string[] | undefined> {
  try {
    const r = (await getJson(base.replace(/\/v1$/, "") + "/running", key, 2000)) as Json;
    if (!Array.isArray(r?.running)) return undefined;
    return r.running
      .filter((x: Json) => x && typeof x.model === "string" && (!x.state || x.state === "ready"))
      .map((x: Json) => x.model as string);
  } catch {
    return undefined;
  }
}

async function checkOne(id: string, raw: Json): Promise<ProviderStatus> {
  const base = String(raw.baseUrl).replace(/\/+$/, "");
  const key = resolveKey(storedKey(id));
  const started = performance.now();
  try {
    const listed = parseModels(await getJson(`${base}/models`, key, 4000));
    const ms = Math.round(performance.now() - started);
    const ids = new Set(listed.map((m) => m.id));
    const chosen: string[] = raw.models.map((m: Json) => m?.id).filter((m: unknown): m is string => typeof m === "string");
    // A server that lists nothing is not saying the chosen ones are gone.
    const status: ProviderStatus = { state: "up", ms, listed: listed.length, missing: listed.length ? chosen.filter((m) => !ids.has(m)) : [] };
    if (inferKind(id, base) === "llama-swap") status.loaded = await swapRunning(base, key);
    return status;
  } catch (e) {
    return { state: "down", message: (e as Error).message };
  }
}

/**
 * Whether each server in models.json answers now. Only those with an
 * address: a hosted service is not asked, since asking costs a request on
 * someone's key.
 */
export async function checkProviders(): Promise<Record<string, ProviderStatus>> {
  const providers = readModelsJson().providers ?? {};
  const out: Record<string, ProviderStatus> = {};
  await Promise.all(
    Object.entries<Json>(providers)
      .filter(([, raw]) => raw && Array.isArray(raw.models) && typeof raw.baseUrl === "string")
      .map(async ([id, raw]) => { out[id] = await checkOne(id, raw); }),
  );
  return out;
}

// --- writing ---

const ID_RE = /^[A-Za-z0-9][\w.:=-]{0,63}$/;

export interface SaveProvider {
  kind: ProviderKind;
  baseUrl?: string;
  api?: string;
  /** Undefined keeps the stored key, "" removes it. */
  apiKey?: string;
  models?: ModelEntry[];
}

/** Only what the form edits: anything else on a stored model — a thinking map written by hand — stays. */
const EDITABLE = ["name", "contextWindow", "maxTokens", "input", "reasoning"] as const;

export function mergeModels(existing: ModelEntry[], wanted: ModelEntry[]): ModelEntry[] {
  const before = new Map(existing.map((m) => [m.id, m]));
  return wanted.map((w) => {
    const next: ModelEntry = { ...(before.get(w.id) ?? {}), id: w.id };
    for (const field of EDITABLE) {
      const value = w[field];
      if (value === undefined || value === null || value === "" || value === false) delete next[field];
      else next[field] = value as never;
    }
    return next;
  });
}

export function saveProvider(id: string, body: SaveProvider): Promise<void> {
  if (!ID_RE.test(id)) return Promise.reject(new Error("A provider's name is letters, digits and - _ . : = — and starts with a letter or digit."));
  const preset = PRESETS.find((p) => p.kind === body.kind);
  if (!preset) return Promise.reject(new Error(`Unknown kind of provider: ${body.kind}`));
  return serial(() => {
    if (!preset.endpoint) {
      if (body.apiKey === undefined) return;
      const auth = readAuthJson();
      if (body.apiKey.trim()) auth[id] = { ...(auth[id]?.type === "api_key" ? auth[id] : {}), type: "api_key", key: body.apiKey.trim() };
      else delete auth[id];
      writeJson(authJsonPath(), auth);
      return;
    }
    if (!body.baseUrl?.trim()) throw new Error("An address is needed, such as http://127.0.0.1:8080/v1.");
    const file = readModelsJson();
    const providers: Json = file.providers && typeof file.providers === "object" ? file.providers : {};
    const current: Json = providers[id] ?? {};
    const next: Json = { ...current, baseUrl: normalizeBaseUrl(body.baseUrl, body.kind) };
    next.api = body.api && (APIS as readonly string[]).includes(body.api) ? body.api : current.api ?? "openai-completions";
    if (body.apiKey !== undefined) next.apiKey = body.apiKey.trim() || preset.placeholderKey || "none";
    else next.apiKey ??= preset.placeholderKey ?? "none";
    if (preset.compat && !current.compat) next.compat = preset.compat;
    next.models = mergeModels(Array.isArray(current.models) ? current.models : [], body.models ?? []);
    providers[id] = next;
    file.providers = providers;
    writeJson(modelsJsonPath(), file);
  });
}

export function removeProvider(id: string): Promise<boolean> {
  return serial(() => {
    let found = false;
    const file = readModelsJson();
    if (file.providers?.[id]) {
      delete file.providers[id];
      writeJson(modelsJsonPath(), file);
      found = true;
    }
    const auth = readAuthJson();
    if (auth[id]) {
      delete auth[id];
      writeJson(authJsonPath(), auth);
      found = true;
    }
    return found;
  });
}

/** The key stored for a provider, for asking its server again without sending it to the page and back. */
export function storedKey(id: string): string | undefined {
  const auth = readAuthJson()[id];
  if (auth?.type === "api_key" && typeof auth.key === "string") return auth.key;
  const key = readModelsJson().providers?.[id]?.apiKey;
  return typeof key === "string" ? key : undefined;
}
