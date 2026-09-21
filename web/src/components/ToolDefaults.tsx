import { useEffect, useState } from "react";
import { api } from "../api";
import { groupTools, nextOff } from "../tool-groups";

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

  useEffect(() => {
    api
      .toolDefaults()
      .then((r) => {
        setTools(r.tools);
        setOff(r.off);
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
          {groupTools(tools.map((t) => ({ ...t, enabled: !off.includes(t.name) }))).map((group) => (
            <div key={group.source} className="border-b border-line last:border-0">
              <div className="flex items-center gap-2 bg-raised/40 px-3 py-1.5">
                <p className="min-w-0 flex-1 truncate text-xs font-medium text-fg-muted">
                  {group.source}
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => flip(group.tools.map((t) => t.name), group.allOff)}
                  className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-fg-subtle transition hover:bg-fg/5 hover:text-fg disabled:opacity-50"
                >
                  {group.allOff ? "all on" : "all off"}
                </button>
              </div>
              <ul className="py-1">
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
          ))}
        </div>
      )}
    </>
  );
}
