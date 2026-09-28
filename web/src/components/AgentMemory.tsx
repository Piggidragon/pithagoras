import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Streamdown } from "streamdown";
import {
  LuChevronDown,
  LuChevronLeft,
  LuChevronRight,
  LuExternalLink,
  LuFileText,
  LuFolder,
  LuHistory,
  LuRefreshCw,
  LuSearch,
  LuX,
} from "react-icons/lu";
import { api, type MemoryChange, type MemoryConcept, type MemoryHit, type MemoryNode } from "../api";
import { inputCls } from "./SettingsUi";

/**
 * The agent's memory in Understory, to read: its folders and notes, a
 * search, and what changed lately. Nothing here writes — the agent keeps its
 * memory, through its tools. Asked through the portal (see
 * server/src/api/memory.ts), so it works wherever the portal does.
 *
 * `note` is the open note's path, kept by the caller in the address so a
 * note can be linked to and the back button closes it.
 */
export function AgentMemory({ note, onNote }: { note: string | null; onNote: (path: string | null) => void }) {
  const [tree, setTree] = useState<MemoryNode | null>(null);
  const [log, setLog] = useState<MemoryChange[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [origin, setOrigin] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [asked, setAsked] = useState("");
  const [hits, setHits] = useState<MemoryHit[] | null>(null);

  const load = () => {
    setLoading(true);
    setFailed(null);
    Promise.all([api.memoryTree(), api.memoryLog()])
      .then(([t, l]) => {
        setTree(t);
        setLog(l);
      })
      .catch((e: Error) => setFailed(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
    api
      .features()
      .then((f) => {
        try {
          setOrigin(new URL(f.understory.url).origin);
        } catch {
          // No link, then; the rest works without it.
        }
      })
      .catch(() => {});
  }, []);

  // Asked a moment after the last key, not on every one; the latest asked is what shows.
  useEffect(() => {
    const t = setTimeout(() => setAsked(query.trim()), query ? 300 : 0);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => {
    if (!asked) return setHits(null);
    let current = true;
    api.memorySearch(asked).then(
      (found) => current && setHits(found),
      (e: Error) => current && setFailed(e.message),
    );
    return () => {
      current = false;
    };
  }, [asked]);

  const notes = useMemo(() => countNotes(tree), [tree]);

  if (failed && !tree) {
    return (
      <div className="mt-4 rounded-xl border border-dashed border-line px-4 py-8 text-center">
        <p className="text-sm text-fg-muted">The memory could not be read.</p>
        <p className="mx-auto mt-2 max-w-md text-xs text-fg-faint">{failed}</p>
        <div className="mt-3 flex items-center justify-center gap-3 text-xs">
          <button type="button" onClick={load} className="text-accent hover:underline">
            Try again
          </button>
          {origin && <UnderstoryLink origin={origin} />}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <LuSearch className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the memory"
            aria-label="Search the memory"
            className={`${inputCls} pl-8 ${query ? "pr-8" : ""}`}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear the search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-fg-faint hover:text-fg"
            >
              <LuX className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          aria-label="Read the memory again"
          title="Read the memory again"
          className="rounded-lg p-2 text-fg-subtle transition hover:bg-fg/5 hover:text-fg disabled:opacity-40"
        >
          <LuRefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
        {origin && <UnderstoryLink origin={origin} />}
      </div>
      {failed && tree && <p className="mt-2 text-xs text-warn">{failed}</p>}

      <div className="mt-3 md:grid md:grid-cols-[15rem_minmax(0,1fr)] md:gap-4">
        {/* On a phone, the list or the note: one at a time. */}
        <nav aria-label="Memory" className={`${note ? "hidden md:block" : ""} min-w-0`}>
          {hits ? (
            <Hits hits={hits} asked={asked} open={note} onOpen={onNote} />
          ) : !tree ? (
            <div className="skeleton-group space-y-1.5" aria-label="Loading the memory">
              {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-7 w-full" />)}
            </div>
          ) : notes === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-xs text-fg-subtle">
              Nothing is in the memory yet. The agent adds to it as it learns.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {(tree.children ?? []).map((n) => (
                <TreeNode key={n.path} node={n} depth={0} open={note} onOpen={onNote} />
              ))}
            </ul>
          )}
        </nav>

        {/* Without a note, the changes: beside the list, or under it on a phone. */}
        <div className={`${note ? "" : "mt-4 md:mt-0"} min-w-0`}>
          {note ? <Note path={note} onOpen={onNote} onClose={() => onNote(null)} /> : <Changes log={log} onOpen={onNote} />}
        </div>
      </div>
    </div>
  );
}

function UnderstoryLink({ origin }: { origin: string }) {
  return (
    <a
      href={origin}
      target="_blank"
      rel="noreferrer"
      title="Understory's own page, with the graph — at the address the portal reaches it by, which this browser may not"
      className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
    >
      Open in Understory <LuExternalLink className="h-3 w-3" />
    </a>
  );
}

const countNotes = (node: MemoryNode | null): number =>
  !node ? 0 : node.kind === "concept" ? 1 : (node.children ?? []).reduce((n, c) => n + countNotes(c), 0);

function TreeNode({ node, depth, open, onOpen }: { node: MemoryNode; depth: number; open: string | null; onOpen: (path: string) => void }) {
  const [expanded, setExpanded] = useState(true);
  // Understory's own index and log: the log is shown as the changes, the index is its table of contents.
  if (node.kind === "reserved") return null;
  const pad = { paddingLeft: `${0.5 + depth * 0.875}rem` };
  if (node.kind === "directory") {
    const count = countNotes(node);
    return (
      <li>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          style={pad}
          className="flex w-full items-center gap-1.5 rounded-lg py-1.5 pr-2 text-left text-xs text-fg-muted transition hover:bg-fg/5"
        >
          {expanded ? <LuChevronDown className="h-3 w-3 shrink-0" /> : <LuChevronRight className="h-3 w-3 shrink-0" />}
          <LuFolder className="h-3.5 w-3.5 shrink-0 text-fg-faint" />
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          <span className="shrink-0 text-[10px] text-fg-faint">{count}</span>
        </button>
        {expanded && (
          <ul className="space-y-0.5">
            {(node.children ?? []).map((c) => (
              <TreeNode key={c.path} node={c} depth={depth + 1} open={open} onOpen={onOpen} />
            ))}
          </ul>
        )}
      </li>
    );
  }
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(node.path)}
        aria-current={open === node.path ? "page" : undefined}
        title={node.description}
        style={pad}
        className={`flex w-full items-center gap-1.5 rounded-lg py-1.5 pr-2 text-left text-xs transition ${
          open === node.path ? "bg-accent/12 text-accent" : "text-fg hover:bg-fg/5"
        }`}
      >
        <span className="w-3 shrink-0" />
        <LuFileText className="h-3.5 w-3.5 shrink-0 opacity-60" />
        <span className="min-w-0 flex-1 truncate">{node.title || node.name}</span>
      </button>
    </li>
  );
}

function Hits({ hits, asked, open, onOpen }: { hits: MemoryHit[]; asked: string; open: string | null; onOpen: (path: string) => void }) {
  if (!hits.length) {
    return <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-xs text-fg-subtle">Nothing in the memory matches “{asked}”.</p>;
  }
  return (
    <ul aria-label="Found in the memory" className="space-y-1">
      {hits.map((h) => (
        <li key={h.path}>
          <button
            type="button"
            onClick={() => onOpen(h.path)}
            aria-current={open === h.path ? "page" : undefined}
            className={`w-full rounded-lg px-2.5 py-2 text-left transition ${open === h.path ? "bg-accent/12" : "hover:bg-fg/5"}`}
          >
            <p className={`truncate text-xs ${open === h.path ? "text-accent" : "text-fg"}`}>{h.title || h.path}</p>
            {(h.description || h.snippet) && <p className="mt-0.5 line-clamp-2 text-[11px] text-fg-faint">{h.description || h.snippet}</p>}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Where a link inside the memory leads, from the note it is in; undefined for one to the web. */
function insidePath(href: string | undefined, from: string): string | undefined {
  if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#")) return undefined;
  const dir = from.slice(0, from.lastIndexOf("/") + 1) || "/";
  const path = decodeURIComponent(new URL(href, `http://memory${dir}`).pathname);
  // A folder's link is to its index.
  return path.endsWith("/") ? `${path}index.md` : path;
}

/**
 * A note's markdown. A link inside the memory is to another of its notes:
 * opened here rather than followed, which would take the portal to a page of
 * that name. Ones to the web open in a tab of their own.
 */
function MemoryMarkdown({ text, from, onOpen }: { text: string; from: string; onOpen: (path: string) => void }) {
  const components = useMemo(
    () => ({
      a: ({ href, children }: { href?: string; children?: ReactNode }) => {
        const inside = insidePath(href, from);
        return inside ? (
          <a
            href={`?${new URLSearchParams({ tab: "memory", note: inside })}`}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              onOpen(inside);
            }}
            className="text-accent hover:underline"
          >
            {children}
          </a>
        ) : (
          <a href={href} target="_blank" rel="noreferrer" className="text-accent hover:underline">
            {children}
          </a>
        );
      },
    }),
    [from, onOpen],
  );
  return <Streamdown components={components}>{text}</Streamdown>;
}

function Note({ path, onOpen, onClose }: { path: string; onOpen: (path: string) => void; onClose: () => void }) {
  const [concept, setConcept] = useState<MemoryConcept | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    setConcept(null);
    setFailed(null);
    api.memoryConcept(path).then(
      (c) => current && setConcept(c),
      (e: Error) => current && setFailed(e.message),
    );
    return () => {
      current = false;
    };
  }, [path]);

  const f = concept?.frontmatter;
  const when = typeof f?.timestamp === "string" ? new Date(f.timestamp) : null;
  return (
    <article aria-label={f?.title || path} className="rounded-xl border border-line bg-raised/40 p-4">
      <div className="flex items-start gap-2">
        <button type="button" onClick={onClose} aria-label="Back to the memory" className="-ml-1 rounded p-1 text-fg-subtle hover:text-fg md:hidden">
          <LuChevronLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-medium text-fg">{f?.title || path.split("/").pop()}</h3>
          <p className="mt-0.5 truncate font-mono text-[10px] text-fg-faint">{path}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close the note" className="hidden rounded p-1 text-fg-subtle hover:text-fg md:block">
          <LuX className="h-4 w-4" />
        </button>
      </div>
      {failed ? (
        <p className="mt-3 text-sm text-warn">{failed}</p>
      ) : !concept ? (
        <div className="skeleton-group mt-3 space-y-2" aria-label="Loading the note">
          <div className="skeleton h-4 w-2/3" />
          <div className="skeleton h-24 w-full" />
        </div>
      ) : (
        <>
          {(f?.type || f?.tags?.length || when) && (
            <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
              {f?.type && <span className="rounded bg-accent/10 px-1.5 py-0.5 text-accent">{f.type}</span>}
              {(Array.isArray(f?.tags) ? f.tags : []).map((t) => (
                <span key={String(t)} className="rounded bg-fg/5 px-1.5 py-0.5 text-fg-subtle">
                  #{String(t)}
                </span>
              ))}
              {when && !Number.isNaN(when.getTime()) && <span className="text-fg-faint">{when.toLocaleString()}</span>}
            </p>
          )}
          {f?.description && <p className="mt-2 text-sm text-fg-muted">{f.description}</p>}
          <div className="md prose prose-sm mt-3 max-w-none text-sm text-fg">
            <MemoryMarkdown text={concept.body} from={path} onOpen={onOpen} />
          </div>
        </>
      )}
    </article>
  );
}

function Changes({ log, onOpen }: { log: MemoryChange[] | null; onOpen: (path: string) => void }) {
  if (!log) return null;
  // Newest first: the log is kept oldest first, as it was written.
  const recent = [...log].reverse().slice(0, 30);
  return (
    <section aria-label="Recent changes to the memory" className="rounded-xl border border-line bg-raised/40 p-4">
      <h3 className="flex items-center gap-1.5 text-xs font-medium text-fg-muted">
        <LuHistory className="h-3.5 w-3.5" /> Recent changes
      </h3>
      {recent.length === 0 ? (
        <p className="mt-2 text-xs text-fg-faint">None yet.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {recent.map((c, i) => (
            <li key={i} className="text-xs">
              <p className="text-[10px] text-fg-faint">
                {c.date} · {c.action}
              </p>
              <div className="md mt-0.5 text-fg">
                <MemoryMarkdown text={c.summary} from="/" onOpen={onOpen} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
