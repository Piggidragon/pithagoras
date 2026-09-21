/**
 * Which tools a conversation may use, given a default and its own exceptions.
 *
 * Kept apart from the database and from pi so the rule can be read in one
 * place and tested without either: a default that applies everywhere, and a
 * conversation that may disagree about any tool in either direction.
 */

/**
 * The MCP the portal attaches the agent's browser as.
 *
 * Its tools arrive named `browser_<whatever>`, and they are the one group here
 * that already has a switch: the globe beside the composer, which grants the
 * session the browser itself. Two switches for one question is one too many,
 * and the weaker of them is this one — turning the tools off does not take the
 * browser away, it only stops offering it.
 */
export const BROWSER_MCP = "browser";

/**
 * Which MCP server a tool came through, if any.
 *
 * Everything behind the adapter registers itself as one package, so a machine
 * with three servers attached had one group of forty tools called
 * `pi-mcp-adapter`. Nobody thinks of them that way: they think "the browser
 * one", "the Jira one". The adapter names a tool `<server>_<tool>`, so the
 * server is recoverable from the name given the list of configured servers.
 *
 * The longest match wins, or a server called `browser` would claim the tools
 * of one called `browser_staging`.
 */
export function mcpServerOf(name: string, servers: Iterable<string>): string | undefined {
  let best: string | undefined;
  for (const server of servers) {
    if (!name.startsWith(`${server}_`)) continue;
    if (!best || server.length > best.length) best = server;
  }
  return best;
}

/**
 * Does this tool come from the agent's browser?
 *
 * Asked through mcpServerOf rather than by prefix, because the prefix is
 * ambiguous: a server called `browser_staging` names a tool
 * `browser_staging_click`, which starts with `browser_` and is not the
 * browser's. Whether a conversation may drive the signed-in Chromium hangs on
 * this answer, so it is the careful one.
 */
export function browserTool(name: string, servers: Iterable<string>): boolean {
  return mcpServerOf(name, servers) === BROWSER_MCP;
}


/** What to file a tool under: its MCP server where it has one, its package otherwise. */
export function toolSource(name: string, source: string, servers: Iterable<string>): string {
  return mcpServerOf(name, servers) ?? source;
}

export interface ToolExceptions {
  /** Off here, whatever the default says. */
  off: string[];
  /** On here, whatever the default says. */
  on: string[];
}

/** Is this tool on, for a conversation holding these exceptions? */
export function toolEnabled(
  name: string,
  defaultsOff: Iterable<string>,
  exceptions: ToolExceptions
): boolean {
  if (exceptions.off.includes(name)) return false;
  if (exceptions.on.includes(name)) return true;
  return ![...defaultsOff].includes(name);
}

/** Everything off for this conversation, which is what pi has to be told. */
export function effectiveOff(
  names: Iterable<string>,
  defaultsOff: string[],
  exceptions: ToolExceptions
): string[] {
  const seen = new Set([...names, ...defaultsOff, ...exceptions.off, ...exceptions.on]);
  return [...seen].filter((name) => !toolEnabled(name, defaultsOff, exceptions)).sort();
}

/**
 * The exceptions to store, given what somebody wants off in this conversation.
 *
 * The page says what it wants the result to be; this works out what has to be
 * written down to get there. Anything already true by default is not written
 * down at all, so a later change to the default still reaches this
 * conversation — which is the point of having one.
 *
 * What the conversation already holds is the exception to that. Something
 * somebody switched here on purpose is theirs, even where the default has since
 * come to agree with it: dropping it on the next unrelated flip would leave a
 * chat that follows whatever the default does next, when it was told not to.
 */
export function exceptionsFor(
  wantedOff: Iterable<string>,
  defaultsOff: string[],
  known: Iterable<string>,
  held: ToolExceptions = { off: [], on: [] }
): ToolExceptions {
  const off = new Set(wantedOff);
  const defaults = new Set(defaultsOff);
  const exceptions: ToolExceptions = { off: [], on: [] };
  // Only the tools the caller answered about. Walking the defaults as well
  // would write an "on" exception for every default-off tool the caller never
  // saw — an extension that failed to load, a server that is not attached —
  // and that exception outlives the default it was silently cancelling.
  for (const name of new Set([...known, ...off])) {
    if (off.has(name) && (!defaults.has(name) || held.off.includes(name))) exceptions.off.push(name);
    if (!off.has(name) && (defaults.has(name) || held.on.includes(name))) exceptions.on.push(name);
  }
  exceptions.off.sort();
  exceptions.on.sort();
  return exceptions;
}
