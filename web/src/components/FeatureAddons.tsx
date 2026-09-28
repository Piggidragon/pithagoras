import { useEffect, useId, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { LuBot, LuBrain, LuCheck, LuMinus, LuPlus, LuRefreshCw, LuTriangleAlert } from "react-icons/lu";
import { api, type Features, type SubagentMode } from "../api";
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
    restart: unless-stopped
volumes:
  understory-memory:`;

export function MemoryAddon({ onError }: { onError: (e: string) => void }) {
  const [features, setFeatures] = useFeatures(onError);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (!features) return <Loading />;
  const u = features.understory;
  const address = url ?? u.url;
  const origin = (() => {
    try {
      return new URL(u.url).origin;
    } catch {
      return null;
    }
  })();

  const change = async (enabled: boolean) => {
    setBusy(true);
    setNote(null);
    try {
      const { understory, waiting } = await api.setUnderstoryFeature(enabled ? { enabled, url: address.trim() } : { enabled });
      setFeatures({ ...features, understory });
      setUrl(null);
      setNote(reloadNote(waiting));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 space-y-3">
      <div className="rounded-xl border border-line bg-raised/40 p-3">
        <Header Icon={LuBrain} title="Memory: Understory">
          A memory that grows: plain markdown on disk, cross-linked and kept tidy, which the agent looks things up in and adds to through
          its <code>memory_*</code> tools. It runs as a container of its own; the portal only points the agent at it.
        </Header>
      </div>

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
          {u.tokenSet ? "MEMORY_UNDERSTORY_AUTH_TOKEN is set and sent as its token." : "No token (MEMORY_UNDERSTORY_AUTH_TOKEN) — only needed when Understory has an AUTH_TOKEN."}
        </span>
        {u.enabled && (
          <Link to="/agent?tab=memory" className="text-accent hover:underline">
            Read the memory on the Agent page
          </Link>
        )}
      </p>

      <SwitchRow
        title="Use Understory as the agent's memory"
        detail={
          u.enabled
            ? "On: MEMORY.md is not read while it is. The file is kept, and read again once this is off."
            : `Off: the agent's memory is MEMORY.md.${u.adapterInstalled ? "" : " Switching on also installs pi-mcp-adapter, which makes MCP servers into tools."}`
        }
        on={u.enabled}
        onChange={(enabled) => void change(enabled)}
        disabled={busy || !!u.configError}
        note={u.configError ? `mcp.json cannot be read: ${u.configError}. Fix it in Settings → MCP.` : undefined}
      />
      {u.enabled && url !== null && url.trim() !== u.url && (
        <button type="button" disabled={busy} onClick={() => void change(true)} className="text-xs text-accent hover:underline">
          Use the new address
        </button>
      )}
      {busy && (
        <p className="flex items-center gap-2 text-xs text-fg-subtle">
          <LuRefreshCw className="h-3.5 w-3.5 animate-spin" /> Applying…
        </p>
      )}
      {note && !busy && <p role="status" className="text-xs text-fg-muted">{note}</p>}

      <details className="rounded-xl border border-line p-3">
        <summary className="cursor-pointer text-xs text-fg-muted">Run Understory beside the portal</summary>
        <p className="mt-2 text-[11px] text-fg-faint">
          In the portal's compose file, or one of its own. From inside the portal's container, its address is{" "}
          <code>http://understory:3800/mcp</code> on a shared network. It needs a model to maintain the memory: any OpenAI-compatible
          endpoint, a local one included.
        </p>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-fg/5 p-2 font-mono text-[11px] text-fg-muted">{COMPOSE}</pre>
      </details>
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
