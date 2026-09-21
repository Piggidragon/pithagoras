import type { PortalTool } from "./api";

/**
 * Tools as somebody thinks about them: by what they came from.
 *
 * pi has a flat registry, and a person does not — "turn off the web search
 * one" means four tools that arrived together. Grouping by source is what
 * makes a switch per extension possible without this knowing what any
 * extension is.
 */
export interface ToolGroup {
  source: string;
  tools: PortalTool[];
  /** Every tool in it is on. */
  allOn: boolean;
  /** None of them are. */
  allOff: boolean;
}

/** What the portal registers itself, which is not an extension anyone installed. */
const BUILT_IN = "built in";

export function groupTools(tools: PortalTool[]): ToolGroup[] {
  const groups = new Map<string, PortalTool[]>();
  for (const tool of tools) {
    const source = tool.source?.trim() || BUILT_IN;
    const list = groups.get(source);
    if (list) list.push(tool);
    else groups.set(source, [tool]);
  }
  return [...groups.entries()]
    .map(([source, list]) => ({
      source,
      tools: [...list].sort((a, b) => a.name.localeCompare(b.name)),
      allOn: list.every((t) => t.enabled),
      allOff: list.every((t) => !t.enabled),
    }))
    // What the portal ships is last: somebody opening this came for the thing
    // they installed, not for the tools that were always there.
    .sort((a, b) =>
      a.source === BUILT_IN
        ? 1
        : b.source === BUILT_IN
          ? -1
          : a.source.localeCompare(b.source)
    );
}

/**
 * The list of names to store after a switch is flipped.
 *
 * Off is what gets written down, so this returns the exceptions: everything
 * currently off, with `names` added or removed. A tool the session has never
 * heard of stays in the list — it may belong to an extension that is merely
 * not loaded right now, and dropping it would silently turn it back on.
 */
export function nextOff(off: string[], names: string[], enabled: boolean): string[] {
  const next = new Set(off);
  for (const name of names) {
    if (enabled) next.delete(name);
    else next.add(name);
  }
  return [...next].sort();
}

/**
 * What a group says about itself while it is shut.
 *
 * A closed group has to answer the only question worth asking from the
 * outside — is anything in here switched off — or closing them would hide the
 * thing the list exists to show.
 */
export function groupSummary(group: ToolGroup): string {
  const total = group.tools.length;
  if (group.allOff) return `${total} off`;
  const off = group.tools.filter((t) => !t.enabled).length;
  return off ? `${off} of ${total} off` : `${total} on`;
}

/** Opening one group, or shutting it. */
export function toggleOpen(open: string[], source: string): string[] {
  return open.includes(source) ? open.filter((s) => s !== source) : [...open, source];
}

/**
 * What a group is called on the page.
 *
 * A given name wins. Failing that the npm scope is dropped, because
 * `@juicesharp/rpiv-ask-user-question` is an address and a heading has to fit
 * in a column: the part after the slash is the part anybody says out loud. The
 * address is still there, under the package in the extensions list and in the
 * heading's tooltip.
 */
export function displayName(source: string, names: Record<string, string> = {}): string {
  const given = names[source]?.trim();
  if (given) return given;
  return source.replace(/^@[^/]+\//, "") || source;
}
