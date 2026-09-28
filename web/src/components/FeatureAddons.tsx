import { useEffect, useId, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { LuBot, LuBrain, LuCheck, LuDownload, LuMinus, LuPlus, LuRefreshCw, LuTrash2, LuTriangleAlert } from "react-icons/lu";
import { api, type Features, type ManagedUnderstory, type SubagentMode, type UnderstoryLlmChoice } from "../api";
import { confirmDialog } from "./ConfirmDialog";
import { Select } from "./Select";
import { SwitchRow, inputCls } from "./SettingsUi";

/**
 * The opt-in features: off in a fresh install, one switch each. Both are
 * written into pi's own configuration — a package, an MCP server — so what
 * the switch does can also be seen, and undone, from Extensions and MCP.
 */
function useFeatures(onError: (e: string) => void) {
  const [features, setFeatures] = useState<Features | null>(null);
  useEffect(() => {
    api.features().then(setFeatures).catch((e: Error) => onError(e.message));
  }, []);
  return [features, setFeatures] as const;
}

/** What a switch did to the chats that are open. */
function reloadNote(waiting: number): string {
  return waiting
    ? `Idle chats have it now; ${waiting === 1 ? "one busy chat picks" : `${waiting} busy chats pick`} it up once it is idle and reloaded (/reload).`
    : "Chats have it from now on.";
}

function Header({ Icon, title, children }: { Icon: typeof LuBot; title: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-fg">{title}</p>
        <p className="mt-0.5 text-[11px] text-fg-faint">{children}</p>
      </div>
    </div>
  );
}

const MODES: { value: SubagentMode; label: string; detail: string }[] = [
  {
    value: "interrupt",
    label: "Interrupt",
    detail: "The agent waits for the subagent's answer before it goes on. One agent works at a time — safe on a single GPU or a local model.",
  },
  {
    value: "background",
    label: "Background",
    detail: "The agent goes on working while the subagent runs, and its answer arrives as a message when it is done. The agent and its subagent run at once: on local hosting that is two model calls at the same time.",
  },
];

export function SubagentAddon({ onError }: { onError: (e: string) => void }) {
  const [features, setFeatures] = useFeatures(onError);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const name = useId();

  if (!features) return <Loading />;
  const s = features.subagent;

  const change = async (patch: { enabled?: boolean; mode?: SubagentMode; maxParallel?: number }) => {
    setBusy(true);
    setNote(null);
    // The choice shows at once; what the server says after is what stays.
    if (patch.mode || patch.maxParallel) setFeatures({ ...features, subagent: { ...s, ...patch } });
    try {
      const { subagent, waiting } = await api.setSubagentFeature(patch);
      setFeatures({ ...features, subagent });
      setNote(reloadNote(waiting));
    } catch (e) {
      setFeatures(features);
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 space-y-3">
      <div className="rounded-xl border border-line bg-raised/40 p-3">
        <Header Icon={LuBot} title="Subagents">
          A <code>subagent</code> tool: the agent hands a self-contained task to a second agent with a context of its own, and gets its
          answer back. You can watch it beside the chat and give it instructions while it works.
        </Header>
      </div>
      <SwitchRow
        title="Subagent tool"
        detail={s.enabled ? `Installed as a pi package (${s.source}).` : "Off: the agent has no subagent tool."}
        on={s.enabled}
        onChange={(enabled) => void change({ enabled })}
        disabled={busy || (!s.available && !s.installed)}
        note={!s.available && !s.installed ? "This install does not carry the subagent tool." : undefined}
      />
      <fieldset className="rounded-xl border border-line bg-raised/40 p-3" disabled={busy}>
        <legend className="px-1 text-xs text-fg-muted">How a subagent runs against the agent</legend>
        <div className="space-y-2">
          {MODES.map((m) => (
            <label key={m.value} className="flex cursor-pointer items-start gap-2.5 rounded-lg p-1.5 hover:bg-fg/5">
              <input
                type="radio"
                name={name}
                value={m.value}
                checked={s.mode === m.value}
                onChange={() => void change({ mode: m.value })}
                className="mt-0.5 accent-current"
              />
              <span className="min-w-0 text-sm text-fg">
                {m.label}
                <span className="mt-0.5 block text-xs text-fg-faint">{m.detail}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex items-start gap-3 rounded-xl border border-line bg-raised/40 p-3">
        <div className="min-w-0 flex-1 text-sm text-fg">
          Subagents at once
          <span className="mt-0.5 block text-xs text-fg-faint">
            Across every chat. One asked for beyond it waits for a free slot — its call waits in interrupt mode, and in the background it
            starts once another has finished. Each one is a model running.
          </span>
        </div>
        <div role="group" aria-label="Subagents at once" className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label="Fewer at once"
            disabled={busy || s.maxParallel <= 1}
            onClick={() => void change({ maxParallel: s.maxParallel - 1 })}
            className="grid h-7 w-7 place-items-center rounded-lg bg-fg/5 text-fg-muted transition hover:bg-fg/10 disabled:opacity-40"
          >
            <LuMinus className="h-3.5 w-3.5" />
          </button>
          <output aria-live="polite" className="w-6 text-center text-sm tabular-nums text-fg">{s.maxParallel}</output>
          <button
            type="button"
            aria-label="More at once"
            disabled={busy || s.maxParallel >= MAX_PARALLEL}
            onClick={() => void change({ maxParallel: s.maxParallel + 1 })}
            className="grid h-7 w-7 place-items-center rounded-lg bg-fg/5 text-fg-muted transition hover:bg-fg/10 disabled:opacity-40"
          >
            <LuPlus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {busy && (
        <p className="flex items-center gap-2 text-xs text-fg-subtle">
          <LuRefreshCw className="h-3.5 w-3.5 animate-spin" /> Applying…
        </p>
      )}
      {note && !busy && <p role="status" className="text-xs text-fg-muted">{note}</p>}
    </div>
  );
}

/** As many as the tool allows at once. */
const MAX_PARALLEL = 16;

const COMPOSE = `services:
  understory:
    image: ghcr.io/thecodacus/understory:latest
    ports: ["3800:3800"]
    volumes: [understory-memory:/bundle]
    environment:
      BUNDLE_ROOT: /bundle
      LLM_API_BASE_URL: \${LLM_API_BASE_URL}
      LLM_API_KEY: \${LLM_API_KEY}
      LLM_API_FORMAT: openai
      LLM_MODEL: \${LLM_MODEL}
      # DREAM_INTERVAL: 6h
    restart: unless-stopped
volumes:
  understory-memory:`;

/** How often Understory tidies its memory up, as it reads it; empty for never. */
const DREAMS: { value: string; label: string }[] = [
  { value: "", label: "Never" },
  { value: "1h", label: "Every hour" },
  { value: "6h", label: "Every 6 hours" },
  { value: "12h", label: "Every 12 hours" },
  { value: "1d", label: "Every day" },
  { value: "7d", label: "Every week" },
];

/** The form's copy of the settings, before they are saved. */
interface Draft {
  source: "provider" | "custom";
  provider: string;
  providerModel: string;
  baseUrl: string;
  model: string;
  format: "openai" | "anthropic";
  /** Typed anew; empty keeps the one saved. */
  apiKey: string;
  dreamInterval: string;
}

function draftOf(m: ManagedUnderstory): Draft {
  const llm = m.config.llm;
  const first = m.providers[0];
  return {
    source: llm?.source ?? (first ? "provider" : "custom"),
    provider: llm?.source === "provider" ? llm.provider : (first?.id ?? ""),
    providerModel: llm?.source === "provider" ? llm.model : (first?.models[0] ?? ""),
    baseUrl: llm?.source === "custom" ? llm.baseUrl : "",
    model: llm?.source === "custom" ? llm.model : "",
    format: llm?.source === "custom" ? llm.format : "openai",
    apiKey: "",
    dreamInterval: m.config.dreamInterval,
  };
}

function choiceOf(d: Draft): UnderstoryLlmChoice | null {
  if (d.source === "provider") return d.provider && d.providerModel ? { source: "provider", provider: d.provider, model: d.providerModel } : null;
  if (!d.baseUrl.trim() || !d.model.trim()) return null;
  return { source: "custom", baseUrl: d.baseUrl.trim(), model: d.model.trim(), format: d.format, ...(d.apiKey ? { apiKey: d.apiKey } : {}) };
}

const INSTALLING = "Installing Understory…";

export function MemoryAddon({ onError }: { onError: (e: string) => void }) {
  const [features, setFeatures] = useFeatures(onError);
  const [url, setUrl] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // While it is installed, and its image pulled, what the daemon says.
  const watching = Boolean(features?.understory.managed.pulling.active) || busy === INSTALLING;
  useEffect(() => {
    if (!watching) return;
    const t = setInterval(() => api.features().then((f) => setFeatures(f)).catch(() => {}), 1500);
    return () => clearInterval(t);
  }, [watching]);

  if (!features) return <Loading />;
  const u = features.understory;
  const m = u.managed;
  const form = draft ?? draftOf(m);
  const edit = (patch: Partial<Draft>) => setDraft({ ...form, ...patch });
  const choice = choiceOf(form);
  const runsHere = m.container !== "absent";
  const address = url ?? u.url;
  const origin = (() => {
    try {
      return new URL(u.url).origin;
    } catch {
      return null;
    }
  })();

  /** Runs one change, and takes what the server says the state is after it. */
  const act = async (what: string, run: () => Promise<{ understory: Features["understory"]; waiting?: number }>) => {
    setBusy(what);
    setNote(null);
    try {
      const { understory, waiting } = await run();
      setFeatures({ ...features, understory });
      if (waiting !== undefined) setNote(reloadNote(waiting));
      // The sidebar has the Memory page while Understory is the agent's memory.
      window.dispatchEvent(new Event("features-changed"));
      return true;
    } catch (e) {
      onError((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const saveSettings = async () => {
    if (!choice) return;
    const ok = await act(runsHere ? "Restarting Understory…" : "Saving…", () =>
      api.setUnderstoryConfig({ llm: choice, dreamInterval: form.dreamInterval }),
    );
    if (ok) setDraft(null);
  };
  const saved = !draft;
  const providerModels = m.providers.find((p) => p.id === form.provider)?.models ?? [];

  return (
    <div className="mt-4 space-y-3">
      <div className="rounded-xl border border-line bg-raised/40 p-3">
        <Header Icon={LuBrain} title="Memory: Understory">
          A memory that grows: plain markdown on disk, cross-linked and kept tidy, which the agent looks things up in and adds to through
          its <code>memory_*</code> tools. The portal can run it for you, or point the agent at one you run yourself.
        </Header>
      </div>

      {m.available && (
        <section aria-label="Understory run here" className="space-y-3 rounded-xl border border-line bg-raised/40 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-fg">Run it here</p>
            {runsHere && (
              <span className={`inline-flex items-center gap-1 text-[11px] ${m.container === "running" ? "text-ok" : "text-fg-subtle"}`}>
                <LuCheck className="h-3 w-3" /> {m.container === "running" ? "running" : "stopped"}
              </span>
            )}
          </div>
          <p className="text-[11px] text-fg-faint">
            In a container of its own beside the portal, with its memory in a volume that stays when it is removed or made again.
          </p>

          <fieldset disabled={busy !== null} className="space-y-3">
            <legend className="text-xs text-fg-muted">The model that keeps the memory</legend>
            <div role="radiogroup" aria-label="Where the model comes from" className="flex gap-1 rounded-lg bg-fg/5 p-0.5 text-xs">
              {(["provider", "custom"] as const).map((src) => (
                <button
                  key={src}
                  type="button"
                  role="radio"
                  aria-checked={form.source === src}
                  disabled={src === "provider" && !m.providers.length}
                  onClick={() => edit({ source: src })}
                  className={`flex-1 rounded-md px-2 py-1 transition disabled:opacity-40 ${form.source === src ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg"}`}
                >
                  {src === "provider" ? "A provider set up here" : "An address of its own"}
                </button>
              ))}
            </div>
            {form.source === "provider" ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="text-xs text-fg-muted">
                  Provider
                  <Select
                    aria-label="Provider"
                    size="sm"
                    className="mt-1 w-full"
                    value={form.provider}
                    onChange={(provider) => edit({ provider, providerModel: m.providers.find((p) => p.id === provider)?.models[0] ?? "" })}
                    options={m.providers.map((p) => ({ value: p.id, label: p.id }))}
                  />
                </div>
                <div className="text-xs text-fg-muted">
                  Model
                  <Select
                    aria-label="Model"
                    size="sm"
                    className="mt-1 w-full"
                    value={form.providerModel}
                    onChange={(providerModel) => edit({ providerModel })}
                    options={providerModels.map((id) => ({ value: id, label: id }))}
                  />
                </div>
                <p className="text-[11px] text-fg-faint sm:col-span-2">Its address and key are taken from the provider each time Understory is started.</p>
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-xs text-fg-muted sm:col-span-2">
                  API address
                  <input
                    value={form.baseUrl}
                    onChange={(e) => edit({ baseUrl: e.target.value })}
                    placeholder="https://api.deepseek.com/v1"
                    spellCheck={false}
                    className={`${inputCls} mt-1 font-mono text-xs`}
                  />
                </label>
                <label className="text-xs text-fg-muted">
                  API key
                  <input
                    type="password"
                    value={form.apiKey}
                    onChange={(e) => edit({ apiKey: e.target.value })}
                    placeholder={m.config.llm?.source === "custom" && m.config.llm.hasKey ? "saved — type to replace" : "none needed for a local server"}
                    autoComplete="off"
                    className={`${inputCls} mt-1 text-xs`}
                  />
                </label>
                <label className="text-xs text-fg-muted">
                  Model
                  <input
                    value={form.model}
                    onChange={(e) => edit({ model: e.target.value })}
                    placeholder="deepseek-chat"
                    spellCheck={false}
                    className={`${inputCls} mt-1 font-mono text-xs`}
                  />
                </label>
                <div className="text-xs text-fg-muted">
                  Format
                  <Select<"openai" | "anthropic">
                    aria-label="Format"
                    size="sm"
                    className="mt-1 w-full"
                    value={form.format}
                    onChange={(format) => edit({ format })}
                    options={[
                      { value: "openai", label: "OpenAI-compatible" },
                      { value: "anthropic", label: "Anthropic" },
                    ]}
                  />
                </div>
              </div>
            )}

            <div className="text-xs text-fg-muted">
              Tidying up
              <Select
                aria-label="Tidying up"
                size="sm"
                className="mt-1 w-full"
                value={form.dreamInterval}
                onChange={(dreamInterval) => edit({ dreamInterval })}
                options={(DREAMS.some((d) => d.value === form.dreamInterval) ? DREAMS : [...DREAMS, { value: form.dreamInterval, label: `Every ${form.dreamInterval}` }]).map((d) => ({ value: d.value, label: d.label }))}
              />
              <p className="mt-1 text-[11px] text-fg-faint">
                Understory's own pass over the memory — merging, linking and pruning notes with the model above, which costs tokens each
                time. The first comes one interval after Understory starts, and starting it again begins the count anew.
              </p>
            </div>

            {(!saved || !m.config.llm) && (
              <button
                type="button"
                disabled={!choice}
                onClick={() => void saveSettings()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent/12 px-3 py-1.5 text-xs text-accent ring-1 ring-inset ring-accent/25 transition hover:bg-accent/20 disabled:opacity-40"
              >
                {runsHere ? "Save and restart Understory" : "Save"}
              </button>
            )}
          </fieldset>

          <div className="flex flex-wrap gap-2 border-t border-line pt-3">
            {!runsHere ? (
              <button
                type="button"
                disabled={busy !== null || !m.config.llm || !saved}
                title={!m.config.llm ? "Choose and save the model first" : undefined}
                onClick={() => void act(INSTALLING, () => api.installUnderstory())}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent/12 px-3 py-1.5 text-xs text-accent ring-1 ring-inset ring-accent/25 transition hover:bg-accent/20 disabled:opacity-40"
              >
                <LuDownload className="h-3.5 w-3.5" /> Install and use as the agent's memory
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void act(m.container === "running" ? "Stopping…" : "Starting…", () => api.understoryAction(m.container === "running" ? "stop" : "start"))}
                  className="rounded-lg bg-fg/5 px-3 py-1.5 text-xs text-fg-muted transition hover:bg-fg/10"
                >
                  {m.container === "running" ? "Stop" : "Start"}
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void act("Removing…", () => api.removeUnderstory())}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-fg/5 px-3 py-1.5 text-xs text-fg-muted transition hover:bg-danger/10 hover:text-danger"
                >
                  <LuTrash2 className="h-3.5 w-3.5" /> Remove
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={async () => {
                    const ok = await confirmDialog({
                      title: "Forget the whole memory?",
                      message: "Understory is removed and its volume deleted, with every note the agent kept in it. This cannot be undone.",
                      confirmLabel: "Forget it",
                      danger: true,
                      deletes: true,
                    });
                    if (ok) await act("Removing…", () => api.removeUnderstory(true));
                  }}
                  className="rounded-lg px-3 py-1.5 text-xs text-fg-subtle transition hover:bg-danger/10 hover:text-danger"
                >
                  Remove and forget the memory
                </button>
              </>
            )}
          </div>
          {m.pulling.active && <p className="font-mono text-[11px] text-fg-faint">{m.pulling.line}</p>}
          {m.pulling.error && <p className="text-[11px] text-warn">{m.pulling.error}</p>}
          {!runsHere && <p className="text-[11px] text-fg-faint">Installing downloads its image the first time.</p>}
        </section>
      )}

      {!runsHere && (
        <details open={!m.available} className="rounded-xl border border-line p-3">
          <summary className="cursor-pointer text-xs text-fg-muted">{m.available ? "Or use one you run yourself" : "Use one you run yourself"}</summary>
          <div className="mt-3 space-y-2">
            {!m.available && <p className="text-[11px] text-fg-faint">The portal cannot reach Docker here, so it cannot run Understory itself.</p>}
            <label className="block text-xs text-fg-muted">
              Understory's MCP address
              <input
                value={address}
                onChange={(e) => setUrl(e.target.value)}
                spellCheck={false}
                aria-label="Understory's MCP address"
                className={`${inputCls} mt-1.5 font-mono text-xs`}
              />
            </label>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
              {u.reachable ? (
                <span className="inline-flex items-center gap-1 text-ok">
                  <LuCheck className="h-3 w-3" /> Something answers there
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-warn">
                  <LuTriangleAlert className="h-3 w-3" /> Nothing answers at {origin ?? u.url} — start Understory first
                </span>
              )}
              <span className="text-fg-faint">
                {u.tokenSet ? "A token is set and sent." : "No token (MEMORY_UNDERSTORY_AUTH_TOKEN) — only needed when Understory has an AUTH_TOKEN."}
              </span>
            </p>
            <p className="text-[11px] text-fg-faint">
              Its model and how often it tidies up are set in its own environment (<code>LLM_*</code>, <code>DREAM_INTERVAL</code>):
            </p>
            <pre className="overflow-x-auto rounded-lg bg-fg/5 p-2 font-mono text-[11px] text-fg-muted">{COMPOSE}</pre>
          </div>
        </details>
      )}

      <SwitchRow
        title="Use Understory as the agent's memory"
        detail={
          u.enabled
            ? "On: MEMORY.md is not read while it is. The file is kept, and read again once this is off."
            : `Off: the agent's memory is MEMORY.md.${u.adapterInstalled ? "" : " Switching on also installs pi-mcp-adapter, which makes MCP servers into tools."}`
        }
        on={u.enabled}
        onChange={(enabled) => void act(enabled ? "Switching on…" : "Switching off…", () => api.setUnderstoryFeature(enabled && !runsHere ? { enabled, url: address.trim() } : { enabled }))}
        disabled={busy !== null || !!u.configError}
        note={u.configError ? `mcp.json cannot be read: ${u.configError}. Fix it in Settings → MCP.` : undefined}
      />
      {u.enabled && !runsHere && url !== null && url.trim() !== u.url && (
        <button type="button" disabled={busy !== null} onClick={() => void act("Switching…", () => api.setUnderstoryFeature({ enabled: true, url: address.trim() }))} className="text-xs text-accent hover:underline">
          Use the new address
        </button>
      )}
      {u.enabled && (
        <Link to="/memory" className="inline-block text-xs text-accent hover:underline">
          Read the memory
        </Link>
      )}
      {busy && (
        <p className="flex items-center gap-2 text-xs text-fg-subtle">
          <LuRefreshCw className="h-3.5 w-3.5 animate-spin" /> {busy}
        </p>
      )}
      {note && !busy && <p role="status" className="text-xs text-fg-muted">{note}</p>}
    </div>
  );
}

function Loading() {
  return (
    <p className="mt-4 flex items-center gap-2 text-sm text-fg-subtle">
      <LuRefreshCw className="h-3.5 w-3.5 animate-spin" /> Loading…
    </p>
  );
}
