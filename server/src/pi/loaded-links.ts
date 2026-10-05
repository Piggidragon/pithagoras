import { readdirSync, statSync, type Dirent } from "node:fs";
import path from "node:path";
import { realPathAhead } from "../within.js";
import { LOADED_IN_FOLDERS, loadedPlaces, type LoadedPlace } from "./loaded-from-folders.js";

/**
 * Where a link leads, that is loaded because of where it is.
 *
 * The list in loaded-from-folders.ts says what pi, the MCP adapter, the heartbeat
 * and the portal load by name and from which places. A link in one of them is
 * loaded as the place it is in is, and what it leads to is what is read: a skill
 * folder that is a link into another folder of the project is read from there, so
 * a write to that folder is a write to the skill. This finds those places, by
 * where they really are, so that the guard compares the one thing: where a write
 * really lands, and the places that are loaded, as they really are.
 *
 * Three kinds of link are looked for, and what they lead to is held as the place
 * is, with everything under it:
 * - one at a name of the list in a folder somebody works in, in whatever case the
 *   folder spells the name (a file system may tell `AGENTS.MD` from `AGENTS.md`);
 * - one anywhere inside a folder that is loaded whole (`.pi`, `.agents`, pi's agent
 *   folder, the folders that ship with the portal) and, link in link, inside what
 *   that leads to;
 * - the same for a place of the list.
 *
 * Bounded: what somebody installed or fetched (`node_modules`, `.git`) is not read,
 * and a place is looked into for its first folders only, nearest first. A link
 * further down a tree that big is not found, which the page on roles says.
 */

/** What is installed or fetched rather than written: a link in it leads where its package put it. */
const FETCHED = new Set(["node_modules", ".git"]);

/** How many folders are read inside the places that are held whole, inside the folders that are loaded whole in a project or a home, and for the folders of all the projects. */
const IN_PLACES = 2000;
const IN_FOLDERS = 2000;
const IN_PROJECTS = 5000;

const isFolder = (p: string): boolean => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** Reads folders until its allowance is used: a link is looked for in the first folders of a tree, not in all of an enormous one. */
function reader(allowance: number): (dir: string) => Dirent[] {
  let left = allowance;
  return (dir) => {
    if (left <= 0) return [];
    left--;
    try {
      return readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
  };
}

/** The paths `dir` has for a name of the list, by the case the folder spells them in; `.vscode/mcp.json` is looked for part by part. */
function spelled(dir: string, entries: Dirent[], name: string): string[] {
  const [first, ...rest] = name.split("/");
  let found = entries.filter((e) => e.name.toLowerCase() === first.toLowerCase()).map((e) => path.join(dir, e.name));
  for (const part of rest) {
    found = found.flatMap((at) => {
      try {
        return readdirSync(at).filter((n) => n.toLowerCase() === part.toLowerCase()).map((n) => path.join(at, n));
      } catch {
        return [];
      }
    });
  }
  return found;
}

/**
 * Every place that is loaded because a link leads to it, as it really is.
 *
 * `folders` are looked at for a link at one of the names (an agent's home, the
 * folder of a conversation); `trees` are looked at the same way and every folder
 * under them too, for a chat of the primary user may run in any of those (the
 * folders of the projects). Without either only the links inside the places held
 * whole are followed.
 */
export function loadedByLinks(where: { folders: string[]; trees: string[] }): LoadedPlace[] {
  const found: LoadedPlace[] = [];
  const walked = new Set<string>();

  /** A place that is loaded whole: it as it really is, and what each link inside it leads to, link in link. */
  const hold = (place: LoadedPlace, read: (dir: string) => Dirent[]): void => {
    const start = realPathAhead(place.path);
    found.push({ ...place, path: start });
    const todo = [start];
    while (todo.length) {
      const dir = todo.pop()!;
      if (walked.has(dir) || !isFolder(dir)) continue;
      walked.add(dir);
      for (const entry of read(dir)) {
        const at = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) {
          const leads = realPathAhead(at);
          found.push({ ...place, path: leads });
          todo.push(leads);
        } else if (entry.isDirectory() && !FETCHED.has(entry.name)) {
          todo.push(at);
        }
      }
    }
  };

  const readInFolders = reader(IN_FOLDERS);
  /** A link at a name of the list is loaded as that name is. */
  const look = (dir: string, entries: Dirent[]): void => {
    for (const item of LOADED_IN_FOLDERS) {
      for (const at of spelled(dir, entries, item.name)) hold({ path: at, by: item.by, as: item.as }, readInFolders);
    }
  };

  const readInPlaces = reader(IN_PLACES);
  for (const place of loadedPlaces()) hold(place, readInPlaces);

  const readTop = reader(Infinity);
  for (const dir of where.folders) look(dir, readTop(dir));

  // Folders that are held whole are read from `hold`, not as the folders of a project: what is inside is not a name to look for.
  const wholeFolders = new Set(LOADED_IN_FOLDERS.filter((e) => e.folder).map((e) => e.name.toLowerCase()));
  const readInProjects = reader(IN_PROJECTS);
  const queue = [...where.trees];
  const seen = new Set<string>();
  for (let next = 0; next < queue.length; next++) {
    const dir = queue[next];
    if (seen.has(dir)) continue;
    seen.add(dir);
    const entries = readInProjects(dir);
    look(dir, entries);
    for (const entry of entries) {
      if (entry.isDirectory() && !FETCHED.has(entry.name) && !wholeFolders.has(entry.name.toLowerCase())) queue.push(path.join(dir, entry.name));
    }
  }
  return found;
}
