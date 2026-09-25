import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { agentHome } from "./agent.js";

/** Where projects live. WORKSPACE_ROOT is the new name; WORKSPACES_DIR still works for existing deploys. */
export function workspaceRoot(): string {
  return path.resolve(process.env.WORKSPACE_ROOT || process.env.WORKSPACES_DIR || "/workspaces");
}

/**
 * Where a chat or a routine may run: Home — the agent's own directory — or
 * somewhere inside the workspace root, judged by where the path really leads.
 * A bare name is a project under the root.
 */
export function checkWorkspace(raw: string): { path: string } | { error: string } {
  const home = agentHome();
  const root = workspaceRoot();
  const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.join(root, raw);
  if (resolved === home) return { path: home };
  // Keep pi inside the mounted workspace area — no escaping to the rest of the FS.
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return { error: "workspace must be inside the workspace root" };
  }
  if (!existsSync(resolved)) return { error: "workspace does not exist" };
  // The check above is on the text of the path, and a link inside the root
  // passes it while leading anywhere. Where it really points must be inside too.
  const real = realpathSync(resolved);
  const realRoot = realpathSync(root);
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
    return { error: "workspace must be inside the workspace root" };
  }
  // A file would be taken as far as the launch, and every run would fail there.
  if (!statSync(real).isDirectory()) return { error: "workspace is not a directory" };
  return { path: resolved };
}

/**
 * Where a routine runs, as the page or the agent asked for it. Nothing, "" or
 * "home" is Home (a project called "home" is still reached by its path).
 * Anything else must be a place a chat could run. Home is kept as null, so
 * that a routine follows it if AGENT_HOME moves.
 */
export function routinePlace(raw: unknown): { workspace: string | null } | { error: string } {
  if (raw === undefined || raw === null) return { workspace: null };
  if (typeof raw !== "string") return { error: "workspace must be a project's name or path, or null for Home" };
  const text = raw.trim();
  if (!text || /^home$/i.test(text)) return { workspace: null };
  const where = checkWorkspace(text);
  if ("error" in where) return where;
  return { workspace: where.path === agentHome() ? null : where.path };
}
