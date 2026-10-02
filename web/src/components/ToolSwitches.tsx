import { useEffect, useState } from "react";
import { LuChevronDown, LuChevronRight } from "react-icons/lu";
import { api, type PortalTool } from "../api";
import { displayName, groupSummary, groupTools, nextOff, sourceName } from "../tool-groups";
import { useOpenGroups } from "../use-open-groups";
import { t, tp } from "../i18n";

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
 *
 * The same list is a project's, from the Projects page: what its chats start
 * with, between the portal-wide default and what one chat switches for itself.
 * The two answer in the same shape, so only where they ask and write differs.
 *
 * And a project's that does not exist yet, in the dialog that makes it: there is
 * nothing to ask or to save, so it starts from the portal-wide default and hands
 * each choice to the dialog, which sends them along with the project.
 */
export function ToolSwitches(props: { sessionId: string } | { project: string } | { onDraft: (off: string[]) => void }) {
  const project = "project" in props ? props.project : undefined;
  const sessionId = "sessionId" in props ? props.sessionId : "";
  const onDraft = "onDraft" in props ? props.onDraft : undefined;
  const drafting = onDraft !== undefined;
  // What the chats of a project, made or about to be, start with.
  const forProject = project !== undefined || drafting;
  const [tools, setTools] = useState<PortalTool[] | null>(null);
  const [off, setOff] = useState<string[]>([]);
  const [live, setLive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  const groups = useOpenGroups();

  useEffect(() => {
    let cancelled = false;
    (drafting
      ? api.toolDefaults().then((r) => ({
          ...r,
          live: false,
          tools: r.tools.map((tool) => ({ ...tool, enabled: !r.off.includes(tool.name) })),
        }))
      : project !== undefined
        ? api.projectTools(project)
        : api.tools(sessionId)
    )
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
  }, [project, sessionId, drafting]);

  const flip = async (names: string[], enabled: boolean) => {
    const wanted = nextOff(off, names, enabled);
    const before = { off, tools };
    setOff(wanted);
    setTools((prev) =>
      prev?.map((t) => (names.includes(t.name) ? { ...t, enabled } : t)) ?? prev
    );
    // Nothing to save yet: the dialog keeps it until the project is made.
    if (onDraft) return onDraft(wanted);
    setBusy(true);
    try {
      const r = await (project !== undefined ? api.setProjectTools(project, wanted) : api.setTools(sessionId, wanted));
      setOff(r.off);
    } catch {
      // Put it back rather than showing a switch that did not take.
      setOff(before.off);
      setTools(before.tools);
    } finally {
      setBusy(false);
    }
  };

  if (!tools) return <p className="px-3 py-2 text-xs text-fg-subtle">{t("Loading…")}</p>;

  if (refusal) {
    return <p className="px-3 py-2 text-xs text-fg-subtle">{refusal}</p>;
  }

  if (!tools.length) {
    return (
      <p className="px-3 py-2 text-xs text-fg-subtle">
        {live
          ? t("No tools registered.")
          : off.length
            ? tp(off.length, "{n} switched off. The rest are listed once a conversation has run.", "{n} switched off. The rest are listed once a conversation has run.")
            : t("No tools seen yet — they are listed once a conversation has run.")}
      </p>
    );
  }

  return (
    <div className="max-h-80 overflow-y-auto">
      {/* Before the first message pi has no registry to ask: the list is what
          earlier chats registered, and what is switched here is this chat's
          from its start — the default is not touched. */}
      {!live && (
        <p className="px-3 pb-1.5 pt-2 text-[10px] text-fg-faint">
          {forProject
            ? t("These are the tools earlier chats had. What you switch here is what every chat in this project starts with; the portal-wide defaults stay as they are.")
            : t("Not started yet — these are the tools earlier chats had. What you switch here holds for this chat from its first message; the defaults stay as they are.")}
        </p>
      )}
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
                title={sourceName(group.source)}
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
              {group.allOff ? t("all on") : t("all off")}
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
                      {tool.defaultOn ? t("default on") : t("default off")}
                    </span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        </div>
        );
      })}
      {live && (
        <p className="px-3 py-1.5 text-[10px] text-fg-faint">
          {t("Applies from the next message, for this conversation. Settings → Tools sets what every conversation starts with, and Settings → Images does for the picture tools.")}
        </p>
      )}
      {project !== undefined && (
        <p className="px-3 py-1.5 text-[10px] text-fg-faint">
          {t("Chats already running here have it from their next message. A chat that switched a tool for itself keeps its own choice.")}
        </p>
      )}
    </div>
  );
}
