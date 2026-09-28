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
} from "../features.js";
import { readPiSettings, updatePiSettings } from "../pi-settings.js";
import { sessions } from "../session-manager.js";
import { switchPackage } from "./extensions.js";
import { readMcpFile, writeMcpFile } from "./mcp.js";
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

async function understoryState() {
  const { config, error } = readMcpFile();
  const entry = config.mcpServers?.[UNDERSTORY] as Record<string, unknown> | undefined;
  const url = typeof entry?.url === "string" && entry.url ? entry.url : understoryDefaultUrl();
  const adapter = adapterEntry();
  return {
    enabled: !error && understoryIn(config),
    url,
    tokenSet: Boolean(process.env[UNDERSTORY_TOKEN_ENV]),
    adapterInstalled: adapter?.enabled === true,
    reachable: await reachable(url),
    ...(error ? { configError: error } : {}),
  };
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
    const { config, error } = readMcpFile();
    if (error) return res.status(409).json({ error: `Fix mcp.json first: ${error}` });
    try {
      if (enabled) {
        // The adapter is what makes an MCP server into tools; without it the entry does nothing.
        const adapter = adapterEntry();
        if (!adapter) await pi(["install", `npm:${ADAPTER}`]);
        else if (!adapter.enabled) await switchPackage(adapter.source, true);
        // Kept: whatever else somebody put in the entry by hand.
        const { disabled: _off, ...had } = (config.mcpServers[UNDERSTORY] ?? {}) as Record<string, unknown>;
        const at = url ?? (typeof had.url === "string" && had.url ? had.url : understoryDefaultUrl());
        config.mcpServers[UNDERSTORY] = { ...had, ...understoryEntry(at, Boolean(process.env[UNDERSTORY_TOKEN_ENV])) };
      } else {
        delete config.mcpServers[UNDERSTORY];
      }
      writeMcpFile(config);
      // Which memory a chat reads is settled when it starts.
      const { reloaded, waiting } = await sessions.reloadIdle();
      res.json({ understory: await understoryState(), reloaded, waiting });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  return router;
}
