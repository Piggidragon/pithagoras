import { useEffect, useMemo, useRef, useState } from "react";
import { LuCircleAlert, LuMessagesSquare, LuPencil, LuPin, LuPinOff, LuSearch, LuTrash2 } from "react-icons/lu";
import { PageHeader, Stat } from "./PageHeader";
import type { Session } from "../api";
import { when } from "../time";
import { filterSessions } from "../session-filter";
import { confirmDialog } from "./ConfirmDialog";
import { StatusDot } from "./StatusDot";
import { TitleInput } from "./TitleInput";

/**
 * How long a click on a name waits for a second one. The chat opens on a click
 * and this page goes with it, so a double-click to rename would never arrive.
 */
const DOUBLE_CLICK_MS = 300;

/**
 * Every session, not just the dozen the sidebar has room for — with search,
 * since the sidebar list is capped and old sessions otherwise become
 * unreachable once they fall off the end.
 */
export function SessionsPage({
  sessions,
  onSelect,
  onDelete,
  onPin,
  onRename,
}: {
  sessions: Session[];
  onSelect: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
  onPin: (id: string, pinned: boolean) => Promise<void>;
  onRename: (id: string, title: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  /** The session whose name is being edited in place. */
  const [renaming, setRenaming] = useState<string | null>(null);
  /** A new name on its way to the server, shown until the list has it. */
  const [pending, setPending] = useState<{ id: string; title: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The chat a click on its name opens, unless a second click makes it a rename. */
  const opening = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(opening.current), []);
  /**
   * The press that ends a rename, by leaving the field for the rest of its row.
   * The field closes on the press, before the click, so by the click the row
   * no longer looks as if it were being renamed; it is told here instead.
   */
  const endingRename = useRef(false);

  const rename = (s: Session, title: string) => {
    setRenaming(null);
    setPending({ id: s.id, title });
    onRename(s.id, title)
      .catch((e) => setError(`Could not rename "${s.title}": ${(e as Error).message}`))
      .finally(() => setPending((p) => (p?.id === s.id ? null : p)));
  };

  const running = sessions.filter((s) => s.status === "running").length;
  const pinnedCount = sessions.filter((s) => s.pinned).length;

  const matches = useMemo(() => filterSessions(sessions, query), [sessions, query]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto w-full max-w-3xl">
          <PageHeader
            icon={<LuMessagesSquare />}
            title="Sessions"
            description={
              <>
                Every task you have handed to pi. Each one runs on the server, so you can close
                the tab and pick it back up here once it is done.
              </>
            }
          >
            <div className="mt-4 flex flex-wrap gap-2">
              <Stat label="total" value={sessions.length} />
              <Stat label="running" value={running} tone="text-accent" />
              <Stat label="pinned" value={pinnedCount} />
            </div>
          </PageHeader>

          <div className="relative mt-4">
            <LuSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or workspace…"
              className="w-full rounded-lg border border-line bg-raised/60 py-2 pl-9 pr-3 text-sm outline-none placeholder:text-fg-faint focus:border-accent/60"
            />
            {query && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-fg-faint">
                {matches.length} of {sessions.length}
              </span>
            )}
          </div>

          {error && (
            <div role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              <LuCircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1">{error}</span>
              <button onClick={() => setError(null)} aria-label="Dismiss">✕</button>
            </div>
          )}

          {matches.length === 0 ? (
            <p className="py-12 text-center text-sm text-fg-subtle">
              {sessions.length === 0 ? "No sessions yet." : "Nothing matches that."}
            </p>
          ) : (
            <ul className="stagger-in mt-3 space-y-1">
              {matches.map((s) => (
                <li
                  key={s.id}
                  onMouseDown={() => {
                    endingRename.current = renaming === s.id;
                  }}
                  onClick={() => {
                    // A click on a name that is waiting for a second one is overtaken by this one.
                    window.clearTimeout(opening.current);
                    if (endingRename.current || renaming === s.id) {
                      endingRename.current = false;
                      return;
                    }
                    onSelect(s.id);
                  }}
                  className="group flex cursor-pointer items-center gap-3 rounded-xl border border-line bg-raised/40 px-3 py-2.5 transition hover:bg-fg/5"
                >
                  <StatusDot status={s.status} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      {renaming === s.id ? (
                        <TitleInput
                          value={s.title}
                          label="Session name"
                          className="flex-1 text-sm"
                          onCommit={(next) => rename(s, next)}
                          onCancel={() => setRenaming(null)}
                        />
                      ) : (
                        <p
                          className="truncate text-sm text-fg"
                          onClick={(e) => {
                            e.stopPropagation();
                            window.clearTimeout(opening.current);
                            if (e.detail > 1) return;
                            opening.current = window.setTimeout(() => onSelect(s.id), DOUBLE_CLICK_MS);
                          }}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            window.clearTimeout(opening.current);
                            setRenaming(s.id);
                          }}
                        >
                          {pending?.id === s.id ? pending.title : s.title}
                        </p>
                      )}
                      {s.pinned && (
                        <LuPin className="h-3 w-3 shrink-0 text-accent/70" title="Pinned" />
                      )}
                    </div>
                    <p className="truncate font-mono text-[11px] text-fg-faint">{s.workspace}</p>
                  </div>
                  <span className="shrink-0 text-[11px] text-fg-faint">{when(s.updated_at)}</span>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onPin(s.id, !s.pinned);
                      }}
                      className="rounded p-1.5 text-fg-subtle hover:text-accent"
                      title={s.pinned ? "Unpin" : "Pin"}
                    >
                      {s.pinned ? <LuPinOff className="h-3.5 w-3.5" /> : <LuPin className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenaming(s.id);
                      }}
                      className="rounded p-1.5 text-fg-subtle hover:text-accent"
                      title="Rename"
                      aria-label={`Rename ${s.title}`}
                    >
                      <LuPencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (
                          await confirmDialog({
                            title: `Delete "${s.title}"?`,
                            message: "It is stopped if it is running, and its transcript is removed.",
                            confirmLabel: "Delete",
                            danger: true,
                            deletes: true,
                          })
                        ) {
                          onDelete(s.id);
                        }
                      }}
                      className="rounded p-1.5 text-fg-subtle hover:text-danger"
                      title="Delete session"
                    >
                      <LuTrash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
