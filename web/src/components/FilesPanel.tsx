import { useCallback, useEffect, useRef, useState } from "react";
import {
  LuArrowLeft,
  LuChevronRight,
  LuCircleAlert,
  LuDownload,
  LuEye,
  LuEyeOff,
  LuFileText,
  LuFolder,
  LuLink,
  LuLocateFixed,
  LuPencil,
  LuRefreshCw,
  LuSave,
  LuTrash2,
} from "react-icons/lu";
import { api, type FileEntry } from "../api";
import type { FileActivity } from "../file-activity";
import { confirmDialog } from "./ConfirmDialog";

/** What the server says when a save would put older text over newer. */
const CHANGED = "The file changed after you opened it";

interface Open {
  path: string;
  loading: boolean;
  error?: string;
  binary: boolean;
  size: number;
  /** The file's modification time when it was read: what a save is checked against. */
  mtime: number;
  saved: string;
}

const sizeOf = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const HIDDEN_KEY = "filesShowHidden";
/** Whether names that start with a dot are shown. Off unless it was turned on: they are mostly settings and tools' own folders. */
const savedShowHidden = (): boolean => {
  try {
    return localStorage.getItem(HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
};

const parentOf = (p: string) => p.split("/").slice(0, -1).join("/");
const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

/**
 * The files in the folder a chat works in: look through them, read and change
 * one, take one or the whole folder away.
 *
 * It follows the agent. When the agent reads a file or changes one, it is shown
 * here, which is what lets you watch what it is doing. Opening something
 * yourself takes over from that, and one button hands it back.
 *
 * Only what the agent does after the panel opens is followed, so opening it does
 * not jump to a file from earlier. `since` moves that line, for a panel that
 * opens because of what the agent just did and should show it.
 */
export function FilesPanel({
  sessionId,
  folder,
  activity,
  since,
  onDirtyChange,
}: {
  sessionId: string;
  folder: string;
  activity: FileActivity | null;
  since?: number;
  /** Told whether there are changes not saved, so that whoever can close the panel can ask first. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [dir, setDir] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [listing, setListing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [file, setFile] = useState<Open | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);
  const [following, setFollowing] = useState(true);
  const [showHidden, setShowHidden] = useState(savedShowHidden);
  // The entry being given a name, and the name so far.
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  const dirty = !!file && !file.binary && !file.loading && draft !== file.saved;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  // Answers that arrive after a newer question was asked are not the answer.
  const listAsk = useRef(0);
  const fileAsk = useRef(0);
  const handled = useRef(since ?? activity?.seq ?? 0);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  // Gone, so nothing is left to ask about.
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  // Reloading or closing the tab is a way out too.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const root = folder.split("/").filter(Boolean).pop() || "folder";

  const loadDir = useCallback(
    (path: string) => {
      const ask = ++listAsk.current;
      setListing(true);
      return api
        .listFiles(sessionId, path)
        .then((r) => {
          if (ask !== listAsk.current) return;
          setEntries(r.entries);
          setTruncated(r.truncated);
          setListError(null);
        })
        .catch((e) => {
          if (ask !== listAsk.current) return;
          setEntries([]);
          setListError((e as Error).message);
        })
        .finally(() => {
          if (ask === listAsk.current) setListing(false);
        });
    },
    [sessionId],
  );

  useEffect(() => {
    void loadDir(dir);
  }, [loadDir, dir]);

  const loadFile = useCallback(
    (path: string) => {
      const ask = ++fileAsk.current;
      setChanged(false);
      setFile({ path, loading: true, binary: false, size: 0, mtime: 0, saved: "" });
      setDraft("");
      return api
        .readFile(sessionId, path)
        .then((r) => {
          if (ask !== fileAsk.current) return;
          const text = r.binary ? "" : r.content;
          setFile({ path, loading: false, binary: r.binary, size: r.size, mtime: r.mtime, saved: text });
          setDraft(text);
        })
        .catch((e) => {
          if (ask !== fileAsk.current) return;
          setFile({ path, loading: false, error: (e as Error).message, binary: false, size: 0, mtime: 0, saved: "" });
        });
    },
    [sessionId],
  );

  /** True to go on: nothing is lost, or the person said it may be. */
  const mayLeave = async () =>
    !dirtyRef.current ||
    confirmDialog({ title: "Discard your changes?", message: "The file has changes that are not saved.", confirmLabel: "Discard", danger: true });

  // The agent read or changed a file: show it, unless somebody is in the middle of editing.
  useEffect(() => {
    if (!activity || activity.seq <= handled.current) return;
    handled.current = activity.seq;
    // What the agent did may have added to a folder, wherever the panel is looking.
    void loadDir(dir);
    if (!following) return;
    if (dirtyRef.current) return;
    setDir(parentOf(activity.path));
    void loadFile(activity.path);
    // Only a new activity should do this, not a change of folder.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity?.seq]);

  const goTo = async (path: string) => {
    if (!(await mayLeave())) return;
    setFollowing(false);
    fileAsk.current++;
    setFile(null);
    setDir(path);
  };

  const openEntry = async (entry: FileEntry) => {
    if (entry.type === "link") return;
    if (!(await mayLeave())) return;
    setFollowing(false);
    if (entry.type === "dir") {
      fileAsk.current++;
      setFile(null);
      setDir(join(dir, entry.name));
    } else {
      void loadFile(join(dir, entry.name));
    }
  };

  const closeFile = async () => {
    if (!(await mayLeave())) return;
    fileAsk.current++;
    setFile(null);
  };

  const follow = () => {
    setFollowing(true);
    if (activity && !dirtyRef.current) {
      handled.current = activity.seq;
      setDir(parentOf(activity.path));
      void loadFile(activity.path);
    }
  };

  const save = async (overwrite = false) => {
    if (!file || file.binary || saving) return;
    setSaving(true);
    try {
      const r = await api.saveFile(sessionId, file.path, draft, overwrite ? undefined : file.mtime);
      setFile({ ...file, saved: draft, mtime: r.mtime, size: r.size, error: undefined });
      setChanged(false);
    } catch (e) {
      const message = (e as Error).message;
      if (message === CHANGED) setChanged(true);
      else setFile({ ...file, error: message });
    } finally {
      setSaving(false);
    }
  };

  const toggleHidden = () => {
    const next = !showHidden;
    setShowHidden(next);
    try {
      localStorage.setItem(HIDDEN_KEY, next ? "1" : "0");
    } catch {
      // Not remembered, but it works for now.
    }
  };

  const startRename = (entry: FileEntry) => {
    setRenaming(entry.name);
    setNewName(entry.name);
  };

  const finishRename = async (entry: FileEntry) => {
    const name = newName.trim();
    setRenaming(null);
    if (!name || name === entry.name) return;
    let problem: string | null = null;
    try {
      await api.renameFile(sessionId, join(dir, entry.name), name);
    } catch (e) {
      problem = (e as Error).message;
    }
    // After the reload, which clears an error: this one is about what was just tried.
    await loadDir(dir);
    if (problem) setListError(problem);
  };

  const remove = async (entry: FileEntry) => {
    const path = join(dir, entry.name);
    // A link to a folder is listed as a folder, but only the link goes.
    const message = entry.link
      ? "This removes the link only. What it points to is not touched."
      : `This removes the ${entry.type === "dir" ? "folder and everything in it" : "file"}. It cannot be undone.`;
    const ok = await confirmDialog({
      title: `Delete "${entry.name}"?`,
      message,
      confirmLabel: "Delete",
      danger: true,
      deletes: true,
    });
    if (!ok) return;
    let problem: string | null = null;
    try {
      await api.deleteFile(sessionId, path);
      if (file && (file.path === path || file.path.startsWith(path + "/"))) {
        fileAsk.current++;
        setFile(null);
      }
    } catch (e) {
      problem = (e as Error).message;
    }
    await loadDir(dir);
    if (problem) setListError(problem);
  };

  const crumbs = dir ? dir.split("/") : [];
  const shown = showHidden ? entries : entries.filter((e) => !e.name.startsWith("."));

  return (
    <div className="flex h-full min-h-0 flex-col text-sm">
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-3 py-1.5 text-xs text-fg-subtle">
        <nav aria-label="Folder" className="flex min-w-0 flex-1 flex-wrap items-center gap-x-0.5">
          <button onClick={() => void goTo("")} className="rounded px-1 py-0.5 hover:bg-fg/5 hover:text-fg" title={folder}>
            {root}
          </button>
          {crumbs.map((name, i) => (
            <span key={i} className="flex items-center gap-0.5">
              <LuChevronRight aria-hidden className="h-3 w-3 shrink-0 text-fg-faint" />
              <button onClick={() => void goTo(crumbs.slice(0, i + 1).join("/"))} className="rounded px-1 py-0.5 hover:bg-fg/5 hover:text-fg">
                {name}
              </button>
            </span>
          ))}
        </nav>
        <button
          onClick={follow}
          disabled={following}
          aria-pressed={following}
          title={following ? "Showing what the agent reads and changes" : "Show what the agent reads and changes"}
          className={`flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 transition ${
            following ? "text-accent" : "text-fg-faint hover:bg-fg/5 hover:text-fg"
          }`}
        >
          <LuLocateFixed aria-hidden className="h-3.5 w-3.5" />
          <span>{following ? "Following" : "Follow"}</span>
        </button>
        <button
          onClick={toggleHidden}
          aria-pressed={showHidden}
          title={showHidden ? "Hide names that start with a dot" : "Show names that start with a dot"}
          aria-label={showHidden ? "Hide hidden files" : "Show hidden files"}
          className={`shrink-0 rounded p-1 transition hover:bg-fg/5 hover:text-fg ${showHidden ? "text-accent" : "text-fg-faint"}`}
        >
          {showHidden ? <LuEye aria-hidden className="h-3.5 w-3.5" /> : <LuEyeOff aria-hidden className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={() => void loadDir(dir)}
          title="Refresh"
          aria-label="Refresh"
          className="shrink-0 rounded p-1 text-fg-faint transition hover:bg-fg/5 hover:text-fg"
        >
          <LuRefreshCw aria-hidden className={`h-3.5 w-3.5 ${listing ? "animate-spin" : ""}`} />
        </button>
        <a
          href={api.archiveDownloadUrl(sessionId, dir)}
          title={dir ? "Download this folder as a .tar.gz" : "Download the whole folder as a .tar.gz"}
          aria-label="Download this folder"
          className="shrink-0 rounded p-1 text-fg-faint transition hover:bg-fg/5 hover:text-fg"
        >
          <LuDownload aria-hidden className="h-3.5 w-3.5" />
        </a>
      </div>

      {file ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
            <button onClick={() => void closeFile()} title="Back to the folder" aria-label="Back to the folder" className="shrink-0 rounded p-1 text-fg-faint transition hover:bg-fg/5 hover:text-fg">
              <LuArrowLeft aria-hidden className="h-3.5 w-3.5" />
            </button>
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg" title={file.path}>
              {file.path}
              {dirty && (
                <span className="ml-1 text-accent" title="Not saved">
                  •
                </span>
              )}
            </span>
            {!file.loading && !file.error && (
              <span className="shrink-0 text-[10px] text-fg-faint">{sizeOf(file.size)}</span>
            )}
            <a href={api.fileDownloadUrl(sessionId, file.path)} title="Download this file" aria-label="Download this file" className="shrink-0 rounded p-1 text-fg-faint transition hover:bg-fg/5 hover:text-fg">
              <LuDownload aria-hidden className="h-3.5 w-3.5" />
            </a>
            {!file.binary && !file.loading && !file.error && (
              <button
                onClick={() => void save()}
                disabled={!dirty || saving}
                className="flex shrink-0 items-center gap-1 rounded-md bg-accent/12 px-2 py-1 text-xs text-accent ring-1 ring-inset ring-accent/25 transition hover:bg-accent/20 disabled:opacity-40"
              >
                <LuSave aria-hidden className="h-3.5 w-3.5" />
                {saving ? "Saving…" : "Save"}
              </button>
            )}
          </div>
          {changed && (
            <div role="alert" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-warn/10 px-3 py-1.5 text-xs text-warn">
              <span className="min-w-0 flex-1">This file changed after you opened it.</span>
              <button onClick={() => void loadFile(file.path)} className="rounded px-1.5 py-0.5 underline hover:text-fg">
                Load the new version
              </button>
              <button onClick={() => void save(true)} className="rounded px-1.5 py-0.5 underline hover:text-fg">
                Save mine anyway
              </button>
            </div>
          )}
          {file.error ? (
            <p role="alert" className="m-3 flex items-start gap-1.5 rounded-lg border border-danger/25 bg-danger/10 px-2 py-2 text-xs text-danger">
              <LuCircleAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {file.error}
            </p>
          ) : file.loading ? (
            <p className="px-3 py-3 text-xs text-fg-subtle">Loading…</p>
          ) : file.binary ? (
            <p className="p-6 text-center text-xs text-fg-subtle">Not text, or too large to show. Download it to open it.</p>
          ) : (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
                  e.preventDefault();
                  void save();
                }
              }}
              spellCheck={false}
              aria-label={`Contents of ${file.path}`}
              className="min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-xs leading-relaxed text-fg outline-none"
            />
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {listError && (
            <p role="alert" className="flex items-start gap-1.5 rounded-lg border border-danger/25 bg-danger/10 px-2 py-2 text-xs text-danger">
              <LuCircleAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {listError}
            </p>
          )}
          {!listError && !listing && shown.length === 0 && (
            <p className="px-2 py-3 text-xs text-fg-subtle">{entries.length === 0 ? "Nothing in this folder." : "Nothing here but hidden files."}</p>
          )}
          {shown.map((entry) => (
            <div key={entry.name} className="group flex items-center rounded-lg px-1 transition hover:bg-fg/5 focus-within:bg-fg/5">
              {renaming === entry.name ? (
                <div className="flex min-w-0 flex-1 items-center gap-2 px-1 py-1">
                  {entry.type === "dir" ? (
                    <LuFolder aria-hidden className="h-4 w-4 shrink-0 text-fg-faint" />
                  ) : entry.type === "link" ? (
                    <LuLink aria-hidden className="h-4 w-4 shrink-0" />
                  ) : (
                    <LuFileText aria-hidden className="h-4 w-4 shrink-0 text-fg-faint" />
                  )}
                  <input
                    autoFocus
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onFocus={(e) => {
                      // The name without its extension is what is usually meant to change.
                      const dot = entry.type === "file" ? e.target.value.lastIndexOf(".") : -1;
                      e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void finishRename(entry);
                      else if (e.key === "Escape") setRenaming(null);
                    }}
                    onBlur={() => setRenaming(null)}
                    aria-label={`New name for ${entry.name}`}
                    spellCheck={false}
                    className="min-w-0 flex-1 rounded border border-accent/40 bg-transparent px-1.5 py-0.5 text-sm text-fg outline-none"
                  />
                </div>
              ) : (
                <>
                  <button
                    onClick={() => void openEntry(entry)}
                    disabled={entry.type === "link"}
                    title={entry.type === "link" ? "A link that leads out of this folder, or nowhere" : entry.name}
                    className="flex min-w-0 flex-1 items-center gap-2 px-1 py-1.5 text-left text-fg disabled:cursor-default disabled:text-fg-faint"
                  >
                    {entry.type === "dir" ? (
                      <LuFolder aria-hidden className="h-4 w-4 shrink-0 text-fg-faint" />
                    ) : entry.type === "link" ? (
                      <LuLink aria-hidden className="h-4 w-4 shrink-0" />
                    ) : (
                      <LuFileText aria-hidden className="h-4 w-4 shrink-0 text-fg-faint" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                    {entry.link && entry.type !== "link" && <LuLink aria-label="A link" className="h-3 w-3 shrink-0 text-fg-faint" />}
                    {entry.type === "file" && <span className="shrink-0 text-[10px] text-fg-faint">{sizeOf(entry.size)}</span>}
                  </button>
                  {/* Out of the way until the row is pointed at, but always there on a touch screen, which cannot point. */}
                  <div className="flex shrink-0 items-center opacity-0 transition focus-within:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100">
                    {entry.type !== "link" && (
                      <a
                        href={entry.type === "dir" ? api.archiveDownloadUrl(sessionId, join(dir, entry.name)) : api.fileDownloadUrl(sessionId, join(dir, entry.name))}
                        title={entry.type === "dir" ? `Download ${entry.name} as a .tar.gz` : `Download ${entry.name}`}
                        aria-label={`Download ${entry.name}`}
                        className="rounded p-1 text-fg-faint transition hover:bg-fg/10 hover:text-fg"
                      >
                        <LuDownload aria-hidden className="h-3.5 w-3.5" />
                      </a>
                    )}
                    <button
                      onClick={() => startRename(entry)}
                      title={`Rename ${entry.name}`}
                      aria-label={`Rename ${entry.name}`}
                      className="rounded p-1 text-fg-faint transition hover:bg-fg/10 hover:text-fg"
                    >
                      <LuPencil aria-hidden className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => void remove(entry)}
                      title={`Delete ${entry.name}`}
                      aria-label={`Delete ${entry.name}`}
                      className="rounded p-1 text-fg-faint transition hover:bg-danger/10 hover:text-danger"
                    >
                      <LuTrash2 aria-hidden className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
          {!showHidden && entries.length > shown.length && (
            <button onClick={toggleHidden} className="px-2 py-2 text-left text-xs text-fg-subtle underline-offset-2 hover:text-fg hover:underline">
              {entries.length - shown.length} hidden {entries.length - shown.length === 1 ? "file" : "files"} — show
            </button>
          )}
          {truncated && <p className="px-2 py-2 text-xs text-fg-subtle">This folder has more than is listed here.</p>}
        </div>
      )}
    </div>
  );
}
