import { useEffect, useState } from "react";
import { LuChevronDown, LuChevronRight } from "react-icons/lu";
import { api, type PortalTool } from "../api";
import { displayName, groupSummary, groupTools, nextOff } from "../tool-groups";
import { useOpenGroups } from "../use-open-groups";

/**
 * Which tools this conversation may use.
 *
 * Whether it may reach for the web search, the todo list, the browser, or
 * anything else a package brought. Per conversation, because "look this up for
 * me" and "do not go online, just read the repo" are both reasonable in the
 * same week.
 *
 * Grouped by what installed them, because that is how somebody thinks about
 * it — "turn the web search one off" means four tools that arrived together.
 * An MCP server is a group of its own rather than a share of the adapter, for
 * the same reason: nobody thinks "the adapter", they think "the browser one".
 * The browser is one of those servers and nothing more — having its tools is
 * having the browser, which is why the switch it used to have of its own is
 * gone. Nothing here knows what any of them are.
 */
export function ToolSwitches({ sessionId }: { sessionId: string }) {
  const [tools, setTools] = useState<PortalTool[] | null>(null);
  const [off, setOff] = useState<string[]>([]);
  const [live, setLive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  const groups = useOpenGroups();

  useEffect(() => {
    let cancelled = false;
    api
      .tools(sessionId)
      .then((r) => {
        if (cancelled) return;
        setTools(r.tools);
        setOff(r.off);
        setLive(r.live);
        setNames(r.names ?? {});
      })
      .catch((e) => {
        if (cancelled) return;
        // A deployment where this cannot work says so — a switch that silently
        // does nothing is worse than one that is not there.
        setRefusal(String(e).replace(/^Error:\s*/, ""));
        setTools([]);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const flip = async (names: string[], enabled: boolean) => {
    const wanted = nextOff(off, names, enabled);
    const before = { off, tools };
    setOff(wanted);
    setTools((prev) =>
      prev?.map((t) => (names.includes(t.name) ? { ...t, enabled } : t)) ?? prev
    );
    setBusy(true);
    try {
      const r = await api.setTools(sessionId, wanted);
      setOff(r.off);
    } catch {
      // Put it back rather than showing a switch that did not take.
      setOff(before.off);
      setTools(before.tools);
    } finally {
      setBusy(false);
    }
  };

  if (!tools) return <p className="px-3 py-2 text-xs text-fg-subtle">Loading…</p>;

  if (refusal) {
    return <p className="px-3 py-2 text-xs text-fg-subtle">{refusal}</p>;
  }

  if (!tools.length) {
    return (
      <p className="px-3 py-2 text-xs text-fg-subtle">
        {live
          ? "No tools registered."
          : off.length
            ? `${off.length} switched off. The rest are only listed once this conversation is running.`
            : "Send a message first — the tools exist once pi is running."}
      </p>
    );
  }

  return (
    <div className="max-h-80 overflow-y-auto">
      {groupTools(tools).map((group) => {
        const open = groups.isOpen(group.source);
        return (
        <div key={group.source} className="border-b border-line/60 last:border-0">
          <div className="flex items-center gap-1 px-1.5 py-1.5">
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
                className="min-w-0 flex-1 truncate text-[11px] font-medium text-fg-muted"
              >
                {displayName(group.source, names)}
              </span>
              <span className="shrink-0 text-[10px] text-fg-faint">{groupSummary(group)}</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => flip(group.tools.map((t) => t.name), group.allOff)}
              className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-fg-subtle transition hover:bg-fg/5 hover:text-fg disabled:opacity-50"
            >
              {group.allOff ? "all on" : "all off"}
            </button>
          </div>
          <ul className={open ? "pb-1" : "hidden"}>
            {group.tools.map((tool) => (
              <li key={tool.name}>
                <label
                  title={tool.description}
                  className="flex cursor-pointer items-center gap-2 px-3 py-1 text-xs transition hover:bg-fg/5"
                >
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
                  {/* Only where this chat disagrees with the default, so the
                      setting is findable from the place it is being overruled. */}
                  {tool.defaultOn !== undefined && tool.defaultOn !== tool.enabled && (
                    <span className="shrink-0 text-[10px] text-fg-faint">
                      default {tool.defaultOn ? "on" : "off"}
                    </span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        </div>
        );
      })}
      <p className="px-3 py-1.5 text-[10px] text-fg-faint">
        Applies from the next message, for this conversation. Settings → Tools sets what every
        conversation starts with.
      </p>
    </div>
  );
}
