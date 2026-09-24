import { existsSync, realpathSync } from "node:fs";
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
  return { path: resolved };
}
