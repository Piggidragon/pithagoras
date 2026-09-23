import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import express, { type Router } from "express";
import { piSettingsPath, updatePiSettings } from "../pi-settings.js";
import { extensionStash, setExtensionStash } from "../db.js";
import { isFiltered, isSwitchedOff, setPackageEnabled, sourceOf } from "../extension-switch.js";
import { sessions } from "../session-manager.js";

const run = promisify(execFile);

export interface DetectedSetting {
  key: string;
  value: unknown;
  configured: boolean;
}

export interface ExtensionInfo {
  spec: string;
  name: string;
  path?: string;
  scope?: string;
  description?: string;
  homepage?: string;
  version?: string;
  settings: DetectedSetting[];
  /**
   * Whether pi loads it. Absent where the portal cannot say, or cannot switch
   * it: a package the project brings is that project's to decide.
   */
  enabled?: boolean;
  /** Some of its files are off by hand; switching it off and on must not lose that. */
  filtered?: boolean;
}

const settingsFile = piSettingsPath;

function readSettings(): Record<string, unknown> {
  try {
    const raw = readFileSync(settingsFile(), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeSettings(next: Record<string, unknown>): void {
  mkdirSync(path.dirname(settingsFile()), { recursive: true });
  writeFileSync(settingsFile(), JSON.stringify(next, null, 2) + "\n", "utf8");
}

/**
 * `pi list` nests by indentation: a scope heading, each package spec, then the
 * directory it was installed into.
 */
function parseList(output: string): { spec: string; path?: string; scope?: string }[] {
  const out: { spec: string; path?: string; scope?: string }[] = [];
  let scope: string | undefined;
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    const text = line.trim();
    if (indent === 0) {
      scope = text.replace(/packages:?$/i, "").trim() || undefined;
    } else if (indent <= 2) {
      // `pi list` says so after the source when the entry is an object, and
      // that is not part of the name pi takes back in `remove`.
      out.push({ spec: text.replace(/\s+\(filtered\)$/, ""), scope });
    } else {
      const last = out[out.length - 1];
      if (last && !last.path) last.path = text;
    }
  }
  return out;
}

/**
 * Find the settings keys an extension reads.
 *
 * pi has no schema for extension configuration — extensions simply pull keys
 * off the settings object (`const { llamaServerUrl } = settings`). So the keys
 * are recovered from the source, which is a heuristic: it can miss a key built
 * dynamically, and the UI says so rather than implying this list is complete.
 */
function detectSettingKeys(pkgPath: string): string[] {
  const keys = new Set<string>();
  const SKIP = new Set(["length", "constructor", "default", "prototype"]);

  const scan = (dir: string, depth = 0) => {
    if (depth > 4) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(full, depth + 1);
        continue;
      }
      if (!/\.(ts|js|mjs|cjs)$/.test(entry.name)) continue;
      let src: string;
      try {
        if (statSync(full).size > 512 * 1024) continue;
        src = readFileSync(full, "utf8");
      } catch {
        continue;
      }
      // const { a, b = x } = settings
      for (const m of src.matchAll(/\{([^{}]{0,300}?)\}\s*=\s*(?:\w*[sS]ettings)\b/g)) {
        for (const part of m[1].split(",")) {
          const key = part.split(/[:=]/)[0].trim();
          if (/^[A-Za-z_$][\w$]*$/.test(key) && !SKIP.has(key)) keys.add(key);
        }
      }
      // settings.foo / settings["foo"]
      for (const m of src.matchAll(/\b\w*[sS]ettings(?:\.(\w+)|\[["'](\w+)["']\])/g)) {
        const key = m[1] || m[2];
        if (key && !SKIP.has(key) && !/^(get|set)[A-Z]/.test(key)) keys.add(key);
      }
    }
  };

  scan(pkgPath);
  return [...keys].sort();
}

export function extensionsRouter(): Router {
  const router = express.Router();

  router.get("/extensions", async (_req, res) => {
    try {
      const { stdout } = await run("pi", ["list"], { timeout: 60_000 });
      const settings = readSettings();
      const packages = parseList(stdout);
      const listed = Array.isArray(settings.packages) ? settings.packages : [];

      const infos: ExtensionInfo[] = packages.map((pkg) => {
        const info: ExtensionInfo = {
          spec: pkg.spec,
          name: pkg.spec.replace(/^(npm:|git:)/, ""),
          path: pkg.path,
          scope: pkg.scope,
          settings: [],
        };

        if (!pkg.scope || /^user/i.test(pkg.scope)) {
          const entry = listed.find((e) => sourceOf(e) === pkg.spec);
          if (entry !== undefined) {
            info.enabled = !isSwitchedOff(entry);
            if (isFiltered(entry)) info.filtered = true;
          }
        }

        if (pkg.path && existsSync(path.join(pkg.path, "package.json"))) {
          try {
            const meta = JSON.parse(readFileSync(path.join(pkg.path, "package.json"), "utf8"));
            info.name = meta.name ?? info.name;
            info.description = meta.description;
            info.homepage = meta.homepage;
            info.version = meta.version;
          } catch {
            // metadata is a nicety; keep going without it
          }
          // The MCP adapter keeps its settings in mcp.json, not pi's
          // settings.json. The key scanner finds them all the same, and a form
          // built from them would write keys the adapter never reads — so it
          // gets no config page here. Settings → MCP edits the real file.
          const keys = info.name === "pi-mcp-adapter" ? [] : detectSettingKeys(pkg.path);
          for (const key of keys) {
            info.settings.push({
              key,
              value: settings[key] ?? "",
              configured: Object.prototype.hasOwnProperty.call(settings, key),
            });
          }
        }
        return info;
      });

      res.json({ extensions: infos, settingsPath: settingsFile() });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  /**
   * Switch an installed package off, or on again, without uninstalling it — the
   * way `pi config` does, by emptying what it may load. Open conversations are
   * reloaded so the change is there without a restart.
   */
  router.put("/extensions/enabled", async (req, res) => {
    const { spec, enabled } = req.body ?? {};
    if (typeof spec !== "string" || !spec || typeof enabled !== "boolean") {
      return res.status(400).json({ error: "spec and enabled are required" });
    }
    try {
      let stashed: ReturnType<typeof extensionStash> | undefined;
      await updatePiSettings(
        (all) => {
          // The stash is read and written in turn with the settings file: two
          // switches at once would otherwise both start from the same stash,
          // and the later write would drop what the earlier one kept.
          const changed = setPackageEnabled(Array.isArray(all.packages) ? all.packages : [], spec, enabled, extensionStash());
          if (!changed) return;
          all.packages = changed.packages;
          stashed = changed.stash;
        },
        // Written only once the file is: a failed write leaves both as they were.
        () => stashed && setExtensionStash(stashed),
      );
      const found = stashed !== undefined;
      if (!found) return res.status(404).json({ error: "That package is not installed for this user" });
      const { reloaded, waiting } = await sessions.reloadIdle();
      res.json({ ok: true, enabled, reloaded, waiting });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  /** Write one settings key. Empty string removes it, so a field can be cleared. */
  router.put("/extensions/settings", (req, res) => {
    const { key, value } = req.body ?? {};
    if (typeof key !== "string" || !/^[A-Za-z_$][\w$]*$/.test(key)) {
      return res.status(400).json({ error: "Invalid settings key" });
    }
    try {
      const settings = readSettings();
      if (value === "" || value === null || value === undefined) delete settings[key];
      else settings[key] = value;
      writeSettings(settings);
      res.json({ ok: true, settings });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  return router;
}
