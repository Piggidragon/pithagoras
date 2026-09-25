import { mkdirSync } from "node:fs";
import path from "node:path";

/**
 * The agent's fixed working directory, separate from the per-task workspaces.
 *
 * Kept out of the workspace root deliberately: it is not a project you would
 * start a session against, and listing it as one would be misleading.
 *
 * A module of its own so that the database can use it without importing
 * agent.ts, which imports the database.
 */
export function agentHome(): string {
  const dir = path.resolve(process.env.AGENT_HOME || "/data/agent-home");
  mkdirSync(dir, { recursive: true });
  return dir;
}
