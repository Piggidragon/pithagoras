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

/** Does this tool belong to the browser, and so to the grant rather than here? */
export function browserTool(name: string): boolean {
  return name.startsWith(`${BROWSER_MCP}_`);
}

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
 */
export function exceptionsFor(
  wantedOff: Iterable<string>,
  defaultsOff: string[],
  known: Iterable<string>
): ToolExceptions {
  const off = new Set(wantedOff);
  const defaults = new Set(defaultsOff);
  const exceptions: ToolExceptions = { off: [], on: [] };
  for (const name of new Set([...known, ...off, ...defaults])) {
    if (off.has(name) && !defaults.has(name)) exceptions.off.push(name);
    if (!off.has(name) && defaults.has(name)) exceptions.on.push(name);
  }
  exceptions.off.sort();
  exceptions.on.sort();
  return exceptions;
}
