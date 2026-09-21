import { useEffect, useState } from "react";
import { LuChevronDown, LuChevronRight, LuCheck, LuPencil, LuX } from "react-icons/lu";
import { api } from "../api";
import { displayName, groupSummary, groupTools, nextOff } from "../tool-groups";
import { useOpenGroups } from "../use-open-groups";

/**
 * Which tools every conversation starts with.
 *
 * The switch in the composer is per chat, which is right for "not this time"
 * and wrong for "hardly ever" — nobody wants to turn the same tool off at the
 * start of every conversation. This is the other half: the default, which a
 * chat may still disagree with.
 *
 * The list is what the portal has seen a session register, not what is loaded
 * right now. pi builds its registry when a conversation starts, and needing to
 * start one before you can say "this should be off everywhere" would be the
 * wrong way round.
 */
export function ToolDefaults({ onError }: { onError: (e: string) => void }) {
  const [tools, setTools] = useState<{ name: string; source: string }[]>([]);
  const [off, setOff] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  /** The group being renamed, and what has been typed so far. */
  const [renaming, setRenaming] = useState<{ source: string; value: string } | null>(null);
  const groups = useOpenGroups();

  useEffect(() => {
    api
      .toolDefaults()
      .then((r) => {
        setTools(r.tools);
        setOff(r.off);
        setNames(r.names ?? {});
      })
      .catch((e) => onError(String(e)))
      .finally(() => setLoading(false));
  }, [onError]);

  const flip = async (names: string[], enabled: boolean) => {
    const wanted = nextOff(off, names, enabled);
    const before = off;
    setOff(wanted);
    setBusy(true);
    try {
      const r = await api.setToolDefaults(wanted);
      setOff(r.off);
    } catch (e) {
      setOff(before);
      onError(String(e));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Store a name, or take one away.
   *
   * Blank means "call it what it calls itself" rather than an empty heading,
   * so the entry is removed and the derived name comes back.
   */
  const rename = async (source: string, label: string) => {
    const next = { ...names };
    if (label.trim()) next[source] = label.trim();
    else delete next[source];
    const before = names;
    setNames(next);
    setRenaming(null);
    try {
      const r = await api.setToolNames(next);
      setNames(r.names);
    } catch (e) {
      setNames(before);
      onError(String(e));
    }
  };

  if (loading) return null;

  return (
    <>
      <section className="mb-6 rounded-xl border border-line bg-raised/40 p-3">
        <p className="text-xs text-fg-subtle">
          What a conversation starts with. A tool switched off here is not offered to the model
          in any chat — the extension stays installed and its slash commands still work. One
          chat can switch any of them the other way for itself, from the blocks icon beside the
          composer, and a change here reaches every chat that has not.
        </p>
      </section>

      {!tools.length ? (
        <p className="rounded-xl border border-line bg-raised/40 px-3 py-2 text-xs text-fg-subtle">
          Nothing listed yet. Tools appear once a conversation has run — that is when pi builds
          the list of what its extensions registered.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line">
          {/* Read from the switches rather than from what was loaded: the list
              is what exists, `off` is what has been decided about it, and only
              the second changes while this is open. */}
          {groupTools(tools.map((t) => ({ ...t, enabled: !off.includes(t.name) }))).map((group) => {
            const open = groups.isOpen(group.source);
            return (
            <div key={group.source} className="border-b border-line last:border-0">
              <div className="flex items-center gap-1 bg-raised/40 px-1.5 py-1.5">
                {renaming?.source === group.source ? (
                  <>
                    <input
                      autoFocus
                      value={renaming.value}
                      onChange={(e) => setRenaming({ source: group.source, value: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") rename(group.source, renaming.value);
                        if (e.key === "Escape") setRenaming(null);
                      }}
                      placeholder={displayName(group.source)}
                      aria-label={`Name for ${group.source}`}
                      className="min-w-0 flex-1 rounded border border-line bg-canvas px-1.5 py-0.5 text-xs text-fg outline-none focus:border-accent/60"
                    />
                    <button
                      type="button"
                      onClick={() => rename(group.source, renaming.value)}
                      title="Save"
                      className="shrink-0 rounded p-1 text-fg-subtle transition hover:bg-fg/5 hover:text-fg"
                    >
                      <LuCheck className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenaming(null)}
                      title="Cancel"
                      className="shrink-0 rounded p-1 text-fg-subtle transition hover:bg-fg/5 hover:text-fg"
                    >
                      <LuX className="h-3 w-3" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => groups.toggle(group.source)}
                      className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1.5 py-0.5 text-left transition hover:bg-fg/5"
                    >
                      {open ? (
                        <LuChevronDown className="h-3 w-3 shrink-0 text-fg-faint" />
                      ) : (
                        <LuChevronRight className="h-3 w-3 shrink-0 text-fg-faint" />
                      )}
                      <span
                        title={group.source}
                        className="min-w-0 flex-1 truncate text-xs font-medium text-fg-muted"
                      >
                        {displayName(group.source, names)}
                      </span>
                      <span className="shrink-0 text-[11px] text-fg-faint">
                        {groupSummary(group)}
                      </span>
                    </button>
                    {/* Only here, not in the chat popover: naming a thing is a
                        settings decision, and the popover is for one chat. */}
                    <button
                      type="button"
                      onClick={() =>
                        setRenaming({ source: group.source, value: names[group.source] ?? "" })
                      }
                      title={`Rename — it is ${group.source}`}
                      aria-label={`Rename ${group.source}`}
                      className="shrink-0 rounded p-1 text-fg-subtle transition hover:bg-fg/5 hover:text-fg"
                    >
                      <LuPencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => flip(group.tools.map((t) => t.name), group.allOff)}
                      className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-fg-subtle transition hover:bg-fg/5 hover:text-fg disabled:opacity-50"
                    >
                      {group.allOff ? "all on" : "all off"}
                    </button>
                  </>
                )}
              </div>
              <ul className={open ? "py-1" : "hidden"}>
                {group.tools.map((tool) => (
                  <li key={tool.name}>
                    <label className="flex cursor-pointer items-center gap-2 px-3 py-1 text-xs transition hover:bg-fg/5">
                      <input
                        type="checkbox"
                        checked={tool.enabled}
                        disabled={busy}
                        onChange={(e) => flip([tool.name], e.target.checked)}
                        className="h-3 w-3 shrink-0 accent-accent"
                      />
                      <span
                        className={`min-w-0 flex-1 truncate font-mono ${
                          tool.enabled ? "text-fg" : "text-fg-faint line-through"
                        }`}
                      >
                        {tool.name}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
            );
          })}
        </div>
      )}
    </>
  );
}
