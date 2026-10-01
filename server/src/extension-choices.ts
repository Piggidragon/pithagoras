import { readFileSync } from "node:fs";
import path from "node:path";
import { loadsExtensions, npmName, packageKey, sourceOf } from "./extension-switch.js";
import { localPackagePath, SUBAGENT_PACKAGE } from "./features.js";
import { looseExtensions, type LooseExtension } from "./loose-extensions.js";
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

function packageJson(dir: string): { name?: unknown } | undefined {
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
  return typeof name === "string" && name ? name : path.basename(dir ?? source);
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

/**
 * The extensions that are on in a chat: the packages of the user's settings and
 * of the chat's project that load extensions, and the loose ones in the two
 * `extensions` folders and those the `extensions` settings add. As in Settings → Extensions and the chat's tools menu:
 * a package switched off, or narrowed to none of its extensions, is not there,
 * and one whose tools are all off in this chat is not either. A project that
 * lists a package and loads it has it, whatever the user's entry says. A loose
 * one that `pi config` switched off (or the setting's `!`, `-` leave off) is not.
 *
 * Left out: the portal's own extensions, and the connections to screens
 * (`screen-…`), which are the agent's and not what is connected.
 */
export function installedExtensions(seen: ExtensionsSeen): ExtensionChoice[] {
  const bundled = seen.bundled ? real(seen.bundled) : undefined;
  const projectBase = seen.projectDir ? path.join(seen.projectDir, ".pi") : undefined;

  const byKey = new Map<string, { source: string; dir?: string; user: boolean; project: boolean }>();
  const list = (packages: unknown, base: string | undefined, scope: "user" | "project") => {
    if (!Array.isArray(packages) || base === undefined) return;
    for (const entry of packages) {
      const source = sourceOf(entry);
      if (source === undefined || !loadsExtensions(entry)) continue;
      const key = packageKey(source);
      const dir = key.startsWith("local:") ? localPackagePath(source, base) : undefined;
      // The subagent tool the portal installs from its own folder is the portal's.
      if (dir && ((bundled && real(dir) === bundled) || packageJson(dir)?.name === SUBAGENT_PACKAGE)) continue;
      const had = byKey.get(key) ?? { source, dir, user: false, project: false };
      had[scope] = true;
      byKey.set(key, had);
    }
  };
  list(seen.userPackages, seen.agentDir, "user");
  list(seen.projectPackages, projectBase, "project");

  // The loose ones, as pi's `extensions` setting leaves them: one switched off in `pi config` is not on, and a path the setting adds is.
  const user = looseExtensions(path.join(seen.agentDir, "extensions"), seen.agentDir, seen.userExtensions);
  const project = projectBase ? looseExtensions(path.join(projectBase, "extensions"), projectBase, seen.projectExtensions) : [];
  const connections = [...glues(user), ...glues(project)];
  const choices = new Map<string, ExtensionChoice>();
  const add = (value: string, detail: string, projectOnly: boolean) => {
    if (choices.has(value)) return;
    choices.set(value, { value, detail, notes: [...(hasGlue(value, connections) ? ["screen"] : []), ...(projectOnly ? ["project"] : [])] });
  };

  for (const [key, one] of byKey) {
    // Off in this chat as a whole: the group of its tools in the chat's menu is switched off.
    const own = seen.tools.filter((t) => [t.package, t.projectPackage].some((p) => typeof p === "string" && packageKey(p) === key));
    if (own.length > 0 && own.every((t) => seen.off.has(t.name))) continue;
    add(nameOf(one.source, one.dir), one.dir ?? one.source, !one.user);
  }
  for (const e of user) if (!GLUE.test(e.name)) add(e.name, e.path, false);
  for (const e of project) if (!GLUE.test(e.name)) add(e.name, e.path, true);

  return [...choices.values()].sort((a, b) => a.value.localeCompare(b.value, "en", { sensitivity: "base" }));
}
