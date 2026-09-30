/**
 * Whether a path is a folder or lies inside it, by its text — for the portal
 * and the web app alike, which imports this module, so that the two cannot
 * drift apart as the hand-written copies did. Paths are POSIX, as everywhere
 * the portal runs. Nothing is cleaned up here: the server's `isWithinText`
 * normalises first, and the web's paths arrive in the form the server gave.
 */

/**
 * What of `where` is under the folder `dir` — "" for the folder itself — or
 * undefined when it is elsewhere. Trailing slashes on `dir` do not matter, and
 * `/w/site-old` is not in `/w/site`. `dir` "" is the top of a relative tree,
 * which holds every relative path.
 */
export function below(dir: string, where: string): string | undefined {
  if (dir === "") return where.startsWith("/") ? undefined : where;
  const base = dir.replace(/\/+$/, "");
  if (where === base) return "";
  return where.startsWith(base + "/") ? where.slice(base.length + 1) : undefined;
}

/** `where` is the folder `dir` or inside it, by the text of the path. */
export const within = (dir: string, where: string): boolean => below(dir, where) !== undefined;
