/**
 * Switching an installed package off without uninstalling it.
 *
 * pi does this itself: a package in settings.json may be written as an object,
 * and an empty list for a kind of resource loads none of that kind. `pi config`
 * is the same thing done from a menu. The package stays installed, its files
 * stay where they are, and turning it back on is writing the entry as it was.
 *
 * Pure, over the `packages` array, so the rules can be tested without a
 * settings file and without pi.
 */

/** What a package can bring; an empty list for each is a package that brings nothing. */
const KINDS = ["extensions", "skills", "prompts", "themes"] as const;

type Entry = string | Record<string, unknown>;

/** What was there before a package was switched off, by the source it was installed as. */
export type Stash = Record<string, unknown>;

export function sourceOf(entry: unknown): string | undefined {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object") {
    const source = (entry as Record<string, unknown>).source;
    if (typeof source === "string") return source;
  }
  return undefined;
}

/** Every kind of resource emptied — which is what `pi config` writes for a package turned off. */
export function isSwitchedOff(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return false;
  const o = entry as Record<string, unknown>;
  return o.autoload !== false && KINDS.every((k) => Array.isArray(o[k]) && (o[k] as unknown[]).length === 0);
}

/**
 * Narrowed by hand — some of its files off, some on. Still on, and worth
 * saying, since turning it off and on again must give that back.
 */
export function isFiltered(entry: unknown): boolean {
  return !!entry && typeof entry === "object" && !isSwitchedOff(entry);
}

const off = (source: string): Entry => ({
  source,
  extensions: [],
  skills: [],
  prompts: [],
  themes: [],
});

/**
 * The packages with one switched on or off.
 *
 * Off keeps a hand-written filter aside instead of overwriting it, and on puts
 * it back: somebody who narrowed a package to two of its extensions did not ask
 * to lose that by trying the switch. `null` where the package is not listed.
 */
export function setPackageEnabled(
  packages: unknown[],
  source: string,
  enabled: boolean,
  stash: Stash,
): { packages: unknown[]; stash: Stash } | null {
  const at = packages.findIndex((entry) => sourceOf(entry) === source);
  if (at === -1) return null;

  const entry = packages[at];
  const next = { ...stash };
  const now = !isSwitchedOff(entry);
  if (now === enabled) return { packages, stash };

  const written: Entry = enabled ? ((next[source] as Entry | undefined) ?? source) : off(source);
  // Off keeps what is there now, and a plain entry is kept as nothing: a filter
  // put aside some earlier time, since written over by hand, is not brought back.
  if (enabled || !(entry && typeof entry === "object")) delete next[source];
  else next[source] = entry;

  return { packages: packages.map((e, i) => (i === at ? written : e)), stash: next };
}
