/**
 * The chats gathered by the folder they work in: Home, where "New" starts
 * one, and each project. A chat started in a project's subfolder belongs to
 * the project all the same, as it does on the Projects page. One that is in
 * neither — the workspace root itself, say — goes under "Elsewhere", which is
 * only there while it has any.
 *
 * Home and every project are there even without chats, so that a chat can be
 * started in any of them from the tree.
 */
export type FolderKind = "home" | "project" | "elsewhere";

export type Folder<S> = {
  /** What the folder is remembered by: its order, and whether it is open. */
  key: string;
  kind: FolderKind;
  name: string;
  /** Where a chat started in it works; null for Elsewhere, which is no one place. */
  path: string | null;
  /** Its chats, in the order they were given. */
  sessions: S[];
  /** When one of its chats last moved: "" for none. */
  lastActive: string;
};

export const HOME = "home";
export const ELSEWHERE = "elsewhere";
export const projectKey = (name: string) => `project:${name}`;

/** What the chats are gathered into: where Home is, and the projects. */
export type Places = { home: string; projects: readonly { name: string; path: string }[] };

const within = (dir: string, where: string) => where === dir || where.startsWith(dir.endsWith("/") ? dir : dir + "/");

export function groupByFolder<S extends { workspace: string; updated_at: string }>(sessions: readonly S[], places: Places): Folder<S>[] {
  const home: Folder<S> = { key: HOME, kind: "home", name: "Home", path: places.home, sessions: [], lastActive: "" };
  const elsewhere: Folder<S> = { key: ELSEWHERE, kind: "elsewhere", name: "Elsewhere", path: null, sessions: [], lastActive: "" };
  const projects = places.projects.map<Folder<S>>((p) => ({
    key: projectKey(p.name),
    kind: "project",
    name: p.name,
    path: p.path,
    sessions: [],
    lastActive: "",
  }));
  // The deepest that holds it, should one project ever be inside another.
  const deepest = [...projects].sort((a, b) => b.path!.length - a.path!.length);
  for (const s of sessions) {
    // A server that did not say where Home is: nothing is taken for it.
    const folder = places.home && within(places.home, s.workspace) ? home : (deepest.find((p) => within(p.path!, s.workspace)) ?? elsewhere);
    folder.sessions.push(s);
    if (s.updated_at > folder.lastActive) folder.lastActive = s.updated_at;
  }
  return [home, ...projects, ...(elsewhere.sessions.length ? [elsewhere] : [])];
}

/** How the folders are ordered: by their latest chat, by name, or as they were put. */
export type FolderSort = "recent" | "name" | "manual";

export const FOLDER_SORTS: FolderSort[] = ["recent", "name", "manual"];

/**
 * The folders in `sort`'s order. By name, Home comes first, as the place
 * chats start. As they were put (`order`, by key), a folder never put
 * anywhere — a project made since — comes after the rest, the latest first.
 * Elsewhere is last unless it was put somewhere.
 */
export function sortFolders<S>(folders: readonly Folder<S>[], sort: FolderSort, order: readonly string[] = []): Folder<S>[] {
  const rank = (f: Folder<S>) => (f.kind === "home" ? 0 : f.kind === "project" ? 1 : 2);
  const byName = (a: Folder<S>, b: Folder<S>) => rank(a) - rank(b) || a.name.localeCompare(b.name);
  const byRecent = (a: Folder<S>, b: Folder<S>) =>
    Number(a.kind === "elsewhere") - Number(b.kind === "elsewhere") || (b.lastActive > a.lastActive ? 1 : b.lastActive < a.lastActive ? -1 : 0) || byName(a, b);
  if (sort === "name") return [...folders].sort(byName);
  if (sort === "recent") return [...folders].sort(byRecent);
  const at = (f: Folder<S>) => {
    const i = order.indexOf(f.key);
    return i < 0 ? Infinity : i;
  };
  return [...folders].sort((a, b) => at(a) - at(b) || byRecent(a, b));
}

/**
 * The order kept once `key` is put at `to` among the folders as they are
 * shown (`shown`, by key): the order they were shown in, since that is what
 * was moved from, whatever they were sorted by. Keys of folders that are
 * not shown now — a search hides some — keep their places after them.
 */
export function moveFolder(shown: readonly string[], key: string, to: number, kept: readonly string[] = []): string[] {
  const rest = shown.filter((k) => k !== key);
  const at = Math.max(0, Math.min(rest.length, to));
  const next = [...rest.slice(0, at), key, ...rest.slice(at)];
  return [...next, ...kept.filter((k) => !next.includes(k))];
}

/** An order read back from storage: the keys in it, once each. */
export function readFolderOrder(raw: string | null | undefined): string[] {
  try {
    const stored = JSON.parse(raw ?? "") as unknown;
    return Array.isArray(stored) ? [...new Set(stored.filter((k): k is string => typeof k === "string"))] : [];
  } catch {
    return [];
  }
}

export const readFolderSort = (raw: string | null | undefined): FolderSort =>
  FOLDER_SORTS.includes(raw as FolderSort) ? (raw as FolderSort) : "recent";

/** Which folders were opened or shut by hand, by key: the rest are as the place shows them first. */
export function readOpenFolders(raw: string | null | undefined): Record<string, boolean> {
  try {
    const stored = JSON.parse(raw ?? "") as unknown;
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
    return Object.fromEntries(Object.entries(stored).filter(([, open]) => typeof open === "boolean")) as Record<string, boolean>;
  } catch {
    return {};
  }
}

/** The folder a link names (`?folder=` and its key), when it is one of `folders`. */
export const folderFrom = <S>(folders: readonly Folder<S>[], key: string | null) => (key ? (folders.find((f) => f.key === key) ?? null) : null);
