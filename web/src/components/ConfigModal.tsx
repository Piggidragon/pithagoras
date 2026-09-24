import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Select } from "./Select";
import {
  LuBlocks,
  LuBrain,
  LuCheck,
  LuCircleAlert,
  LuDownload,
  LuExternalLink,
  LuEye,
  LuFileJson,
  LuFolder,
  LuHammer,
  LuInfo,
  LuKeyboard,
  LuMonitor,
  LuMoon,
  LuPlug,
  LuPuzzle,
  LuRadio,
  LuWrench,
  LuRefreshCw,
  LuServer,
  LuSlidersHorizontal,
  LuSun,
  LuTrash2,
  LuTriangleAlert,
  LuUsers,
} from "react-icons/lu";
import { api, SIGNED_OUT, type AvailableModel, type ExtensionInfo, type GlobalSettings, type ReportTarget, type ReportTo } from "../api";
import { ChannelsPanel } from "./ChannelsPanel";
import { SkillsPanel } from "./SkillsPanel";
import { McpPanel } from "./McpPanel";
import { parseWindow } from "../context-window";
import { KeepRecent, formatTokens, useKeepRecentSave } from "./KeepRecent";
import { displayName } from "../tool-groups";
import { useAsksBeforeDeleting } from "../confirm-prefs";
import { useNotifyState } from "../notify";
import { PeoplePanel } from "./PeoplePanel";
import { PortalExtensions } from "./PortalExtensions";
import { Modal } from "./Modal";
import { ToolDefaults } from "./ToolDefaults";
import { isEnter } from "../shortcuts";
import { KeyboardShortcuts } from "./KeyboardShortcuts";
import { ProvidersPanel } from "./ProvidersPanel";
import { Empty, Section, Switch, SwitchRow, btnCls, inputCls, primaryCls } from "./SettingsUi";
import { useTheme, type Theme } from "../theme";
import { humanKey, typed } from "../setting-values";

export type Tab =
  | "models"
  | "general"
  | "channels"
  | "people"
  | "add-ons"
  | "tools"
  | "skills"
  | "mcp"
  | "extensions"
  | "browser"
  | "shortcuts"
  | "about"
  | "advanced";

/** Either a fixed tab or one extension's own configuration page. */
type Nav = { kind: "tab"; id: Tab } | { kind: "ext"; spec: string };

type TabDef = { id: Tab; label: string; icon: ReactNode; hint: string };

/**
 * The rail, in the order a person setting the portal up needs it: where the
 * models come from and how they are used, then what the agent can do, who it
 * talks to, and last the portal itself.
 */
const GROUPS: { label: string; tabs: TabDef[] }[] = [
  {
    label: "Models",
    tabs: [
      { id: "models", label: "Providers", icon: <LuServer />, hint: "Where the models come from" },
      { id: "general", label: "Defaults", icon: <LuSlidersHorizontal />, hint: "Model, effort and context for new chats" },
    ],
  },
  {
    label: "Agent",
    tabs: [
      { id: "tools", label: "Tools", icon: <LuHammer />, hint: "What the agent may reach for, by default" },
      { id: "skills", label: "Skills", icon: <LuWrench />, hint: "Procedures the agent can reach for" },
      { id: "mcp", label: "MCP", icon: <LuPlug />, hint: "Servers the agent can pull tools from" },
      { id: "extensions", label: "Extensions", icon: <LuBlocks />, hint: "Install and manage packages" },
    ],
  },
  {
    label: "Reach",
    tabs: [
      { id: "channels", label: "Channels", icon: <LuRadio />, hint: "Two-way links into the agent" },
      { id: "people", label: "People", icon: <LuUsers />, hint: "Who the agent will talk to" },
    ],
  },
  {
    label: "Portal",
    tabs: [
      { id: "browser", label: "This browser", icon: <LuMonitor />, hint: "Theme, notifications, confirmations" },
      { id: "add-ons", label: "Add-ons", icon: <LuPuzzle />, hint: "Optional parts of the portal itself" },
      { id: "shortcuts", label: "Shortcuts", icon: <LuKeyboard />, hint: "Keyboard shortcuts, and changing them" },
      { id: "about", label: "About", icon: <LuInfo />, hint: "Where this portal keeps things" },
      { id: "advanced", label: "Advanced", icon: <LuFileJson />, hint: "pi's raw settings file" },
    ],
  },
];
const TABS = GROUPS.flatMap((g) => g.tabs);

export function ConfigModal({
  onClose,
  initialTab = "general",
}: {
  onClose: () => void;
  initialTab?: Tab;
}) {
  const [nav, setNav] = useState<Nav>({ kind: "tab", id: TABS.some((t) => t.id === initialTab) ? initialTab : "general" });
  const [error, setError] = useState<string | null>(null);

  // Loaded here rather than inside the Extensions tab: the rail lists every
  // extension that exposes settings, so it needs them before anything is shown.
  const [extensions, setExtensions] = useState<ExtensionInfo[]>([]);
  const [settingsPath, setSettingsPath] = useState("");
  const [loadingExts, setLoadingExts] = useState(true);

  const loadExtensions = async () => {
    setLoadingExts(true);
    try {
      const r = await api.extensions();
      setExtensions(r.extensions);
      setSettingsPath(r.settingsPath);
      return r.extensions;
    } catch (e) {
      setError((e as Error).message);
      return [];
    } finally {
      setLoadingExts(false);
    }
  };

  useEffect(() => {
    loadExtensions();
  }, []);

  const configurable = extensions.filter((e) => e.settings.length > 0);
  const activeExt =
    nav.kind === "ext" ? extensions.find((e) => e.spec === nav.spec) : undefined;

  return (
    <Modal
      wide
      title="Settings"
      subtitle="Applies to the whole portal"
      onClose={onClose}
      startInRail={initialTab === "general"}
      section={nav.kind === "tab" ? TABS.find((t) => t.id === nav.id)?.label : activeExt?.name}
      rail={
        <div className="space-y-4">
          {GROUPS.map((g) => (
            <RailGroup key={g.label} label={g.label}>
              {g.tabs.map((t) => (
                <RailItem
                  key={t.id}
                  icon={t.icon}
                  label={t.label}
                  hint={t.hint}
                  active={nav.kind === "tab" && nav.id === t.id}
                  onClick={() => setNav({ kind: "tab", id: t.id })}
                />
              ))}
            </RailGroup>
          ))}

          {/* Only appears for extensions that actually read settings. */}
          {configurable.length > 0 && (
            <RailGroup label="Extension settings">
              {configurable.map((e) => (
                <RailItem
                  key={e.spec}
                  icon={<LuPuzzle />}
                  label={e.name}
                  active={nav.kind === "ext" && nav.spec === e.spec}
                  onClick={() => setNav({ kind: "ext", spec: e.spec })}
                />
              ))}
            </RailGroup>
          )}
        </div>
      }
    >
      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          <LuCircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-danger/70 hover:text-danger">
            ✕
          </button>
        </div>
      )}

      <div key={nav.kind === "tab" ? nav.id : nav.spec} className="settings-page">
      {nav.kind === "tab" && nav.id === "models" && <ProvidersPanel onError={setError} />}
      {nav.kind === "tab" && nav.id === "general" && <GeneralPanel onError={setError} onProviders={() => setNav({ kind: "tab", id: "models" })} />}
      {nav.kind === "tab" && nav.id === "browser" && <BrowserPanel onError={setError} />}
      {nav.kind === "tab" && nav.id === "about" && <AboutPanel onError={setError} />}
      {nav.kind === "tab" && nav.id === "channels" && <ChannelsPanel onError={setError} />}
      {nav.kind === "tab" && nav.id === "people" && <PeoplePanel onError={setError} />}
      {nav.kind === "tab" && nav.id === "add-ons" && <PortalExtensions onError={setError} />}
      {nav.kind === "tab" && nav.id === "tools" && <ToolDefaults onError={setError} />}
      {nav.kind === "tab" && nav.id === "skills" && <SkillsPanel onError={setError} />}
      {nav.kind === "tab" && nav.id === "mcp" && <McpPanel onError={setError} />}
      {nav.kind === "tab" && nav.id === "extensions" && (
        <ExtensionsPanel
          extensions={extensions}
          loading={loadingExts}
          onError={setError}
          onRefresh={loadExtensions}
          onConfigure={(spec) => setNav({ kind: "ext", spec })}
        />
      )}
      {nav.kind === "tab" && nav.id === "shortcuts" && <KeyboardShortcuts />}
      {nav.kind === "tab" && nav.id === "advanced" && (
        <AdvancedPanel settingsPath={settingsPath} onError={setError} />
      )}
      {nav.kind === "ext" &&
        (activeExt ? (
          <ExtensionPanel ext={activeExt} onError={setError} onSaved={loadExtensions} />
        ) : (
          <Empty>That extension is no longer installed.</Empty>
        ))}
      </div>
    </Modal>
  );
}

// --- rail ---

function RailGroup({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div>
      {label && (
        <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-faint">
          {label}
        </p>
      )}
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function RailItem({
  icon,
  label,
  hint,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={hint}
      aria-current={active ? "page" : undefined}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition ${
        active
          ? "bg-accent/10 text-accent ring-1 ring-inset ring-accent/20"
          : "text-fg-muted hover:bg-fg/5 hover:text-fg"
      }`}
    >
      <span className={`shrink-0 ${active ? "text-accent" : "text-fg-subtle"}`}>{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

// --- shared bits ---

const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

// --- general ---

/**
 * Where a routine reports when it does not name a destination itself.
 *
 * Lives here rather than on the Routines page because it is a portal-wide
 * default: a routine created by the agent from a chat gets it without anyone
 * opening a form.
 */
function ReportDefault({ onError }: { onError: (e: string) => void }) {
  const [targets, setTargets] = useState<ReportTarget[]>([]);
  const [current, setCurrent] = useState<ReportTo | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = () =>
    api
      .reportTargets()
      .then((r) => {
        setTargets(r.targets);
        setCurrent(r.default);
        setLoaded(true);
      })
      .catch((e) => onError((e as Error).message));

  useEffect(() => {
    load();
  }, []);

  if (!loaded) return null;

  const value = current ? `${current.channel}\u0000${current.target}` : "";

  return (
    <Section
      title="Routine reports"
      hint="Where a scheduled run reaches you when it has something worth saying. The agent decides whether a run is worth reporting; a routine can point somewhere else of its own."
    >
      <Select
        className="w-full"
        value={value}
        options={[
          { value: "", label: "Nowhere — routines stay silent" },
          ...targets.map((t) => ({ value: `${t.channel}\u0000${t.target}`, label: `${t.channel} — ${t.label}` })),
        ]}
        onChange={async (next) => {
          const [channel, target] = next.split("\u0000");
          try {
            await api.setReportDefault(channel && target ? { channel, target } : null);
            await load();
          } catch (err) {
            onError((err as Error).message);
          }
        }}
      />
      {targets.length === 0 && (
        <p className="mt-1.5 text-xs text-fg-faint">
          Nothing to pick yet. A destination is a conversation that already exists on a channel
          that can speak first — message your bot once and it appears here. A webhook never will:
          it can only answer.
        </p>
      )}
    </Section>
  );
}

/** The one question the portal asks before it deletes, and whether it asks it. */
function Confirmations() {
  const [ask, setAsk] = useAsksBeforeDeleting();
  return (
    <SwitchRow
      title="Ask before deleting"
      detail="Chats, messages, files, skills, routines, projects, voices, channels, providers. Unsaved changes are still asked about: there is no other copy of them."
      on={ask}
      onChange={setAsk}
    />
  );
}

/** Only where there is a password: without one there is nothing to sign out of. */
function SignOut({ onError }: { onError: (e: string) => void }) {
  const [required, setRequired] = useState(false);
  useEffect(() => {
    api.authStatus().then((s) => setRequired(s.authRequired)).catch(() => {});
  }, []);
  if (!required) return null;
  const signOut = () =>
    api
      .logout()
      .then(() => window.dispatchEvent(new Event(SIGNED_OUT)))
      .catch((e) => onError((e as Error).message));
  return (
    <Section title="Signed in" hint="Signing out asks for the password here again. Other browsers stay signed in.">
      <button onClick={signOut} className={btnCls}>
        Sign out
      </button>
    </Section>
  );
}

/** Whether the browser may say so when a chat finishes or needs an answer. */
function Notifications() {
  const [state, setOn] = useNotifyState();
  const note: Record<string, string> = {
    unsupported:
      "This browser does not offer them here — they need a secure connection (HTTPS, or localhost).",
    denied: "The browser has blocked them for this site. Allow them in its site settings, then come back.",
  };
  return (
    <SwitchRow
      title="Tell me when a chat is done or needs me"
      detail="Only while you are on another tab or window: nobody needs telling about the chat in front of them. The tab title shows what a chat is doing either way."
      on={state === "on"}
      disabled={state === "unsupported" || state === "denied"}
      onChange={(on) => void setOn(on)}
      note={note[state]}
    />
  );
}

const THEMES: { value: Theme; label: string; icon: ReactNode }[] = [
  { value: "light", label: "Light", icon: <LuSun /> },
  { value: "dark", label: "Dark", icon: <LuMoon /> },
  { value: "system", label: "Match the system", icon: <LuMonitor /> },
];

/** Light, dark, or whichever the system is — as three cards, each a glimpse of itself. */
function Appearance() {
  const { theme, setTheme } = useTheme();
  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2">
      {THEMES.map((t) => (
        <button
          key={t.value}
          type="button"
          role="radio"
          aria-checked={theme === t.value}
          onClick={() => setTheme(t.value)}
          className={`group rounded-xl border p-2 text-left transition ${
            theme === t.value ? "border-accent/50 bg-accent/5 ring-1 ring-inset ring-accent/30" : "border-line hover:border-fg/20 hover:bg-fg/[.03]"
          }`}
        >
          <span className={`theme-swatch theme-swatch-${t.value}`} aria-hidden="true"><i /><i /><i /></span>
          <span className="mt-2 flex items-center gap-1.5 text-xs text-fg [&>svg]:h-3.5 [&>svg]:w-3.5">
            {t.icon} {t.label}
          </span>
        </button>
      ))}
    </div>
  );
}

/** What is kept in this browser rather than on the server. */
function BrowserPanel({ onError }: { onError: (e: string) => void }) {
  return (
    <>
      <p className="mb-5 text-xs text-fg-faint">
        Kept in this browser only — a phone can differ from the laptop.
      </p>
      <Section title="Appearance">
        <Appearance />
      </Section>
      <Section title="Notifications">
        <Notifications />
      </Section>
      <Section title="Confirmations">
        <Confirmations />
      </Section>
      <SignOut onError={onError} />
    </>
  );
}

/** Where this portal keeps what it keeps, set when it was deployed. */
function AboutPanel({ onError }: { onError: (e: string) => void }) {
  const [meta, setMeta] = useState<{ executor: string; workspaceRoot: string; piSettingsPath: string } | null>(null);
  useEffect(() => {
    api
      .settings()
      .then((r) => setMeta({ executor: r.executor, workspaceRoot: r.workspaceRoot, piSettingsPath: r.piSettingsPath }))
      .catch((e) => onError((e as Error).message));
  }, []);
  if (!meta) return <div className="skeleton-group space-y-2"><div className="skeleton h-4 w-32" /><div className="skeleton h-28 w-full" /></div>;
  const agentDir = meta.piSettingsPath.replace(/\/settings\.json$/, "");
  const rows: { icon: ReactNode; label: string; value: string; detail: string }[] = [
    {
      icon: <LuServer />,
      label: "Where the agent runs",
      value: meta.executor === "container" ? "In a container" : "On this host",
      detail: meta.executor === "container" ? "Each chat's pi runs in its own container." : "pi runs inside the portal's own process.",
    },
    { icon: <LuFolder />, label: "Workspaces", value: meta.workspaceRoot, detail: "Where each chat's folder is made." },
    { icon: <LuFileJson />, label: "pi's files", value: agentDir, detail: "settings.json, models.json, auth.json, and installed packages." },
  ];
  return (
    <>
      <Section title="This portal" hint="Set when it was deployed, through its environment.">
        <dl className="divide-y divide-line/70 overflow-hidden rounded-xl border border-line bg-raised/40">
          {rows.map((r) => (
            <div key={r.label} className="flex items-start gap-3 px-3 py-2.5">
              <span className="mt-0.5 text-fg-faint [&>svg]:h-4 [&>svg]:w-4">{r.icon}</span>
              <div className="min-w-0 flex-1">
                <dt className="text-xs text-fg-subtle">{r.label}</dt>
                <dd className="truncate text-sm text-fg" title={r.value}>{r.value}</dd>
                <p className="text-[11px] text-fg-faint">{r.detail}</p>
              </div>
            </div>
          ))}
        </dl>
      </Section>
    </>
  );
}

/** What a model can do, said in a few words under its name. */
function modelHint(m: AvailableModel): string {
  const parts = [m.name !== m.id ? m.id : ""];
  if (m.contextWindow) parts.push(`${formatTokens(m.contextWindow)} window`);
  if (m.input?.includes("image")) parts.push("sees images");
  if (m.reasoning) parts.push("thinks");
  return parts.filter(Boolean).join(" · ");
}

function GeneralPanel({ onError, onProviders }: { onError: (e: string) => void; onProviders: () => void }) {
  /** Only the explicit overrides — an empty value means "inherit". */
  const [stored, setStored] = useState<Partial<GlobalSettings> | null>(null);
  const [defaults, setDefaults] = useState<GlobalSettings | null>(null);
  const [executor, setExecutor] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [keepRecent, setKeepRecent] = useState<number | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  /** Typed text, so that a half-written number is not turned into a request. */
  const [ctxText, setCtxText] = useState("");
  const [ctxSaved, setCtxSaved] = useState<number | null>(null);
  const [ctxNote, setCtxNote] = useState<string | null>(null);
  const [models, setModels] = useState<{ models: AvailableModel[]; providers: Record<string, string> } | null>(null);
  const [modelsFailed, setModelsFailed] = useState(false);

  const load = () =>
    api
      .settings()
      .then((r) => {
        setStored(r.stored);
        setDefaults(r.defaults);
        setKeepRecent(r.compaction.keepRecentTokens);
        setCtxSaved(r.contextDefault);
        setCtxText(r.contextDefault ? String(r.contextDefault) : "");
        setExecutor(r.executor);
      })
      .catch((e) => onError((e as Error).message));

  useEffect(() => {
    load();
    api.allModels().then(setModels).catch(() => setModelsFailed(true));
  }, []);

  /**
   * Saved on release, on its own.
   *
   * Not folded into the defaults: that would submit whatever was loaded when
   * the panel opened, so a value set from the context popup in the meantime
   * would be silently rolled back by a save of unrelated fields.
   */
  const saveKeepRecent = useKeepRecentSave(
    (compaction, refreshed) => {
      setKeepRecent(compaction.keepRecentTokens);
      setApplied(
        refreshed > 0 ? `Applied to ${refreshed} open session${refreshed === 1 ? "" : "s"}` : "Saved",
      );
      setTimeout(() => setApplied(null), 3000);
    },
    (error) => {
      onError(error.message);
      void load();
    },
  );

  /** On leaving the field, on its own — like the slider above, not part of the defaults. */
  const saveContextDefault = async () => {
    const parsed = parseWindow(ctxText);
    const n = parsed.kind === "ok" ? parsed.tokens : null;
    if (parsed.kind === "bad") {
      onError(`${parsed.message} — or leave it empty for none`);
      return setCtxText(ctxSaved ? String(ctxSaved) : "");
    }
    if (n === ctxSaved) return setCtxText(ctxSaved ? String(ctxSaved) : "");
    try {
      const r = await api.setContextDefault(n);
      setCtxSaved(r.contextDefault);
      setCtxText(r.contextDefault ? String(r.contextDefault) : "");
      setCtxNote(n === null ? "Removed" : "Saved");
      setTimeout(() => setCtxNote(null), 3000);
    } catch (e) {
      onError((e as Error).message);
      setCtxText(ctxSaved ? String(ctxSaved) : "");
    }
  };

  const byProvider = useMemo(() => {
    const map = new Map<string, AvailableModel[]>();
    for (const m of models?.models ?? []) map.set(m.provider, [...(map.get(m.provider) ?? []), m]);
    return map;
  }, [models]);

  if (!stored || !defaults) {
    return <div className="skeleton-group space-y-2"><div className="skeleton h-4 w-40" /><div className="skeleton h-10 w-full" /><div className="skeleton h-10 w-full" /><div className="skeleton h-8 w-2/3" /></div>;
  }

  /** Each change is saved as it is made: there is no form to forget to submit. */
  const save = async (next: Partial<GlobalSettings>) => {
    setStored(next);
    try {
      // Sent even when blank: an empty value clears the override server-side.
      await api.saveSettings({
        provider: next.provider ?? "",
        model: next.model ?? "",
        thinkingLevel: next.thinkingLevel ?? "",
      });
      setSaved("Saved");
      setTimeout(() => setSaved(null), 2000);
    } catch (e) {
      onError((e as Error).message);
      void load();
    }
  };

  const provider = stored.provider || defaults.provider;
  const providerName = (id: string) => models?.providers[id] ?? id;
  const providerOptions = [
    { value: "", label: defaults.provider ? `pi's default — ${providerName(defaults.provider)}` : "pi's default", hint: "From pi's own settings.json" },
    ...[...byProvider.entries()].map(([id, list]) => ({ value: id, label: providerName(id), hint: `${list.length} model${list.length === 1 ? "" : "s"}` })),
    ...(stored.provider && !byProvider.has(stored.provider)
      ? [{ value: stored.provider, label: stored.provider, hint: "Not available now — no key, or not set up" }]
      : []),
  ];
  const offered = byProvider.get(provider ?? "") ?? [];
  const modelOptions = [
    { value: "", label: defaults.model && (!stored.provider || stored.provider === defaults.provider) ? `pi's default — ${offered.find((m) => m.id === defaults.model)?.name ?? defaults.model}` : "pi's default", hint: "Whatever pi picks for the provider" },
    ...offered.map((m) => ({ value: m.id, label: m.name, text: `${m.name} ${m.id}`, hint: modelHint(m) || undefined })),
    ...(stored.model && !offered.some((m) => m.id === stored.model)
      ? [{ value: stored.model, label: stored.model, hint: "Not offered by this provider now" }]
      : []),
  ];

  return (
    <>
      <Section
        title="For new chats"
        hint="What a new chat starts with. Each chat keeps whatever is picked for it under the chat box."
        action={saved && <span className="pop-in inline-flex items-center gap-1 text-xs text-ok"><LuCheck className="h-3.5 w-3.5" /> {saved}</span>}
      >
        <div className="space-y-3 rounded-xl border border-line bg-raised/40 p-3">
          {models && models.models.length === 0 && (
            <div className="flex items-center gap-2 rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn">
              <LuTriangleAlert className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1">No model is ready to use yet.</span>
              <button type="button" onClick={onProviders} className="font-medium underline-offset-2 hover:underline">Add a provider</button>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs text-fg-muted">Provider</span>
              {modelsFailed ? (
                <input value={stored.provider ?? ""} onChange={(e) => setStored({ ...stored, provider: e.target.value })} onBlur={() => void save(stored)} placeholder={defaults.provider || "inherit"} className={`${inputCls} mt-1 font-mono`} />
              ) : (
                <Select
                  className="mt-1 w-full"
                  aria-label="Default provider"
                  value={stored.provider ?? ""}
                  options={providerOptions}
                  disabled={!models}
                  placeholder="Loading…"
                  onChange={(next) => {
                    const keeps = (byProvider.get(next || defaults.provider) ?? []).some((m) => m.id === stored.model);
                    void save({ ...stored, provider: next, model: keeps ? stored.model : "" });
                  }}
                />
              )}
            </label>
            <label className="block">
              <span className="text-xs text-fg-muted">Model</span>
              {modelsFailed ? (
                <input value={stored.model ?? ""} onChange={(e) => setStored({ ...stored, model: e.target.value })} onBlur={() => void save(stored)} placeholder={defaults.model || "pi decides"} className={`${inputCls} mt-1 font-mono`} />
              ) : (
                <Select
                  className="mt-1 w-full"
                  aria-label="Default model"
                  value={stored.model ?? ""}
                  options={modelOptions}
                  disabled={!models}
                  placeholder="Loading…"
                  onChange={(next) => void save({ ...stored, model: next })}
                />
              )}
            </label>
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-xs text-fg-muted">Effort</span>
              <span className="text-[10px] text-fg-faint">
                {stored.thinkingLevel ? "click again to go back to pi's default" : defaults.thinkingLevel ? `pi's default: ${defaults.thinkingLevel}` : ""}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1" role="radiogroup" aria-label="Default effort">
              {LEVELS.map((lvl) => {
                const on = stored.thinkingLevel === lvl;
                const inherited = !stored.thinkingLevel && defaults.thinkingLevel === lvl;
                return (
                  <button
                    key={lvl}
                    role="radio"
                    aria-checked={on}
                    // Clicking the active level again hands it back to pi.
                    onClick={() => void save({ ...stored, thinkingLevel: on ? "" : lvl })}
                    className={`rounded-lg px-2.5 py-1 text-xs capitalize transition ${
                      on
                        ? "bg-warn/12 text-warn ring-1 ring-inset ring-warn/30"
                        : inherited
                          ? "bg-fg/5 text-fg ring-1 ring-inset ring-fg/15"
                          : "bg-fg/5 text-fg-muted hover:bg-fg/10"
                    }`}
                  >
                    {lvl}
                  </button>
                );
              })}
            </div>
          </div>
          <p className="flex items-center gap-3 text-[11px] text-fg-faint">
            <span className="inline-flex items-center gap-1"><LuEye className="h-3 w-3" /> sees images</span>
            <span className="inline-flex items-center gap-1"><LuBrain className="h-3 w-3" /> thinks — effort applies</span>
            <button type="button" onClick={onProviders} className="ml-auto text-accent hover:underline">Providers ›</button>
          </p>
        </div>
      </Section>

      <Section
        title="Context"
        hint="How much of a conversation a chat carries, and what is kept word for word when it is compacted."
      >
        <div className="space-y-3 rounded-xl border border-line bg-raised/40 p-3">
          <div>
            <p className="text-xs text-fg-muted">Window</p>
            <input
              value={ctxText}
              disabled={executor === "container"}
              inputMode="numeric"
              onChange={(e) => setCtxText(e.target.value)}
              onBlur={saveContextDefault}
              onKeyDown={(e) => isEnter(e) && e.currentTarget.blur()}
              placeholder="what each model says"
              aria-label="Default context window in tokens"
              className={`${inputCls} mt-1 font-mono`}
            />
            <p className="mt-1.5 text-xs text-fg-faint">
              How many tokens a chat may hold before it is compacted, in every chat, open ones included. A model that
              says it has less keeps its own number, and one set for a model in its context pill wins over this. For a
              server that gives each chat less than the model declares — llama.cpp with <code>--parallel 2</code> gives
              each chat half of <code>ctx-size</code>. Saved when you leave the field.
            </p>
            {executor === "container" && (
              <p className="mt-1 text-xs text-warn">
                Not available with the container executor: pi runs inside the container, where the portal cannot change
                its context window.
              </p>
            )}
            {ctxNote && <p className="mt-1 text-xs text-ok">{ctxNote}</p>}
          </div>
          <div className="border-t border-line/70 pt-3">
            <p className="text-xs text-fg-muted">Kept when compacting</p>
            {keepRecent !== null && (
              <KeepRecent value={keepRecent} onChange={setKeepRecent} onCommit={saveKeepRecent} />
            )}
            <p className="mt-2 text-xs text-fg-faint">
              The most recent stretch is kept word for word; only what is older becomes a summary. pi's default of{" "}
              {formatTokens(20000)} is a third of a 64k window, which is why compacting can look as though it did
              nothing. Saved as you let go, and it reaches open chats too.
            </p>
            {applied && <p className="mt-1 text-xs text-ok">{applied}</p>}
          </div>
        </div>
      </Section>

      <ReportDefault onError={onError} />
    </>
  );
}

// --- extensions ---

const SOURCES = [
  { label: "npm", placeholder: "npm:@scope/package", hint: "published on npm" },
  { label: "git", placeholder: "git:github.com/user/repo@v1", hint: "a git repository" },
  { label: "url", placeholder: "https://github.com/user/repo", hint: "a URL" },
  { label: "path", placeholder: "/absolute/path/to/package", hint: "a local directory" },
];

function ExtensionsPanel({
  extensions,
  loading,
  onError,
  onRefresh,
  onConfigure,
}: {
  extensions: ExtensionInfo[];
  loading: boolean;
  onError: (e: string) => void;
  onRefresh: () => Promise<ExtensionInfo[]>;
  onConfigure: (spec: string) => void;
}) {
  const [spec, setSpec] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  /** What the last switch did to the conversations that were open. */
  const [note, setNote] = useState<string | null>(null);
  // The names given in Settings → Tools. A package is one thing and should be
  // called the same thing wherever it appears; the spec underneath is what it
  // is installed and removed by, and that does not change.
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    api
      .toolNames()
      .then((r) => setNames(r.names))
      .catch(() => setNames({}));
  }, []);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setNote(null);
    try {
      await fn();
      await onRefresh();
      setSpec("");
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const switchPackage = (ext: ExtensionInfo) =>
    act(ext.spec, async () => {
      const on = !ext.enabled;
      const r = await api.setExtensionEnabled(ext.spec, on);
      const parts = [`${displayName(ext.name, names)} is ${on ? "on" : "off"}.`];
      if (r.reloaded) parts.push(`${r.reloaded} open ${r.reloaded === 1 ? "conversation" : "conversations"} reloaded.`);
      if (r.waiting)
        parts.push(
          `${r.waiting} still working — they keep it as it was until /reload, or their next start.`,
        );
      setNote(parts.join(" "));
    });

  return (
    <>
      <Section
        title="Install"
        hint="Extensions, skills, prompt templates and themes. They persist across restarts."
      >
        <div className="flex gap-2">
          <input
            value={spec}
            onChange={(e) => setSpec(e.target.value)}
            onKeyDown={(e) =>
              isEnter(e) &&
              spec.trim() &&
              act("install", () => api.installPackage(spec.trim()))
            }
            placeholder="npm:@scope/package"
            className={`${inputCls} font-mono text-xs`}
          />
          <button
            disabled={!spec.trim() || busy !== null}
            onClick={() => act("install", () => api.installPackage(spec.trim()))}
            className={primaryCls}
          >
            <LuDownload className="h-4 w-4" />
            {busy === "install" ? "Installing…" : "Install"}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {SOURCES.map((s) => (
            <button
              key={s.label}
              onClick={() => setSpec(s.placeholder)}
              title={`Install from ${s.hint}`}
              className="rounded-lg bg-fg/5 px-2 py-0.5 font-mono text-[11px] text-fg-muted transition hover:bg-fg/10 hover:text-fg"
            >
              {s.label}
            </button>
          ))}
        </div>
      </Section>

      <Section title={`Installed${extensions.length ? ` (${extensions.length})` : ""}`}>
        {loading ? (
          <p className="text-sm text-fg-subtle">Reading installed packages…</p>
        ) : extensions.length === 0 ? (
          <Empty>
            Nothing installed yet.
            <p className="mt-1 text-xs text-fg-faint">
              Installed commands show up in the chat box when you type “/”.
            </p>
          </Empty>
        ) : (
          <ul className="space-y-1.5">
            {extensions.map((ext) => (
              <li
                key={ext.spec}
                className="rounded-xl border border-line bg-raised/40 px-3 py-2.5"
              >
                <div className="flex items-center gap-2">
                  <LuPuzzle className="h-4 w-4 shrink-0 text-fg-subtle" />
                  <p
                    title={ext.name}
                    className={`truncate text-sm ${ext.enabled === false ? "text-fg-subtle line-through decoration-fg-faint" : "text-fg"}`}
                  >
                    {displayName(ext.name, names)}
                  </p>
                  {ext.enabled === false && (
                    <span className="shrink-0 rounded bg-warn/10 px-1.5 py-0.5 text-[10px] text-warn">off</span>
                  )}
                  {ext.filtered && (
                    <span
                      title="Some of what it brings is switched off in settings.json. Switching it off and on again keeps that."
                      className="shrink-0 rounded bg-fg/5 px-1.5 py-0.5 text-[10px] text-fg-subtle"
                    >
                      filtered
                    </span>
                  )}
                  {ext.version && (
                    <span className="shrink-0 rounded bg-fg/5 px-1.5 py-0.5 font-mono text-[10px] text-fg-subtle">
                      v{ext.version}
                    </span>
                  )}
                  {ext.scope && (
                    <span className="shrink-0 rounded bg-fg/5 px-1.5 py-0.5 text-[10px] text-fg-subtle">
                      {ext.scope}
                    </span>
                  )}
                  {ext.enabled !== undefined && (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={ext.enabled}
                      aria-label={`${ext.enabled ? "Switch off" : "Switch on"} ${displayName(ext.name, names)}`}
                      title={
                        ext.enabled
                          ? "On — click to switch it off without uninstalling it"
                          : "Off — its commands, skills and tools are not loaded. Click to switch it on"
                      }
                      disabled={busy !== null}
                      onClick={() => switchPackage(ext)}
                      className="ml-auto shrink-0 disabled:opacity-40"
                    >
                      <span
                        className={`relative block h-5 w-9 rounded-full transition ${ext.enabled ? "bg-accent" : "bg-raised"}`}
                      >
                        <span
                          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                            ext.enabled ? "left-[1.125rem]" : "left-0.5"
                          }`}
                        />
                      </span>
                    </button>
                  )}
                  <button
                    disabled={busy !== null}
                    onClick={() => act(ext.spec, () => api.removePackage(ext.spec))}
                    title="Remove"
                    className={`${ext.enabled === undefined ? "ml-auto " : ""}shrink-0 rounded-lg p-1.5 text-fg-subtle transition hover:bg-danger/10 hover:text-danger disabled:opacity-40`}
                  >
                    {busy === ext.spec ? (
                      <LuRefreshCw className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <LuTrash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>

                {ext.description && (
                  <p className="mt-1 line-clamp-2 text-xs text-fg-subtle">{ext.description}</p>
                )}

                <div className="mt-1.5 flex items-center gap-3">
                  <span className="truncate font-mono text-[10px] text-fg-faint">{ext.spec}</span>
                  {ext.settings.length > 0 && (
                    <button
                      onClick={() => onConfigure(ext.spec)}
                      className="ml-auto shrink-0 text-[11px] text-accent hover:text-accent"
                    >
                      Configure ({ext.settings.length}) ›
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {note && (
          <p role="status" className="mt-2 text-xs text-fg-muted">
            {note}
          </p>
        )}

        <div className="mt-2.5 flex items-center gap-2">
          <button
            disabled={busy !== null}
            onClick={() => act("update", () => api.updatePackages())}
            className={btnCls}
          >
            <LuDownload className="h-4 w-4" />
            {busy === "update" ? "Updating…" : "Update all"}
          </button>
          <button onClick={() => onRefresh()} className={btnCls}>
            <LuRefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
      </Section>
    </>
  );
}

// --- one extension's own settings ---

function ExtensionPanel({
  ext,
  onError,
  onSaved,
}: {
  ext: ExtensionInfo;
  onError: (e: string) => void;
  onSaved: () => Promise<ExtensionInfo[]>;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);

  // Reset when switching between extensions, or the previous one's edits leak.
  useEffect(() => {
    setValues(
      Object.fromEntries(ext.settings.map((s) => [s.key, s.value == null ? "" : typeof s.value === "object" ? JSON.stringify(s.value) : String(s.value)]))
    );
  }, [ext.spec]);

  /**
   * Stored as what it is: a number as a number, and a switch as true or false.
   * Written as text, "false" was a string — which an extension reading
   * `if (settings.x)` takes as on.
   */
  const save = async (key: string, value: unknown = typed(ext.settings.find((s) => s.key === key)?.value, values[key])) => {
    setBusy(key);
    try {
      await api.setExtensionSetting(key, value);
      await onSaved();
      setSavedKey(key);
      setTimeout(() => setSavedKey(null), 2000);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="mb-5 flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
          <LuPuzzle className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium text-fg">{ext.name}</h3>
          {ext.description && <p className="text-xs text-fg-subtle">{ext.description}</p>}
          <p className="mt-0.5 truncate font-mono text-[10px] text-fg-faint">{ext.spec}</p>
        </div>
        {ext.homepage && (
          <a
            href={ext.homepage}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded-lg p-1.5 text-fg-subtle transition hover:bg-fg/10 hover:text-fg"
            title="Homepage"
          >
            <LuExternalLink className="h-4 w-4" />
          </a>
        )}
      </div>

      <Section title="Settings" hint="Saved into pi's settings.json. An extension reads them when a chat starts.">
        <div className="space-y-2">
          {ext.settings.map((s) => {
            const flag = typeof s.value === "boolean" || s.value === "true" || s.value === "false";
            return (
              <div key={s.key} className="rounded-xl border border-line bg-raised/40 p-3">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-fg">{humanKey(s.key)}</p>
                    <p className="font-mono text-[10px] text-fg-faint">
                      {s.key}
                      {!s.configured && " · not set, so the extension's own default"}
                    </p>
                  </div>
                  {flag && (
                    <Switch
                      on={s.value === true || s.value === "true"}
                      label={humanKey(s.key)}
                      disabled={busy !== null}
                      onChange={(on) => void save(s.key, on)}
                    />
                  )}
                  {flag && savedKey === s.key && <LuCheck className="pop-in h-4 w-4 text-ok" />}
                </div>
                {!flag && (
                  <div className="mt-2 flex gap-2">
                    <input
                      value={values[s.key] ?? ""}
                      onChange={(e) => setValues({ ...values, [s.key]: e.target.value })}
                      onKeyDown={(e) => isEnter(e) && save(s.key)}
                      inputMode={typeof s.value === "number" ? "numeric" : undefined}
                      type={/(key|token|secret|password)$/i.test(s.key) ? "password" : "text"}
                      placeholder="empty to unset"
                      className={`${inputCls} font-mono text-xs`}
                      aria-label={humanKey(s.key)}
                    />
                    <button
                      disabled={busy !== null || (values[s.key] ?? "") === (s.value == null ? "" : String(s.value))}
                      onClick={() => save(s.key)}
                      className={savedKey === s.key ? primaryCls : btnCls}
                    >
                      {busy === s.key ? (
                        <LuRefreshCw className="h-4 w-4 animate-spin" />
                      ) : savedKey === s.key ? (
                        <LuCheck className="h-4 w-4" />
                      ) : (
                        "Save"
                      )}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      <div className="flex items-start gap-2 rounded-xl border border-warn/25 bg-warn/10 px-3 py-2 text-xs text-warn/90">
        <LuTriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>
          pi publishes no schema for extension settings, so these keys are recovered by reading the
          package's source. A key built dynamically at runtime won't appear here — use Advanced to
          edit settings.json directly.
        </p>
      </div>
    </>
  );
}

// --- advanced ---

function AdvancedPanel({
  settingsPath,
  onError,
}: {
  settingsPath: string;
  onError: (e: string) => void;
}) {
  const [file, setFile] = useState<{ path: string; content: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.piSettings().then(setFile).catch((e) => onError((e as Error).message));
  }, []);

  return (
    <Section
      title="settings.json"
      hint="pi's own settings file, where installed extensions keep their configuration."
    >
      {!file ? (
        <p className="text-sm text-fg-subtle">Loading…</p>
      ) : (
        <div className="space-y-2">
          <textarea
            value={file.content}
            onChange={(e) => setFile({ ...file, content: e.target.value })}
            rows={16}
            spellCheck={false}
            className={`${inputCls} resize-y font-mono text-xs`}
          />
          <div className="flex items-center gap-2">
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api.savePiSettings(file.content);
                  setSaved(true);
                  setTimeout(() => setSaved(false), 2000);
                } catch (e) {
                  onError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
              className={primaryCls}
            >
              {saved ? (
                <>
                  <LuCheck className="h-4 w-4" /> Saved
                </>
              ) : (
                "Save file"
              )}
            </button>
            <span className="truncate font-mono text-[11px] text-fg-faint">
              {file.path || settingsPath}
            </span>
          </div>
        </div>
      )}
    </Section>
  );
}
