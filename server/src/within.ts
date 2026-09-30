import { realpathSync } from "node:fs";
import path from "node:path";
import { within } from "./paths.js";

/**
 * `where` is the folder `dir` or inside it, by the text of the path alone: no
 * look at the disk. Both are normalised first, so `..`, `.` and doubled or
 * trailing separators say what they mean — `/w/site/../backup` is not in
 * `/w/site` — and a sibling that only shares the start of the name
 * (`/w/site-old`) is not inside. Everything is inside `/`.
 */
export function isWithinText(dir: string, where: string): boolean {
  return within(path.normalize(dir), path.normalize(where));
}

const real = (p: string): string | null => {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
};

/**
 * The same, by the text or by where it really leads, so that a link to a
 * project counts as in the project — as a test to put to many places, which
 * follows `dir` once, the first time the text alone does not answer.
 */
export function insideReal(dir: string): (where: string | null) => boolean {
  let realDir: string | null | undefined;
  return (where) => {
    if (!where) return false;
    if (isWithinText(dir, where)) return true;
    if (realDir === undefined) realDir = real(dir);
    const realWhere = realDir === null ? null : real(where);
    return realWhere !== null && isWithinText(realDir!, realWhere);
  };
}

/** `insideReal` for a single place. */
export const isWithinReal = (dir: string, where: string | null): boolean => insideReal(dir)(where);
