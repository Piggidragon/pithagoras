import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The extensions pi loads that are not in a package: scripts and folders in an
 * `extensions` folder (pi's own, or a project's `.pi`), and the paths that the
 * `extensions` settings add.
 *
 * Read the way pi's package manager reads them, so that one switched off with
 * `pi config` is not taken for one that is on, and one the project switches off
 * is not either. A file has one state, the first it is given: by the project's
 * `extensions` entries, then the user's, then as found in the project's folder,
 * then in the user's. Only the glob syntax of `*`, `**` and `?` is followed in
 * a pattern; one with brackets, braces or groups is not matched.
 */
export interface LooseExtension {
  /** What a person calls it: the script's name without its ending, or its folder's name. */
  name: string;
  path: string;
  /** The files pi loads for it: a script itself, a folder's entries. */
  files: string[];
  /** Whether the chat's project brings it: it is in its folder, or its setting adds it. */
  project: boolean;
}

/** One side of the settings: where its extensions are kept, what its paths and patterns start at, and its `extensions` setting. */
export interface LooseScope {
  dir: string;
  base: string;
  setting: unknown;
}

export const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};
export const isFile = (p: string) => {
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

/** A name against a pattern of `*` and `?`, as an expression. */
function nameExpression(pattern: string): RegExp {
  let source = "";
  for (const c of pattern) source += c === "*" ? "[^/]*" : c === "?" ? "[^/]" : c.replace(/[.+^$|\\()[\]{}]/g, "\\$&");
  return new RegExp(`^${source}$`);
}

/**
 * What the ignore files of a folder (`.gitignore`, `.ignore`, `.fdignore`) leave
 * out of it, for a name in the folder itself: a plain name, or one with `*` and
 * `?`, `dir/` for a folder, and `!` to take one back, the last line that matches
 * deciding. Lines about what is deeper, or with brackets, are not looked at.
 */
function ignores(dir: string): (name: string, folder: boolean) => boolean {
  const rules: { match: RegExp; negated: boolean; folderOnly: boolean }[] = [];
  for (const file of [".gitignore", ".ignore", ".fdignore"]) {
    let text: string;
    try {
      text = readFileSync(path.join(dir, file), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim() || (line.trim().startsWith("#") && !line.startsWith("\\#"))) continue;
      let pattern = line.replace(/(?<!\\)\s+$/, "");
      const negated = pattern.startsWith("!");
      if (negated) pattern = pattern.slice(1);
      else if (pattern.startsWith("\\!")) pattern = pattern.slice(1);
      pattern = pattern.replace(/^\/+/, "");
      const folderOnly = pattern.endsWith("/");
      pattern = pattern.replace(/\/+$/, "").replace(/^(\*\*\/)+/, "").replace(/^\\(?=[#!])/, "");
      if (!pattern || pattern.includes("/") || /[[\]\\]/.test(pattern)) continue;
      rules.push({ match: nameExpression(pattern), negated, folderOnly });
    }
  }
  return (name, folder) => {
    let out = false;
    for (const rule of rules) if ((!rule.folderOnly || folder) && rule.match.test(name)) out = !rule.negated;
    return out;
  };
}

/** What pi finds in a folder of extensions: the folder itself where it has entries, otherwise each script and each folder with entries, one level down, and not what the folder's ignore files leave out. */
export function discovered(dir: string, project = false): LooseExtension[] {
  const root = entriesOf(dir);
  if (root) return [{ name: path.basename(dir), path: dir, files: root, project }];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const left = ignores(dir);
  const found: LooseExtension[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    // A link is what it points at.
    const folder = entry.isDirectory() || (entry.isSymbolicLink() && isDir(full));
    if (left(entry.name, folder)) continue;
    if (folder) {
      const files = entriesOf(full);
      if (files) found.push({ name: entry.name, path: full, files, project });
    } else if (/\.(ts|js)$/.test(entry.name) && (entry.isFile() || isFile(full))) {
      found.push({ name: entry.name.replace(/\.(ts|js)$/, ""), path: full, files: [full], project });
    }
  }
  return found;
}

const isOverride = (pattern: string) => /^[!+-]/.test(pattern);
const isPattern = (pattern: string) => isOverride(pattern) || /[*?]/.test(pattern);

/** A name against one segment of a pattern: `*` and `?` stand for letters of it, and not for a leading dot the pattern does not have. */
const segment = (pattern: string, name: string) => (!name.startsWith(".") || pattern.startsWith(".")) && nameExpression(pattern).test(name);

/** The segments of a path against those of a pattern. A segment of `**` alone is any number of them, none led by a dot; `**` anywhere else is only a `*`. */
function walk(pattern: string[], text: string[]): boolean {
  if (pattern.length === 0) return text.length === 0;
  if (pattern[0] === "**") {
    for (let i = 0; i <= text.length; i++) {
      if (walk(pattern.slice(1), text.slice(i))) return true;
      if (text[i]?.startsWith(".")) return false;
    }
    return false;
  }
  return text.length > 0 && segment(pattern[0], text[0]) && walk(pattern.slice(1), text.slice(1));
}

const plain = (pattern: string) => posix(pattern.startsWith("./") ? pattern.slice(2) : pattern);

/** Whether a path is matched by a pattern, for one this follows: not a comment, and no brackets, braces or groups. A leading `./` is not dropped here, as pi does not for these. */
const globbed = (pattern: string, text: string) => !pattern.startsWith("#") && !/[[\]{}()]/.test(pattern) && walk(posix(pattern).replace(/\/{2,}/g, "/").split("/"), text.split("/"));

/** What a pattern is held against: the file's path from the base, its name, and the whole path. */
function names(file: string, base: string): string[] {
  return [posix(path.relative(base, file)), path.basename(file), posix(file)];
}
const matches = (file: string, patterns: string[], base: string) => patterns.some((p) => names(file, base).some((n) => globbed(p, n)));
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

/** The files of the paths a setting lists, that its patterns leave on: the plain entries are the files, the patterns narrow them. */
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

const stringsOf = (setting: unknown): string[] => (Array.isArray(setting) ? setting.filter((e): e is string => typeof e === "string") : []);

/**
 * The loose extensions that are on in a chat: those found in the two folders,
 * and those the two `extensions` settings add by path, as pi leaves them. pi
 * gives a file the state it is first given, in this order: the project's
 * setting, the user's, the project's folder, the user's folder. So a project
 * can switch off an extension of the user's, by listing its path and a `-` for
 * it (what `pi config` writes for the project), or by a `!` that matches it.
 * The user's come before the project's in the result, so that a name both have
 * is the user's.
 */
export function looseExtensions(user: LooseScope, project?: LooseScope): LooseExtension[] {
  const scopes: (LooseScope & { project: boolean })[] = [];
  if (project) scopes.push({ ...project, project: true });
  scopes.push({ ...user, project: false });
  const state = new Map<string, boolean>();
  const give = (file: string, on: boolean) => {
    if (!state.has(file)) state.set(file, on);
  };

  const added: LooseExtension[] = [];
  for (const scope of scopes) {
    const entries = stringsOf(scope.setting);
    const listed = entries
      .filter((e) => !isPattern(e))
      .map((e) => resolveFrom(e, scope.base))
      .filter((p) => existsSync(p))
      .flatMap((p): LooseExtension[] => (isDir(p) ? discovered(p, scope.project) : isFile(p) ? [{ name: path.basename(p).replace(/\.(ts|js)$/, ""), path: p, files: [p], project: scope.project }] : []));
    const on = enabledByPatterns(listed.flatMap((e) => e.files), entries.filter(isPattern), scope.base);
    for (const e of listed) for (const f of e.files) give(f, on.has(f));
    added.push(...listed);
  }

  const found: LooseExtension[] = [];
  for (const scope of scopes) {
    const overrides = stringsOf(scope.setting).filter(isOverride);
    for (const e of discovered(scope.dir, scope.project)) {
      for (const f of e.files) give(f, enabledByOverrides(f, overrides, scope.base));
      found.push(e);
    }
  }

  const seen = new Set<string>();
  const on: LooseExtension[] = [];
  for (const e of [...found, ...added].sort((a, b) => Number(a.project) - Number(b.project))) {
    if (!e.files.some((f) => state.get(f)) || seen.has(e.path)) continue;
    seen.add(e.path);
    on.push(e);
  }
  return on;
}
