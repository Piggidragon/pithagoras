/**
 * Which tools a conversation may use, given a default and its own exceptions.
 *
 * Kept apart from the database and from pi so the rule can be read in one
 * place and tested without either: a default that applies everywhere, and a
 * conversation that may disagree about any tool in either direction.
 */

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
