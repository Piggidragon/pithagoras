import { mkdirSync } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { createSession, findChannelSession, type SessionRow } from "./db.js";

/**
 * The agent's fixed working directory, separate from the per-task workspaces.
 *
 * Kept out of the workspace root deliberately: it is not a project you would
 * start a session against, and listing it as one would be misleading.
 */
export function agentHome(): string {
  const dir = path.resolve(process.env.AGENT_HOME || "/data/agent-home");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Keys come from outside, so they are bounded before touching the database. */
const MAX_KEY = 200;

/**
 * The key a package supplies is namespaced by its channel's slug.
 *
 * The slug and not the channel's id: ids are regenerated when a channel is
 * deleted and recreated, which silently orphaned every conversation it had —
 * same bot, same chat, same token, and an agent with amnesia. A slug is stable
 * and yours to choose, so re-adding under the same one picks the conversations
 * back up, and picking a different one is a deliberate fresh start.
 *
 * It also reads: `my-bot:chat:999` rather than `jAUF15d6Gg:chat:999`.
 */
export const scopeKey = (channelSlug: string, key: string) => `${channelSlug}:${key}`;

/** The channel's own key, with the prefix taken back off. */
export const unscopeKey = (channelSlug: string, stored: string) =>
  stored.startsWith(`${channelSlug}:`) ? stored.slice(channelSlug.length + 1) : stored;

/**
 * Find or create the session for one conversation on one channel.
 *
 * The channel package decides what counts as a conversation — a Telegram chat
 * id, a Slack channel, a Discord channel — and the portal turns that key into
 * an isolated session. A group chat and a DM produce different keys, so they
 * get different sessions and never share a memory.
 *
 * The key is prefixed with the channel's slug, so two channels using the same
 * obvious key ("general") stay separate without either knowing.
 */
export function resolveChannelSession(opts: {
  /** The channel's stable slug, not its primary key. */
  channelSlug: string;
  key: string;
  /** Human label for the first time this conversation is seen. */
  title?: string;
  executor: string;
}): { session: SessionRow; created: boolean } {
  const key = String(opts.key ?? "").trim().slice(0, MAX_KEY);
  if (!key) throw new Error("A channel must supply a session key for each conversation");

  const scoped = scopeKey(opts.channelSlug, key);

  const existing = findChannelSession(scoped);
  if (existing) return { session: existing, created: false };

  const id = nanoid(12);
  createSession({
    id,
    title: (opts.title ?? "").trim().slice(0, 120) || key,
    workspace: agentHome(),
    executor: opts.executor,
    kind: "agent",
    channel_slug: opts.channelSlug,
    channel_key: scoped,
  });

  // Re-read rather than construct: the row carries defaults this does not set.
  const session = findChannelSession(scoped);
  if (!session) throw new Error("Failed to create the session for this conversation");
  return { session, created: true };
}
