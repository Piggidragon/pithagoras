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

/**
 * The name an npm package goes by, from the source it is listed as:
 * `npm:@scope/name@1.2.0` is `@scope/name`. Undefined for a git URL or a folder.
 */
export function npmName(source: string): string | undefined {
  const m = /^npm:(@[^/@]+\/[^/@]+|[^/@]+)(?:@.*)?$/.exec(source.trim());
  return m?.[1];
}

/**
 * Which package a source is, whatever version or ref it asks for — the way pi
 * tells them apart, so that `npm:foo@1.0.0` and `npm:foo@1.1.0` are the one
 * package `pi install` rewrote in place, and a git repository is the same
 * repository at any tag.
 */
export function packageKey(source: string): string {
  const s = source.trim();
  const name = npmName(s);
  if (name) return `npm:${name}`;
  const git = s.startsWith("git:") ? s.slice(4).trim() : /^(https?|ssh|git):\/\//i.test(s) ? s : undefined;
  if (git === undefined) return `local:${s}`;
  const scp = /^git@([^:]+):(.+)$/.exec(git);
  const [host, rest] = scp
    ? [scp[1], scp[2]]
    : (() => {
        const bare = git.replace(/^[a-z+]+:\/\//i, "").replace(/^[^@/]*@/, "");
        const slash = bare.indexOf("/");
        return slash < 0 ? [bare, ""] : [bare.slice(0, slash), bare.slice(slash + 1)];
      })();
  const repo = rest.split(/[@#]/)[0].replace(/\/+$/, "").replace(/\.git$/, "");
  return `git:${host.replace(/:\d+$/, "").toLowerCase()}/${repo}`;
}

/**
 * Whether an entry loads any extension. Tools come from extensions only, so a
 * package narrowed to its skills and prompts registers none, just as one
 * switched off entirely does.
 */
function loadsExtensions(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return true;
  const o = entry as Record<string, unknown>;
  return o.autoload === false || !(Array.isArray(o.extensions) && o.extensions.length === 0);
}

/**
 * What decides whether a tool remembered from an earlier session can still be
 * offered, for the packages in pi's settings.
 *
 * Not if the package that brought it loads no extensions any more or is no
 * longer listed. `package` is the source a session reported it under, matched
 * as the same package at any version; `null` says it came from no package of
 * the user's — built in, a folder, a project's own — and is always available.
 * An entry written before either was recorded only has the label it was filed
 * under, which for an npm package is its name, so a package switched off is
 * still recognised by it. Everything is available when the packages cannot be
 * read: hiding a tool on a guess is worse than showing a dead one.
 */
export function toolAvailability(packages: unknown): (tool: { source: string; package?: string | null }) => boolean {
  if (!Array.isArray(packages)) return () => true;
  const byKey = new Map<string, unknown>();
  const byName = new Map<string, unknown>();
  for (const entry of packages) {
    const source = sourceOf(entry);
    if (source === undefined) continue;
    byKey.set(packageKey(source), entry);
    const name = npmName(source);
    if (name) byName.set(name, entry);
  }
  return (tool) => {
    if (tool.package === null) return true;
    if (tool.package !== undefined) {
      const key = packageKey(tool.package);
      return byKey.has(key) && loadsExtensions(byKey.get(key));
    }
    return !byName.has(tool.source) || loadsExtensions(byName.get(tool.source));
  };
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
