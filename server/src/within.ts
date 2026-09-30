import { realpathSync } from "node:fs";
import path from "node:path";
import { below } from "./paths.js";

/**
 * What of `where` is under the folder `dir` — "" for the folder itself — or
 * undefined when it is elsewhere, by the text of the path alone: no look at the
 * disk. Both are normalised first, so `..`, `.` and doubled or trailing
 * separators say what they mean — `/w/site/../backup` is not in `/w/site` — and
 * a sibling that only shares the start of the name (`/w/site-old`) is not
 * inside. Everything is inside `/`.
 */
export const pathBelow = (dir: string, where: string): string | undefined => below(path.normalize(dir), path.normalize(where));

/** `where` is the folder `dir` or inside it, by the text of the path alone. */
export const isWithinText = (dir: string, where: string): boolean => pathBelow(dir, where) !== undefined;

/** `where` is inside the folder `dir` and not the folder itself, by the text of the path alone. */
export const isUnderText = (dir: string, where: string): boolean => !!pathBelow(dir, where);

/** Where a path really leads, every link followed; null when it cannot be followed, such as a path that is gone. */
export function realPath(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

/**
 * `where` is the folder `dir` or inside it, by the text or by where it really
 * leads, so that a link to a project counts as in the project.
 */
export function isWithinReal(dir: string, where: string | null): boolean {
  return insideReal(dir)(where);
}

/**
 * `isWithinReal` as a test to put to many places, which follows `dir` once,
 * the first time the text alone does not answer.
 */
export function insideReal(dir: string): (where: string | null) => boolean {
  let realDir: string | null | undefined;
  return (where) => {
    if (!where) return false;
    if (isWithinText(dir, where)) return true;
    if (realDir === undefined) realDir = realPath(dir);
    if (realDir === null) return false;
    const realWhere = realPath(where);
    return realWhere !== null && isWithinText(realDir, realWhere);
  };
}
