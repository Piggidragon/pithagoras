import express, { type Router } from "express";
import { extensionStash, setExtensionStash } from "../db.js";
import { isSwitchedOff, sourceOf } from "../extension-switch.js";
import {
  SUBAGENT_MAX_PARALLEL,
  UNDERSTORY,
  UNDERSTORY_TOKEN_ENV,
  bundledSubagentDir,
  subagentState,
  understoryDefaultUrl,
  understoryEntry,
  understoryIn,
  understoryTokenOf,
} from "../features.js";
import { readPiSettings, updatePiSettings } from "../pi-settings.js";
import { sessions } from "../session-manager.js";
import { switchPackage } from "./extensions.js";
import { readMcpFile, writeMcpFile } from "./mcp.js";
import * as service from "../extensions/understory-service.js";
import { readModelsJson } from "../providers.js";
import { pi } from "./packages.js";

const ADAPTER = "pi-mcp-adapter";

/** pi-mcp-adapter as pi's settings list it, if they do. */
function adapterEntry(): { source: string; enabled: boolean } | undefined {
  const packages = readPiSettings().packages;
  for (const entry of Array.isArray(packages) ? packages : []) {
    const source = sourceOf(entry);
    if (source && new RegExp(`(^|[:/])${ADAPTER}(@[^/]*)?$`).test(source)) return { source, enabled: !isSwitchedOff(entry) };
  }
  return undefined;
}

/** Whether anything answers at the server's address: its web UI lives at the root. */
async function reachable(url: string): Promise<boolean> {
  try {
    await fetch(new URL(url).origin, { signal: AbortSignal.timeout(2500) });
    return true;
  } catch {
    return false;
  }
}

/** What the page is told of the saved settings: never the key itself. */
function shownConfig() {
  const { llm, dreamInterval } = service.config();
  if (llm?.source !== "custom") return { llm, dreamInterval };
  const { apiKey, ...rest } = llm;
  return { llm: { ...rest, hasKey: Boolean(apiKey) }, dreamInterval };
}

/** Providers set up here that have an address Understory can be pointed at, with their models. */
function providersForUnderstory() {
  const providers = readModelsJson().providers ?? {};
  return Object.entries<Record<string, any>>(providers)
    .filter(([, p]) => p && typeof p.baseUrl === "string" && Array.isArray(p.models))
    .map(([id, p]) => ({ id, models: p.models.filter((m: any) => typeof m?.id === "string").map((m: any) => String(m.id)) }));
}

async function understoryState() {
  const { config, error } = readMcpFile();
  const entry = config.mcpServers?.[UNDERSTORY] as Record<string, unknown> | undefined;
  const url = typeof entry?.url === "string" && entry.url ? entry.url : understoryDefaultUrl();
  const adapter = adapterEntry();
  const [reached, runtime] = await Promise.all([reachable(url), service.status()]);
  return {
    enabled: !error && understoryIn(config),
    url,
    tokenSet: Boolean(understoryTokenOf(entry) ?? process.env[UNDERSTORY_TOKEN_ENV]),
    adapterInstalled: adapter?.enabled === true,
    reachable: reached,
    // The Understory the portal runs itself, if it does or can.
    managed: {
      ...runtime,
      url: service.managedUrl(),
      config: shownConfig(),
      providers: providersForUnderstory(),
    },
    ...(error ? { configError: error } : {}),
  };
}

/**
 * Understory in the agent's MCP servers, or out of them. The portal's own
 * Understory, where it runs one, is the one written, with its token;
 * otherwise the address given, or the one there before.
 */
async function switchUnderstory(enabled: boolean, url?: string): Promise<void> {
  const { config, error } = readMcpFile();
  if (error) throw Object.assign(new Error(`Fix mcp.json first: ${error}`), { status: 409 });
  if (enabled) {
    // The adapter is what makes an MCP server into tools; without it the entry does nothing.
    const adapter = adapterEntry();
    if (!adapter) await pi(["install", `npm:${ADAPTER}`]);
    else if (!adapter.enabled) await switchPackage(adapter.source, true);
    // Kept: whatever else somebody put in the entry by hand, except how it signs in, which is said anew.
    const { disabled: _off, auth: _a, bearerToken: _t, bearerTokenEnv: _e, ...had } = (config.mcpServers[UNDERSTORY] ?? {}) as Record<string, unknown>;
    config.mcpServers[UNDERSTORY] = (await service.installed())
      ? { ...had, ...understoryEntry(service.managedUrl(), { token: service.token() }) }
      : {
          ...had,
          ...understoryEntry(url ?? (typeof had.url === "string" && had.url ? had.url : understoryDefaultUrl()), {
            ...(process.env[UNDERSTORY_TOKEN_ENV] ? { tokenEnv: UNDERSTORY_TOKEN_ENV } : {}),
          }),
        };
  } else {
    delete config.mcpServers[UNDERSTORY];
  }
  writeMcpFile(config);
}

/** The model a request names, checked; undefined when it names none that can be used. */
function llmFrom(body: any): service.LlmChoice | null | undefined {
  if (body === null) return null;
  const model = typeof body?.model === "string" ? body.model.trim() : "";
  if (!model) return undefined;
  if (body.source === "provider") {
    const known = providersForUnderstory().some((p) => p.id === body.provider);
    return known ? { source: "provider", provider: body.provider, model } : undefined;
  }
  if (body.source === "custom") {
    const baseUrl = httpUrl(body.baseUrl);
    const format = body.format === "anthropic" ? "anthropic" : body.format === "openai" ? "openai" : undefined;
    if (!baseUrl || !format) return undefined;
    if (body.apiKey !== undefined && typeof body.apiKey !== "string") return undefined;
    return { source: "custom", baseUrl, model, format, ...(body.apiKey !== undefined ? { apiKey: body.apiKey.trim() } : {}) };
  }
  return undefined;
}

const httpUrl = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

/**
 * The opt-in features: what is on, and switching each. A switch reloads the
 * idle conversations, as switching a package does, so it is there without a
 * restart; a running one keeps what it had until it is reloaded.
 */
export function featuresRouter(): Router {
  const router = express.Router();

  router.get("/features", async (_req, res) => {
    try {
      res.json({ subagent: subagentState(), understory: await understoryState() });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.put("/features/subagent", async (req, res) => {
    const { enabled, mode, maxParallel } = req.body ?? {};
    if (enabled !== undefined && typeof enabled !== "boolean") return res.status(400).json({ error: "enabled must be true or false" });
    if (mode !== undefined && mode !== "interrupt" && mode !== "background") {
      return res.status(400).json({ error: "mode must be interrupt or background" });
    }
    if (maxParallel !== undefined && !(Number.isInteger(maxParallel) && maxParallel >= 1 && maxParallel <= SUBAGENT_MAX_PARALLEL)) {
      return res.status(400).json({ error: `maxParallel must be a whole number from 1 to ${SUBAGENT_MAX_PARALLEL}` });
    }
    try {
      if (mode || maxParallel !== undefined) {
        // What the tool does without being told is left unsaid: interrupt, one at a time.
        await updatePiSettings((all) => {
          if (mode === "background") all.subagentMode = "background";
          else if (mode) delete all.subagentMode;
          if (maxParallel === 1) delete all.subagentMaxParallel;
          else if (maxParallel !== undefined) all.subagentMaxParallel = maxParallel;
        });
      }
      const state = subagentState();
      if (enabled === true && !state.enabled) {
        if (state.source) await switchPackage(state.source, true);
        else {
          const bundled = bundledSubagentDir();
          if (!bundled) return res.status(409).json({ error: "The subagent tool is not part of this install" });
          await pi(["install", bundled]);
        }
      }
      if (enabled === false && state.source) {
        await pi(["remove", state.source]);
        // What was kept aside for switching it back on has nothing left to go to.
        const stash = extensionStash();
        if (state.source in stash) {
          delete stash[state.source];
          setExtensionStash(stash);
        }
      }
      // The mode changes what the tool tells the model, which it reads when it is loaded.
      const { reloaded, waiting } = await sessions.reloadIdle();
      res.json({ subagent: subagentState(), reloaded, waiting });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.put("/features/understory", async (req, res) => {
    const { enabled } = req.body ?? {};
    if (typeof enabled !== "boolean") return res.status(400).json({ error: "enabled must be true or false" });
    const url = req.body?.url === undefined ? undefined : httpUrl(req.body.url);
    if (req.body?.url !== undefined && !url) return res.status(400).json({ error: "The address must be an http or https URL" });
    try {
      await switchUnderstory(enabled, url);
      // Which memory a chat reads is settled when it starts.
      const { reloaded, waiting } = await sessions.reloadIdle();
      res.json({ understory: await understoryState(), reloaded, waiting });
    } catch (e) {
      res.status((e as { status?: number }).status ?? 500).json({ error: (e as Error).message });
    }
  });

  /**
   * The model that keeps the memory and how often it tidies up, for the
   * Understory the portal runs. Understory reads both only when it starts,
   * so a running one is made again with them; its memory stays.
   */
  router.put("/features/understory/config", async (req, res) => {
    const llm = llmFrom(req.body?.llm);
    if (llm === undefined) return res.status(400).json({ error: "Choose a provider and model, or an http(s) address, a model and a format" });
    const dreamInterval = typeof req.body?.dreamInterval === "string" ? req.body.dreamInterval.trim() : "";
    if (!service.validInterval(dreamInterval)) return res.status(400).json({ error: "Tidying up takes an interval like 30m, 6h or 1d, of at least 5 minutes" });
    try {
      service.saveConfig({ llm, dreamInterval });
      if (await service.installed()) await service.install();
      res.json({ understory: await understoryState() });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  /** Runs Understory here, and makes it the agent's memory. */
  router.post("/features/understory/install", async (_req, res) => {
    try {
      await service.install();
      await switchUnderstory(true);
      const { reloaded, waiting } = await sessions.reloadIdle();
      res.json({ understory: await understoryState(), reloaded, waiting });
    } catch (e) {
      res.status((e as { status?: number }).status ?? 500).json({ error: (e as Error).message });
    }
  });

  for (const action of ["start", "stop"] as const) {
    router.post(`/features/understory/${action}`, async (_req, res) => {
      try {
        await service[action]();
        res.json({ understory: await understoryState() });
      } catch (e) {
        res.status(500).json({ error: (e as Error).message });
      }
    });
  }

  /**
   * Stops running it here. The memory stays in its volume unless
   * `?memory=forget`. An agent pointed at it is pointed at nothing now, so
   * Understory is switched off as its memory, and MEMORY.md comes back.
   */
  router.delete("/features/understory/install", async (req, res) => {
    try {
      const { config } = readMcpFile();
      const entry = config.mcpServers?.[UNDERSTORY] as { url?: unknown } | undefined;
      if (entry?.url === service.managedUrl()) await switchUnderstory(false);
      await (req.query.memory === "forget" ? service.forgetMemory() : service.remove());
      const { reloaded, waiting } = await sessions.reloadIdle();
      res.json({ understory: await understoryState(), reloaded, waiting });
    } catch (e) {
      res.status((e as { status?: number }).status ?? 500).json({ error: (e as Error).message });
    }
  });

  return router;
}
