import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadsExtensions, npmName, packageKey, sourceOf } from "./extension-switch.js";
import { localPackagePath, SUBAGENT_PACKAGE } from "./features.js";
import { discovered, isDir, isFile, looseExtensions, type LooseExtension } from "./loose-extensions.js";
import { realPath } from "./within.js";

/**
 * The pi extensions a chat has, as names to pick from: what `/screen` offers
 * to connect, and any command that takes an extension as its argument.
 *
 * A name is what a person says (`@scope/name`, a repository, a folder) and
 * the agent finds again with `pi list`; nothing here knows any extension.
 */
export interface ExtensionChoice {
  /** What goes after the command. */
  value: string;
  /** Where it comes from: the source it is listed as, or its folder. */
  detail: string;
  /** Short words the page puts a label to: `screen` (it has one already), `project` (the chat's project brings it). */
  notes: string[];
}

export interface ExtensionsSeen {
  /** pi's own folder: the user's loose extensions are in `extensions` beneath it, and a package's local path is relative to it. */
  agentDir: string;
  /** What the user's settings list as `packages`, and as `extensions`: paths of extensions, and what switches them off. */
  userPackages: unknown;
  userExtensions?: unknown;
  /** The folder the chat runs in, whose `.pi` holds what its project brings; none for a chat outside any. */
  projectDir?: string;
  projectPackages?: unknown;
  projectExtensions?: unknown;
  /** The tools the portal has seen registered, by the package that brought them: one of the user's settings, or one of a project's. */
  tools: { name: string; package?: string | null; projectPackage?: string }[];
  /** The tools off in this chat, whatever switched them: the default, its project, the chat itself. */
  off: ReadonlySet<string>;
  /** The extensions the portal ships (not one the user installed). */
  bundled?: string;
}

const real = (p: string) => realPath(p) ?? path.resolve(p);

function packageJson(dir: string): { name?: unknown; pi?: unknown } | undefined {
  try {
    return JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  } catch {
    return undefined;
  }
}

/** What a package is called to a person: its npm name, its repository, the name of its folder. */
function nameOf(source: string, dir: string | undefined): string {
  const key = packageKey(source);
  if (key.startsWith("npm:")) return npmName(source) ?? key.slice(4);
  if (key.startsWith("git:")) return key.slice(4);
  const name = dir ? packageJson(dir)?.name : undefined;
  return typeof name === "string" && name ? name : path.basename(dir ?? source).replace(/\.(ts|js)$/, "");
}

/** The folders the agent's connections to screens are kept in (`screen-<slug>`, see the skill `extension-screens`). */
const GLUE = /^screen-/;

/** A connection to a screen that is on: its slug, and the extension it says it was written against. */
function glues(found: LooseExtension[]): { slug: string; against: string }[] {
  return found
    .filter((e) => GLUE.test(e.name))
    .map((e) => {
      let head = "";
      try {
        head = readFileSync(e.files[0], "utf8").slice(0, 4000);
      } catch {
        /* a folder with nothing to read says only its name */
      }
      return { slug: slugOf(e.name.replace(GLUE, "")), against: /Written against:[ \t]*(.+)/i.exec(head)?.[1] ?? "" };
    });
}

const slugOf = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/**
 * Whether one of the connections is for this extension: its folder is named for
 * it (`screen-rpiv-todo` for `@scope/rpiv-todo`, with the scope or without), or
 * the line that says what it was written against names it as a whole word.
 */
function hasGlue(value: string, connections: { slug: string; against: string }[]): boolean {
  const last = value.split("/").pop() ?? value;
  const slugs = new Set([slugOf(value), slugOf(last)]);
  const word = new RegExp(`(^|[^\\w@/.-])${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\w-])`, "i");
  return connections.some((c) => (c.slug !== "" && slugs.has(c.slug)) || (c.against !== "" && word.test(c.against)));
}

/** A package as one side of the settings lists it. */
interface Listing {
  entry: unknown;
  source: string;
  /** The folder of a package kept in one. */
  dir?: string;
  /** What the settings that list it start at: pi's folder, or the project's `.pi`. Where pi installs a package is beneath it. */
  base: string;
}

/**
 * Whether a package has an extension for pi to load, which is a thing of what it
 * holds and not of what the settings say. Read as pi reads it: a manifest
 * (`pi` in its `package.json`) names the extensions, or else there are some in
 * its `extensions` folder, and one that only has skills, prompts or themes has
 * none. A folder that has none of those is itself the extension, but only when
 * it is a local package. Where it is found is the folder of a local package, or
 * where pi installs an npm or git package under the settings' base; one that is
 * not there is taken to be on, as it may be installed another way or not yet. A
 * local folder that is not there loads nothing.
 */
function bringsExtensions(listing: Listing): boolean {
  const key = packageKey(listing.source);
  const root = listing.dir ?? (key.startsWith("npm:") ? path.join(listing.base, "npm", "node_modules", key.slice(4)) : key.startsWith("git:") ? path.join(listing.base, "git", ...key.slice(4).split("/")) : undefined);
  if (root === undefined) return true;
  if (!existsSync(root)) return listing.dir === undefined;
  if (!isDir(root)) return true;

  const manifest = packageJson(root)?.pi;
  const listed = manifest && typeof manifest === "object" ? (manifest as { extensions?: unknown }).extensions : undefined;
  const named = Array.isArray(listed) ? listed.filter((e): e is string => typeof e === "string" && !/^[!+-]/.test(e)) : [];
  // A path, which counts if it is a script or has some in it; a glob is not looked through.
  if (named.length > 0) return named.some((e) => /[*?]/.test(e) || isFile(path.resolve(root, e)) || (isDir(path.resolve(root, e)) && discovered(path.resolve(root, e)).length > 0));
  // An entry with a list of its own looks in the folder as well, where the manifest names no extension.
  if (manifest && typeof listing.entry !== "object") return false;
  const folder = path.join(root, "extensions");
  if (isDir(folder)) return discovered(folder).length > 0;
  if (["skills", "prompts", "themes"].some((d) => isDir(path.join(root, d)))) return false;
  return listing.dir !== undefined && !manifest;
}

/**
 * The extensions that are on in a chat: the packages of the user's settings and
 * of the chat's project that load extensions, and the loose ones in the two
 * `extensions` folders and those the `extensions` settings add. As in
 * Settings → Extensions and the chat's tools menu: a package switched off, or
 * narrowed to none of its extensions, is not there, and one whose tools are all
 * off in this chat is not either, nor one that has no extension to load (only
 * skills, say, or a folder that is gone).
 *
 * Where both settings list a package, the project's entry decides alone, as in
 * pi: a project that lists it and loads it has it, whatever the user's entry
 * says, and one that lists it switched off does not, whatever the user's says.
 * Not so for an entry with `autoload: false`, which changes the user's by file
 * and is not followed: the user's entry decides. A loose extension that
 * `pi config` switched off, or the project's setting switches off, is not there.
 *
 * Left out: the portal's own extensions, and the connections to screens
 * (`screen-…`), which are the agent's and not what is connected.
 */
export function installedExtensions(seen: ExtensionsSeen): ExtensionChoice[] {
  const bundled = seen.bundled ? real(seen.bundled) : undefined;
  const projectBase = seen.projectDir ? path.join(seen.projectDir, ".pi") : undefined;

  // By what pi takes a package for: a folder by where it is, the rest by what `packageKey` says.
  const listings = (packages: unknown, base: string | undefined, last: boolean) => {
    const found = new Map<string, Listing>();
    if (!Array.isArray(packages) || base === undefined) return found;
    for (const entry of packages) {
      const source = sourceOf(entry);
      if (source === undefined) continue;
      const key = packageKey(source);
      const dir = key.startsWith("local:") ? localPackagePath(source, base) : undefined;
      // The subagent tool the portal installs from its own folder is the portal's.
      if (dir && ((bundled && real(dir) === bundled) || packageJson(dir)?.name === SUBAGENT_PACKAGE)) continue;
      const id = dir ? `local:${dir}` : key;
      if (last || !found.has(id)) found.set(id, { entry, source, dir, base });
    }
    return found;
  };
  const user = listings(seen.userPackages, seen.agentDir, false);
  const project = listings(seen.projectPackages, projectBase, true);

  const loose = looseExtensions(
    { dir: path.join(seen.agentDir, "extensions"), base: seen.agentDir, setting: seen.userExtensions },
    projectBase ? { dir: path.join(projectBase, "extensions"), base: projectBase, setting: seen.projectExtensions } : undefined,
  );
  const connections = glues(loose);
  const choices = new Map<string, ExtensionChoice>();
  const add = (value: string, detail: string, projectOnly: boolean) => {
    if (choices.has(value)) return;
    choices.set(value, { value, detail, notes: [...(hasGlue(value, connections) ? ["screen"] : []), ...(projectOnly ? ["project"] : [])] });
  };

  for (const id of new Set([...user.keys(), ...project.keys()])) {
    const u = user.get(id);
    const p = project.get(id);
    const userOn = !!u && loadsExtensions(u.entry);
    const projectOn = !!p && loadsExtensions(p.entry);
    const delta = !!p && typeof p.entry === "object" && (p.entry as Record<string, unknown>).autoload === false;
    if (!(p && !delta ? projectOn : userOn || projectOn)) continue;
    const one = (userOn ? u : p) as Listing;
    // What pi loads it from is the entry that decides: where the project lists it, the project's install.
    if (!bringsExtensions((p && !delta ? p : one) as Listing)) continue;
    // Off in this chat as a whole: the group of its tools in the chat's menu is switched off.
    const keys = new Set([u, p].filter((l): l is Listing => l !== undefined).map((l) => packageKey(l.source)));
    const own = seen.tools.filter((t) => [t.package, t.projectPackage].some((x) => typeof x === "string" && keys.has(packageKey(x))));
    if (own.length > 0 && own.every((t) => seen.off.has(t.name))) continue;
    add(nameOf(one.source, one.dir), one.dir ?? one.source, !userOn);
  }
  for (const e of loose) if (!GLUE.test(e.name)) add(e.name, e.path, e.project);

  return [...choices.values()].sort((a, b) => a.value.localeCompare(b.value, "en", { sensitivity: "base" }));
}
