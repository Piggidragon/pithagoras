import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { LuChevronRight, LuFolder, LuFolderOpen, LuFolderSearch, LuFolderTree, LuGripVertical, LuHouse, LuList, LuPlus } from "react-icons/lu";
import type { SessionStatus } from "../api";
import { followPointer } from "../pointer-drag";
import type { Folder, FolderSort } from "../session-folders";
import type { Grouping } from "../use-session-folders";
import { Select } from "./Select";
import { StatusDot } from "./StatusDot";

/** How far a grip is pulled before it is a drag rather than a press. */
const DRAG_SLOP = 4;

/**
 * Home and the projects, each a folder that opens to show its chats — in the
 * sidebar, and on the Sessions page. A folder is moved by its grip, or with
 * Alt and the arrow keys on its name; either puts the folders in an order of
 * your own (see useFolderPrefs).
 */
export function FolderTree<S extends { status: SessionStatus }>({
  folders,
  isOpen,
  onToggle,
  onMove,
  onNewChat,
  children,
  size = "sm",
  extra,
}: {
  folders: readonly Folder<S>[];
  isOpen: (key: string) => boolean;
  onToggle: (key: string) => void;
  /** `key` put at `to` among the others, `shown` being the folders as they are listed. */
  onMove?: (shown: string[], key: string, to: number) => void;
  /** Starts a chat in the folder: not offered for Elsewhere, which is no one place. */
  onNewChat?: (folder: Folder<S>) => void;
  /** What an open folder shows: its chats. */
  children: (folder: Folder<S>) => ReactNode;
  size?: "sm" | "md";
  /** More to put on a folder's line, after its count. */
  extra?: (folder: Folder<S>) => ReactNode;
}) {
  const id = useId();
  const heads = useRef(new Map<string, HTMLElement>());
  const toggles = useRef(new Map<string, HTMLButtonElement>());
  /**
   * The folder being carried, the order the folders were in when it was
   * picked up, and where among the others it would go once it has moved
   * (`to`, null before). They are drawn in that order until it is let go:
   * one that changed meanwhile — a chat moving under "Latest first" — would
   * have the line mark one place and the drop go to another.
   */
  const [drag, setDrag] = useState<{ key: string; keys: string[]; to: number | null } | null>(null);
  const listed = drag
    ? [
        ...drag.keys.flatMap((k) => folders.filter((f) => f.key === k)),
        ...folders.filter((f) => !drag.keys.includes(f.key)),
      ]
    : folders;
  const keys = listed.map((f) => f.key);
  /** The folders there are now, for a drop: one that went while it was carried is not put back. */
  const present = useRef(keys);
  present.current = folders.map((f) => f.key);
  /** A folder moved with the keys, whose name is to keep the focus once it is drawn where it went. */
  const refocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!refocus.current) return;
    const button = toggles.current.get(refocus.current);
    refocus.current = null;
    if (button && document.activeElement !== button) button.focus();
  });

  const carry = (folder: Folder<S>, e: PointerEvent<HTMLElement>) => {
    if (!onMove || e.button !== 0) return;
    e.preventDefault();
    const picked = keys;
    const others = picked.filter((k) => k !== folder.key);
    // Among the others, how many have their line's middle above the pointer.
    const at = (y: number) =>
      others.filter((k) => {
        const r = heads.current.get(k)?.getBoundingClientRect();
        return r !== undefined && r.top + r.height / 2 < y;
      }).length;
    const from = e.clientY;
    let to = picked.indexOf(folder.key);
    let moved = false;
    setDrag({ key: folder.key, keys: picked, to: null });
    followPointer(
      e,
      (ev) => {
        if (!moved && Math.abs(ev.clientY - from) < DRAG_SLOP) return;
        moved = true;
        to = at(ev.clientY);
        setDrag({ key: folder.key, keys: picked, to });
      },
      (cancelled) => {
        setDrag(null);
        if (moved && !cancelled && present.current.includes(folder.key)) {
          onMove(picked.filter((k) => present.current.includes(k)), folder.key, to);
        }
      },
    );
  };

  const nudge = (folder: Folder<S>, e: KeyboardEvent) => {
    if (!onMove || !e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    const i = keys.indexOf(folder.key);
    const to = e.key === "ArrowUp" ? i - 1 : i + 1;
    if (to < 0 || to >= keys.length) return;
    refocus.current = folder.key;
    onMove(keys, folder.key, to);
  };

  const md = size === "md";
  const mark = <div aria-hidden className="folder-drop mx-2 h-0.5 rounded-full bg-accent" />;
  let other = 0;

  return (
    <div className={md ? "space-y-1" : undefined}>
      {listed.map((f, i) => {
        const open = isOpen(f.key);
        // Not by its key, which is a folder's name, and a name can have a space: aria-controls is a list of ids.
        const body = `${id}-${i}`;
        const carried = drag?.key === f.key && drag.to !== null;
        // Where the line shows: before the folder that would come after the one carried.
        const before = drag && !carried && drag.to === other;
        if (!carried) other++;
        const running = !open && f.sessions.some((s) => s.status === "running");
        const Icon = f.kind === "home" ? LuHouse : f.kind === "elsewhere" ? LuFolderSearch : open ? LuFolderOpen : LuFolder;
        return (
          <div key={f.key} data-folder={f.key} className={carried ? "opacity-50" : undefined}>
            {before && mark}
            <div
              ref={(el) => {
                if (el) heads.current.set(f.key, el);
                else heads.current.delete(f.key);
              }}
              className={`group/folder flex items-center gap-1 rounded-lg ${md ? "px-2 py-1.5" : "px-1 py-0.5"} hover:bg-fg/5`}
            >
              {onMove && (
                <span
                  aria-hidden
                  title="Drag to move"
                  onPointerDown={(e) => carry(f, e)}
                  className="folder-grip -ml-0.5 cursor-grab touch-none rounded p-0.5 text-fg-faint opacity-0 transition-opacity hover:text-fg-muted active:cursor-grabbing group-hover/folder:opacity-100 group-focus-within/folder:opacity-100 [@media(hover:none)]:opacity-100"
                >
                  <LuGripVertical className="h-3 w-3" />
                </span>
              )}
              <button
                type="button"
                ref={(el) => {
                  if (el) toggles.current.set(f.key, el);
                  else toggles.current.delete(f.key);
                }}
                aria-expanded={open}
                aria-controls={open ? body : undefined}
                aria-keyshortcuts={onMove ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
                onClick={() => onToggle(f.key)}
                onKeyDown={(e) => nudge(f, e)}
                className={`flex min-w-0 flex-1 items-center gap-1.5 text-left ${md ? "text-sm" : "text-[13px]"} text-fg-muted hover:text-fg`}
              >
                <LuChevronRight aria-hidden className={`h-3 w-3 shrink-0 text-fg-faint transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`} />
                <Icon aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-faint" />
                <span className="truncate font-medium">{f.name}</span>
              </button>
              {running && <StatusDot status="running" bare />}
              <span className="shrink-0 px-1 text-[11px] tabular-nums text-fg-faint" aria-label={`${f.sessions.length} chat${f.sessions.length === 1 ? "" : "s"}`}>
                {f.sessions.length}
              </span>
              {extra?.(f)}
              {onNewChat && f.path !== null && (
                <button
                  type="button"
                  onClick={() => onNewChat(f)}
                  aria-label={`New chat in ${f.name}`}
                  title={`New chat in ${f.name}`}
                  className="shrink-0 rounded p-1 text-fg-subtle opacity-0 transition-opacity hover:text-accent focus-visible:opacity-100 group-hover/folder:opacity-100 [@media(hover:none)]:opacity-100"
                >
                  <LuPlus className="h-3 w-3" />
                </button>
              )}
            </div>
            {open && (
              <div id={body} role="group" aria-label={f.name} className={md ? "mt-1 space-y-1 pl-4" : "pl-3"}>
                {children(f)}
              </div>
            )}
          </div>
        );
      })}
      {drag && drag.to !== null && drag.to === other && mark}
    </div>
  );
}

const SORTS: { value: FolderSort; label: string }[] = [
  { value: "recent", label: "Latest first" },
  { value: "name", label: "By name" },
  { value: "manual", label: "Your order" },
];

/** How the chats are listed: by folder or as one list, and the folders in which order. */
export function FolderControls({
  grouping,
  sort,
  onGrouping,
  onSort,
}: {
  grouping: Grouping;
  sort: FolderSort;
  onGrouping: (grouping: Grouping) => void;
  onSort: (sort: FolderSort) => void;
}) {
  const byFolder = grouping === "folders";
  return (
    <>
      {byFolder && (
        <Select
          size="sm"
          aria-label="Order of the folders"
          value={sort}
          onChange={onSort}
          options={SORTS}
          className="folder-sort !gap-1 !border-transparent !bg-transparent !py-0.5 !pl-1.5 !pr-1 !text-[11px] text-fg-subtle"
        />
      )}
      <button
        type="button"
        onClick={() => onGrouping(byFolder ? "list" : "folders")}
        aria-label={byFolder ? "List the chats together" : "Group the chats by folder"}
        title={byFolder ? "List the chats together" : "Group the chats by folder"}
        className="shrink-0 rounded p-1 text-fg-faint hover:bg-fg/5 hover:text-fg-muted"
      >
        {byFolder ? <LuList className="h-3.5 w-3.5" /> : <LuFolderTree className="h-3.5 w-3.5" />}
      </button>
    </>
  );
}
