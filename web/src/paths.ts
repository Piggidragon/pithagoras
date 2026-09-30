/**
 * Where `where` lies in relation to the folder `dir`, by the text of the path:
 * what is under it — "" for the folder itself — or undefined when it is
 * elsewhere. A trailing slash on `dir` does not matter, and `/w/site-old` is
 * not in `/w/site`.
 */
export function below(dir: string, where: string): string | undefined {
  const base = dir.replace(/\/+$/, "");
  if (where === base) return "";
  return where.startsWith(base + "/") ? where.slice(base.length + 1) : undefined;
}

/** `where` is the folder `dir` or inside it, by the text of the path. */
export const within = (dir: string, where: string): boolean => below(dir, where) !== undefined;
