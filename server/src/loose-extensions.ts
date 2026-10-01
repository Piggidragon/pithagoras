import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The extensions pi loads that are not in a package: scripts and folders in an
 * `extensions` folder (pi's own, or a project's `.pi`), and the paths that the
 * `extensions` setting adds.
 *
 * Read the way pi reads them (its package manager's discovery and its
 * `extensions` overrides), so that one switched off with `pi config` is not
 * taken for one that is on. Only the glob syntax of `*`, `**` and `?` is
 * followed in a pattern; one with brackets, braces or groups is not matched.
 */
export interface LooseExtension {
  /** What a person calls it: the script's name without its ending, or its folder's name. */
  name: string;
  path: string;
  /** The files pi loads for it: a script itself, a folder's entries. */
  files: string[];
}

const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const isFile = (p: string) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};
const posix = (p: string) => p.split(path.sep).join("/");

/** What a folder is loaded by: the entries its `package.json` names under `pi.extensions` that exist, else its `index.ts`, else its `index.js`. */
function entriesOf(dir: string): string[] | undefined {
  try {
    const named = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"))?.pi?.extensions;
    if (Array.isArray(named)) {
      const found = named.filter((e): e is string => typeof e === "string").map((e) => path.resolve(dir, e)).filter((e) => existsSync(e));
      if (found.length > 0) return found;
    }
  } catch {
    /* no manifest, or none that can be read: the index decides */
  }
  const index = ["index.ts", "index.js"].map((f) => path.join(dir, f)).find((f) => existsSync(f));
  return index ? [index] : undefined;
}

/** What pi finds in a folder of extensions: the folder itself where it has entries, otherwise each script and each folder with entries, one level down. */
export function discovered(dir: string): LooseExtension[] {
  const root = entriesOf(dir);
  if (root) return [{ name: path.basename(dir), path: dir, files: root }];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: LooseExtension[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    // A link is what it points at.
    if (entry.isDirectory() || (entry.isSymbolicLink() && isDir(full))) {
      const files = entriesOf(full);
      if (files) found.push({ name: entry.name, path: full, files });
    } else if (/\.(ts|js)$/.test(entry.name) && (entry.isFile() || isFile(full))) {
      found.push({ name: entry.name.replace(/\.(ts|js)$/, ""), path: full, files: [full] });
    }
  }
  return found;
}

const isOverride = (pattern: string) => /^[!+-]/.test(pattern);
const isPattern = (pattern: string) => isOverride(pattern) || /[*?]/.test(pattern);

/** A pattern of `*`, `**` and `?` as an expression; none for one that uses more than that. */
function glob(pattern: string): RegExp | undefined {
  if (/[[\]{}()]/.test(pattern)) return undefined;
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*" && pattern[i + 1] === "*") {
      const slash = pattern[i + 2] === "/";
      source += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (c === "*") source += "[^/]*";
    else if (c === "?") source += "[^/]";
    else source += c.replace(/[.+^$|\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

const plain = (pattern: string) => posix(pattern.startsWith("./") ? pattern.slice(2) : pattern);

/** What a pattern is held against: the file's path from the base, its name, and the whole path. */
function names(file: string, base: string): string[] {
  return [posix(path.relative(base, file)), path.basename(file), posix(file)];
}
const matches = (file: string, patterns: string[], base: string) =>
  patterns.some((p) => {
    const re = glob(plain(p));
    return re !== undefined && names(file, base).some((n) => re.test(n));
  });
/** `+` and `-` name one file, in full: as the path from the base, or the whole path. No pattern. */
const named = (file: string, patterns: string[], base: string) => {
  const [rel, , abs] = names(file, base);
  return patterns.some((p) => plain(p) === rel || plain(p) === abs);
};

/** Whether the overrides leave a file that was found in a folder of extensions on: `!` takes it off, `+` puts it back, and `-` takes it off for good. */
function enabledByOverrides(file: string, patterns: string[], base: string): boolean {
  const of = (mark: string) => patterns.filter((p) => p.startsWith(mark)).map((p) => p.slice(1));
  let on = true;
  if (matches(file, of("!"), base)) on = false;
  if (named(file, of("+"), base)) on = true;
  if (named(file, of("-"), base)) on = false;
  return on;
}

/** The files of the paths the setting lists, that its patterns leave on: the plain entries are the files, the patterns narrow them. */
function enabledByPatterns(files: string[], patterns: string[], base: string): Set<string> {
  const of = (test: (p: string) => boolean, cut: boolean) => patterns.filter(test).map((p) => (cut ? p.slice(1) : p));
  const includes = of((p) => !isOverride(p), false);
  const excludes = of((p) => p.startsWith("!"), true);
  const keep = new Set(includes.length > 0 ? files.filter((f) => matches(f, includes, base)) : files);
  for (const f of files) if (keep.has(f) && matches(f, excludes, base)) keep.delete(f);
  for (const f of files) if (named(f, of((p) => p.startsWith("+"), true), base)) keep.add(f);
  for (const f of files) if (named(f, of((p) => p.startsWith("-"), true), base)) keep.delete(f);
  return keep;
}

/** A path of the setting, as pi resolves it: `~` is the home folder, and a relative path starts at the base. */
function resolveFrom(input: string, base: string): string {
  const text = input.trim();
  if (text === "~") return os.homedir();
  if (text.startsWith("~/")) return path.join(os.homedir(), text.slice(2));
  return path.resolve(base, text);
}

/**
 * The loose extensions that are on: those found in `dir`, and those the
 * `extensions` setting adds by path, as its overrides leave them. `base` is
 * what the setting's paths and patterns start at: pi's folder for the user's,
 * a project's `.pi` for its own.
 */
export function looseExtensions(dir: string, base: string, setting: unknown): LooseExtension[] {
  const entries = Array.isArray(setting) ? setting.filter((e): e is string => typeof e === "string") : [];
  const overrides = entries.filter(isOverride);
  const found = discovered(dir).filter((e) => e.files.some((f) => enabledByOverrides(f, overrides, base)));

  const added = entries
    .filter((e) => !isPattern(e))
    .map((e) => resolveFrom(e, base))
    .filter(existsSync)
    .flatMap((p) => (isDir(p) ? discovered(p) : isFile(p) ? [{ name: path.basename(p).replace(/\.(ts|js)$/, ""), path: p, files: [p] }] : []));
  const on = enabledByPatterns(added.flatMap((e) => e.files), entries.filter(isPattern), base);
  for (const e of added) if (e.files.some((f) => on.has(f))) found.push(e);
  return found;
}
