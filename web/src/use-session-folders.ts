import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "./api";
import { local } from "./safe-storage";
import { moveFolder, readFolderOrder, readFolderSort, readOpenFolders, type FolderSort, type Places } from "./session-folders";

/**
 * How the chats are listed — gathered by folder, or as one list with the
 * pinned ones first — and how the folders are ordered. The same for the
 * sidebar and the Sessions page, which are both on screen at once: a folder
 * moved in one is moved in the other. Kept per browser, like the panels'
 * places: it is a preference, not something about the chats.
 */
export type Grouping = "folders" | "list";

type Prefs = { grouping: Grouping; sort: FolderSort; order: string[] };

const read = (): Prefs => ({
  grouping: local.get("sessionGrouping") === "list" ? "list" : "folders",
  sort: readFolderSort(local.get("folderSort")),
  order: readFolderOrder(local.get("folderOrder")),
});

let prefs = read();
const listeners = new Set<() => void>();

function change(next: Partial<Prefs>) {
  prefs = { ...prefs, ...next };
  if (next.grouping) local.set("sessionGrouping", next.grouping);
  if (next.sort) local.set("folderSort", next.sort);
  if (next.order) local.set("folderOrder", JSON.stringify(next.order));
  for (const heard of listeners) heard();
}

const subscribe = (heard: () => void) => {
  listeners.add(heard);
  return () => listeners.delete(heard);
};

export function useFolderPrefs() {
  const now = useSyncExternalStore(subscribe, () => prefs);
  return {
    ...now,
    setGrouping: (grouping: Grouping) => change({ grouping }),
    setSort: (sort: FolderSort) => change({ sort }),
    /**
     * Puts `key` at `to` among the folders `shown`, and orders them so from
     * now on: moving one is choosing the order by hand.
     */
    move: (shown: readonly string[], key: string, to: number) =>
      change({ sort: "manual", order: moveFolder(shown, key, to, prefs.order) }),
  };
}

/**
 * Which folders are open in one place (`key` in storage). Those never opened
 * or shut by hand are as `byDefault` says: the sidebar has room for one or
 * two, the Sessions page for all of them.
 *
 * While `searching`, every folder with a match is open, and one shut then is
 * shut only until the search ends: what is kept is how the folders were left
 * without one, which a click on a folder the search had opened would
 * otherwise change unseen.
 */
export function useOpenFolders(key: string, byDefault: (folder: string) => boolean, searching = false) {
  const [chosen, setChosen] = useState(() => readOpenFolders(local.get(key)));
  const [shutWhileSearching, setShut] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    if (!searching) setShut((prev) => (prev.size ? new Set() : prev));
  }, [searching]);
  const kept = (folder: string) => chosen[folder] ?? byDefault(folder);
  const isOpen = (folder: string) => (searching ? !shutWhileSearching.has(folder) : kept(folder));
  const set = (folder: string, open: boolean) =>
    setChosen((prev) => {
      if (prev[folder] === open) return prev;
      const next = { ...prev, [folder]: open };
      local.set(key, JSON.stringify(next));
      return next;
    });
  const toggle = (folder: string) => {
    if (!searching) return set(folder, !kept(folder));
    setShut((prev) => {
      const next = new Set(prev);
      if (!next.delete(folder)) next.add(folder);
      return next;
    });
  };
  return { isOpen, set, toggle };
}

/** Places as they were last known, so that the chats are gathered from the start rather than once they are asked for. */
function knownPlaces(): Places | undefined {
  try {
    const p = JSON.parse(local.get("knownPlaces") ?? "") as Places;
    return typeof p?.home === "string" && Array.isArray(p.projects) ? p : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Where Home is and what projects there are, for gathering the chats:
 * undefined until they are known, null if they could not be. What was known
 * last time is used until they are asked. Asked again whenever which chats
 * there are, or where, changes — a project is mostly made with its first
 * chat — and when `reload` is called; only the latest answer is taken, since
 * an earlier one can arrive after it and be from before a project was made.
 */
export function usePlaces(sessions: readonly { id: string; workspace: string }[]) {
  const [places, setPlaces] = useState<Places | null | undefined>(knownPlaces);
  const asked = useRef(0);
  const load = useCallback(() => {
    const n = ++asked.current;
    api.projects().then(
      (r) => {
        if (n !== asked.current) return;
        // Read as little as it says: an older server does not say where Home is.
        const now: Places = {
          home: typeof r.home === "string" ? r.home : "",
          projects: (Array.isArray(r.projects) ? r.projects : []).map((p) => ({ name: p.name, path: p.path })),
        };
        local.set("knownPlaces", JSON.stringify(now));
        setPlaces(now);
      },
      // What was known stays: a list that failed to load once has not changed.
      () => n === asked.current && setPlaces((known) => known ?? null),
    );
  }, []);
  const chats = sessions.map((s) => `${s.id}:${s.workspace}`).join("|");
  useEffect(load, [load, chats]);
  return { places, reload: load };
}
