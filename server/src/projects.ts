import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { isValidSlug, slugify } from "./slug.js";

/**
 * Projects: the folders a chat can work in.
 *
 * Every chat works in a folder. Most do not need one of their own, so "New"
 * starts chats in Home, which is the agent's own home directory and lives
 * outside the workspace root — so it is not here, and none of this can touch it.
 * A project is an extra folder you make on purpose, with instructions of its
 * own. Nothing here is tied to a session: deleting a chat never touches a
 * folder, and a folder is only ever created or removed by one of the functions
 * below.
 *
 * The instructions are the folder's AGENTS.md, which pi reads on its own when a
 * chat starts in it — there is nothing to hand over, and the file can be edited
 * anywhere.
 */

/** Not a project name: "home" is what chats start in, and would read as it. */
const RESERVED = new Set(["home"]);
/** What pi reads as a project's instructions. */
export const INSTRUCTIONS_FILE = "AGENTS.md";
const MAX_INSTRUCTIONS = 100_000;
/** A walk that has counted this many entries stops: the number is a warning, not an inventory. */
const COUNT_LIMIT = 20_000;

export type ProjectErrorCode = "invalid" | "exists" | "missing";

export class ProjectError extends Error {
  constructor(
    readonly code: ProjectErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface ProjectInfo {
  name: string;
  path: string;
  isGit: boolean;
  hasInstructions: boolean;
}

/**
 * The real folder a project name stands for, checked to be one directly under the root.
 *
 * Names arrive from a URL, so every one is treated as hostile: no separators,
 * no dot-names, nothing that resolves — through a symlink or otherwise — to a
 * place outside the root. The check is on the resolved path, not the string.
 */
function resolveProject(root: string, name: string): string {
  if (!name || name.includes("/") || name.includes("\\") || name.includes("\0") || name.startsWith(".")) {
    throw new ProjectError("invalid", `"${name}" is not a project name`);
  }
  const target = path.join(root, name);
  let stat;
  try {
    stat = lstatSync(target);
  } catch {
    throw new ProjectError("missing", `There is no project "${name}"`);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new ProjectError("invalid", `"${name}" is not a project folder`);
  }
  const real = realpathSync(target);
  if (path.dirname(real) !== realpathSync(root)) {
    throw new ProjectError("invalid", `"${name}" is not directly under the workspace root`);
  }
  return real;
}

const infoFor = (root: string, name: string): ProjectInfo => {
  const dir = path.join(root, name);
  return {
    name,
    path: dir,
    isGit: existsSync(path.join(dir, ".git")),
    hasInstructions: existsSync(path.join(dir, INSTRUCTIONS_FILE)),
  };
};

/** Every folder directly under the root, by name. */
export function listProjects(root: string): ProjectInfo[] {
  return readdirSync(root)
    .filter((name) => !name.startsWith("."))
    .filter((name) => {
      try {
        return statSync(path.join(root, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort()
    .map((name) => infoFor(root, name));
}

export function getProject(root: string, name: string): ProjectInfo {
  resolveProject(root, name);
  return infoFor(root, name);
}

/** Make a project. "Cool Project" becomes the folder "cool-project". */
export function createProject(root: string, rawName: string, instructions?: string): ProjectInfo {
  const name = slugify(rawName);
  if (!isValidSlug(name)) {
    throw new ProjectError("invalid", `"${rawName}" does not produce a usable folder name`);
  }
  if (RESERVED.has(name)) {
    throw new ProjectError("invalid", `"${name}" is taken: it is where chats start by default`);
  }
  const target = path.join(root, name);
  if (path.resolve(target) !== target || path.dirname(target) !== path.resolve(root)) {
    throw new ProjectError("invalid", "Invalid project name");
  }
  if (existsSync(target)) throw new ProjectError("exists", `There is already a project "${name}"`);
  mkdirSync(target, { recursive: true });
  if (instructions?.trim()) writeInstructions(root, name, instructions);
  return infoFor(root, name);
}

export function readInstructions(root: string, name: string): string {
  const dir = resolveProject(root, name);
  try {
    return readFileSync(path.join(dir, INSTRUCTIONS_FILE), "utf8");
  } catch {
    return "";
  }
}

/** Saves the project's instructions; blank removes the file, so an empty project has none. */
export function writeInstructions(root: string, name: string, text: string): void {
  const dir = resolveProject(root, name);
  if (text.length > MAX_INSTRUCTIONS) {
    throw new ProjectError("invalid", `Instructions are limited to ${MAX_INSTRUCTIONS.toLocaleString()} characters`);
  }
  const file = path.join(dir, INSTRUCTIONS_FILE);
  if (!text.trim()) {
    rmSync(file, { force: true });
    return;
  }
  writeFileSync(file, text.replace(/\s+$/, "") + "\n");
}

/** What is in a project, for the question "are you sure?". */
export function describeProject(root: string, name: string): { files: number; bytes: number; complete: boolean } {
  const dir = resolveProject(root, name);
  let files = 0;
  let bytes = 0;
  let seen = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (++seen > COUNT_LIMIT) return { files, bytes, complete: false };
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) {
        files++;
        try {
          bytes += statSync(full).size;
        } catch {
          // Gone between listing and stat.
        }
      }
    }
  }
  return { files, bytes, complete: true };
}

/** Removes the folder and everything in it. */
export function deleteProjectFolder(root: string, name: string): void {
  rmSync(resolveProject(root, name), { recursive: true, force: true });
}

/**
 * A chat's name from its first message: the first line, short, on one line.
 * Only used while a chat still has the placeholder name, so it never overwrites
 * one somebody chose.
 */
export function titleFrom(message: string): string | undefined {
  const line = message.split("\n").find((l) => l.trim())?.replace(/\s+/g, " ").trim();
  if (!line || line.startsWith("/")) return undefined;
  return line.length > 48 ? line.slice(0, 47).trimEnd() + "…" : line;
}

/** The name a chat has until its first message names it. */
export const NEW_CHAT_TITLE = "New chat";
