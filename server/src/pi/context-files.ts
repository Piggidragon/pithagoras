/**
 * The agent's own files, and who is allowed to see them.
 *
 * SOUL.md is who the agent is and travels everywhere. PrimaryUser.md and
 * MEMORY.md are one person's notes about themselves and their work, so a
 * conversation with anyone else must not load them — otherwise a teammate
 * messaging the bot gets an agent carrying your private context.
 *
 * TEAM.md is the shared half: what everyone may be told.
 *
 * In a module of its own because two places have to agree on it: what is loaded
 * into a conversation (sdk-client) and what a tool of that conversation may
 * read (the guard).
 */
export const CONTEXT_FILES = ["SOUL.md", "PrimaryUser.md", "MEMORY.md"];
export const SHARED_FILES = ["SOUL.md", "TEAM.md"];
/** The ones only the primary user's conversations may see. */
export const PRIVATE_FILES = CONTEXT_FILES.filter((name) => !SHARED_FILES.includes(name));
