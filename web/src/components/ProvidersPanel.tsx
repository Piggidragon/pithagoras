import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { IconType } from "react-icons";
import {
  LuBrain, LuCheck, LuCloud, LuCpu, LuEye, LuHardDrive, LuKeyRound, LuPackage, LuPencil, LuPlus,
  LuRefreshCw, LuRoute, LuSearch, LuServer, LuShuffle, LuTrash2, LuWandSparkles, LuX,
} from "react-icons/lu";
import { api, type ProviderInfo, type ProviderKind, type ProviderModel, type ProviderStatus, type ProvidersView } from "../api";
import { forget, useCached } from "../settings-cache";
import { packageName } from "../package-names";
import { PackageCatalog } from "./PackageCatalog";
import { parseWindow } from "../context-window";
import { looksComplete } from "../provider-address";
import { confirmDialog } from "./ConfirmDialog";
import { formatTokens } from "../transcript";
import { Select } from "./Select";
import { Empty, Field, Section, btnCls, ghostCls, inputCls, primaryCls } from "./SettingsUi";

const KIND_ICONS: Record<ProviderKind, IconType> = {
  "llama-cpp": LuCpu, "llama-swap": LuShuffle, ollama: LuHardDrive, openrouter: LuRoute, hosted: LuCloud, custom: LuServer,
};

/** A provider's kind, said as its icon. */
export function KindIcon({ kind, className = "h-4 w-4" }: { kind: ProviderKind; className?: string }) {
  const Icon = KIND_ICONS[kind];
  return <Icon className={className} />;
}

/**
 * Settings → Models: where the models come from.
 *
 * A provider is picked from a list — llama.cpp, llama-swap, Ollama,
 * OpenRouter, another hosted service, or any OpenAI-compatible server — and
 * set up by its address or its key. A server is asked for its models as soon
 * as its address is typed, so what it has can be ticked rather than spelled
 * out. Everything lands in pi's own files, as pi would write it.
 */
export function ProvidersPanel({ onError, onSetup }: { onError: (e: string) => void; onSetup?: () => void }) {
  const { value: view, reload } = useCached("providers", api.providers, { onError: (e) => onError(e.message) });
  const status = useProviderStatus();
  /** The provider being edited, or "new" for one being added. */
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const installed = useInstalledPackages();
  /** What a change did besides, to be told: a copy kept of a file it rewrote. */
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    // What the defaults offer changes with the providers.
    forget("models");
    await reload();
    status.check();
  };

  const remove = async (p: ProviderInfo) => {
    const ok = await confirmDialog({
      title: `Remove ${p.label}?`,
      message: p.endpoint
        ? `Its ${p.models.length === 1 ? "model goes" : `${p.models.length} models go`} from every model menu. Chats that use one keep their history but need another model to go on.`
        : "Its key is deleted from pi's auth.json. A key in the environment is not touched.",
      confirmLabel: "Remove",
      danger: true,
      deletes: true,
    });
    if (!ok) return;
    setBusy(p.id);
    try {
      const r = await api.removeProvider(p.id);
      setNotice(r.note ?? null);
      await load();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!view) return <ProvidersSkeleton />;

  const saved = async (note?: string) => { setEditing(null); setNotice(note ?? null); await load(); };
  // Names in use in pi's files. One keyed only from the environment is not:
  // a key can still be stored for it, under the name pi knows it by.
  const ids = new Set(view.providers.filter((p) => p.key.source !== "environment").map((p) => p.id));

  return (
    <>
      <Section
        title="Providers"
        hint="Where the agent's models come from. Each one's models appear in the model menu under the chat box."
        action={editing !== "new" && (
          <div className="flex items-center gap-1.5">
            {onSetup && (
              <button type="button" onClick={onSetup} className={ghostCls} title="Provider, model and what the agent can do, one step at a time">
                <LuWandSparkles className="h-3.5 w-3.5" /> Setup assistant
              </button>
            )}
            <button type="button" onClick={() => setEditing("new")} className={primaryCls}>
              <LuPlus className="h-4 w-4" /> Add a provider
            </button>
          </div>
        )}
      >
        {notice && <p role="status" className="float-in mb-2 rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn">{notice}</p>}
        {editing === "new" && (
          <ProviderEditor view={view} taken={ids} onCancel={() => setEditing(null)} onSaved={saved} onError={onError} onInstalled={() => void load()} />
        )}
        {view.providers.length === 0 && editing !== "new" ? (
          <Empty>
            No provider yet.
            <p className="mt-1 text-xs text-fg-faint">Add a llama.cpp server, Ollama, OpenRouter or any OpenAI-compatible endpoint.</p>
          </Empty>
        ) : (
          <ul className="stagger-in space-y-2">
            {view.providers.map((p) => (
              <li key={p.id}>
                {editing === p.id ? (
                  <ProviderEditor view={view} provider={p} taken={ids} onCancel={() => setEditing(null)} onSaved={saved} onError={onError} />
                ) : (
                  <ProviderCard
                    provider={p}
                    status={status.of[p.id]}
                    busy={busy === p.id}
                    onEdit={p.key.source === "environment" || p.key.source === "account" ? undefined : () => setEditing(p.id)}
                    onRemove={p.key.source === "environment" ? undefined : () => void remove(p)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Provider packages"
        hint="A service pi does not know of on its own — a gateway, a proxy, a new host — often comes as a package that adds it."
        action={!browsing && (
          <button type="button" onClick={() => setBrowsing(true)} className={ghostCls}>
            <LuPackage className="h-3.5 w-3.5" /> Browse
          </button>
        )}
      >
        {browsing ? (
          <div className="float-in">
            <PackageCatalog topic="provider" installed={installed.names} onInstalled={() => { void installed.reload(); void load(); }} onError={onError} limit={6} />
          </div>
        ) : null}
      </Section>
    </>
  );
}

/** Whether each server answers, asked on opening and every half minute while the page is open. */
export function useProviderStatus() {
  const { value, reload } = useCached("provider-status", () => api.providerStatus().then((r) => r.status), { freshMs: 10_000 });
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === "visible" && void reload(), 30_000);
    return () => clearInterval(t);
  }, [reload]);
  return { of: value ?? {}, known: value !== undefined, check: () => void reload() };
}

/** The npm names of what is installed, to mark in a catalogue. */
export function useInstalledPackages() {
  const { value, reload } = useCached("extensions", api.extensions, { freshMs: 30_000 });
  const names = useMemo(
    () => new Set((value?.extensions ?? []).flatMap((e) => [e.name, packageName(e.spec)])),
    [value],
  );
  return { names, reload };
}

function ProvidersSkeleton() {
  return (
    <div className="skeleton-group space-y-2" aria-label="Loading providers">
      <div className="skeleton h-4 w-40" />
      <div className="skeleton h-20 w-full" />
      <div className="skeleton h-20 w-full" />
    </div>
  );
}

const presetLabel = (kind: ProviderKind) =>
  ({ "llama-cpp": "llama.cpp", "llama-swap": "llama-swap", ollama: "Ollama", openrouter: "OpenRouter", hosted: "Hosted", custom: "Custom" })[kind];

function ProviderCard({ provider: p, status, busy, onEdit, onRemove }: { provider: ProviderInfo; status?: ProviderStatus; busy: boolean; onEdit?: () => void; onRemove?: () => void }) {
  const [open, setOpen] = useState(false);
  const shown = open ? p.models : p.models.slice(0, 6);
  return (
    <div className="group rounded-xl border border-line bg-raised/40 p-3 transition hover:border-line/80 hover:bg-raised/60">
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
          <KindIcon kind={p.kind} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="truncate text-sm font-medium text-fg">{p.label}</p>
            {p.label !== presetLabel(p.kind) && (
              <span className="rounded bg-fg/5 px-1.5 py-0.5 text-[10px] text-fg-subtle">{presetLabel(p.kind)}</span>
            )}
            {p.key.set && (
              <span className="inline-flex items-center gap-1 rounded bg-ok/10 px-1.5 py-0.5 text-[10px] text-ok" title={p.key.source === "environment" ? "pi finds its key in the environment" : "A key is stored for it"}>
                <LuKeyRound className="h-2.5 w-2.5" />
                {p.key.source === "environment" ? "key from the environment" : p.key.hint ?? "key set"}
              </span>
            )}
          </div>
          {p.baseUrl && (
            <div className="mt-0.5 flex min-w-0 items-center gap-2">
              <p className="min-w-0 truncate font-mono text-[11px] text-fg-faint">{p.baseUrl}</p>
              <StatusBadge status={status} />
            </div>
          )}
          {status?.state === "down" && status.message && <p className="float-in mt-1 text-[11px] text-danger/90">{status.message}</p>}
          {status?.state === "up" && !!status.missing?.length && (
            <p className="float-in mt-1 text-[11px] text-warn">
              {status.missing.length === 1 ? `${status.missing[0]} is` : `${status.missing.length} chosen models are`} not listed by the server any more.
            </p>
          )}
          {!p.endpoint && <p className="mt-0.5 text-[11px] text-fg-faint">Every model pi knows of from this service is in the model menu.</p>}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 opacity-70 transition group-hover:opacity-100">
          {onEdit && (
            <button type="button" onClick={onEdit} title="Edit" aria-label={`Edit ${p.label}`} className="rounded-lg p-1.5 text-fg-subtle transition hover:bg-fg/10 hover:text-fg">
              <LuPencil className="h-3.5 w-3.5" />
            </button>
          )}
          {onRemove && (
            <button type="button" onClick={onRemove} disabled={busy} title="Remove" aria-label={`Remove ${p.label}`} className="rounded-lg p-1.5 text-fg-subtle transition hover:bg-danger/10 hover:text-danger disabled:opacity-40">
              {busy ? <LuRefreshCw className="h-3.5 w-3.5 animate-spin" /> : <LuTrash2 className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      </div>
      {p.endpoint && (
        <div className="mt-2.5 flex flex-wrap gap-1.5 pl-12">
          {p.models.length === 0 && <span className="text-xs text-warn">No models chosen yet — edit it to pick some.</span>}
          {shown.map((m) => <ModelChip key={m.id} model={m} loaded={status?.loaded?.includes(m.id)} missing={status?.missing?.includes(m.id)} />)}
          {p.models.length > 6 && (
            <button type="button" onClick={() => setOpen(!open)} className="rounded-md px-1.5 py-0.5 text-[11px] text-accent hover:bg-accent/10">
              {open ? "Fewer" : `${p.models.length - 6} more`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Whether a server answers: a dot and a word, and how quickly. The same width
 * whether it is known yet or not, so nothing beside it moves when it is.
 */
export function StatusBadge({ status }: { status?: ProviderStatus }) {
  const state = status?.state ?? "checking";
  const text = state === "up" ? `Online${status?.ms !== undefined ? ` · ${status.ms} ms` : ""}` : state === "down" ? "Offline" : "Checking…";
  return (
    <span
      className={`provider-status is-${state} inline-flex shrink-0 items-center gap-1.5 rounded-full px-1.5 py-0.5 text-[10px]`}
      title={state === "down" ? status?.message : state === "up" ? `Answered in ${status?.ms} ms, listing ${status?.listed ?? 0} models` : "Asking the server"}
    >
      <i aria-hidden="true" />
      {text}
    </span>
  );
}

function ModelChip({ model: m, loaded, missing }: { model: ProviderModel; loaded?: boolean; missing?: boolean }) {
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] ${loaded ? "bg-ok/10 text-ok" : missing ? "bg-warn/10 text-warn line-through decoration-warn/50" : "bg-fg/5 text-fg-muted"}`}
      title={loaded ? `${m.id} — loaded now` : missing ? `${m.id} — the server does not list it now` : m.id}
    >
      {loaded && <i className="provider-loaded-dot" aria-hidden="true" />}
      <span className="truncate">{m.name ?? m.id}</span>
      {m.contextWindow && <span className="font-mono text-[10px] text-fg-faint">{formatTokens(m.contextWindow)}</span>}
      {m.input?.includes("image") && <LuEye className="h-3 w-3 text-fg-faint" aria-label="Sees images" />}
      {m.reasoning && <LuBrain className="h-3 w-3 text-fg-faint" aria-label="Thinks" />}
    </span>
  );
}

/**
 * A model row in the editor: whether it is kept, and what is known about it.
 * `own` is one saved before or added by name — not only found at an address.
 */
type Row = ProviderModel & { keep: boolean; found: boolean; own: boolean; ctxText: string };

const toRow = (m: ProviderModel, keep: boolean, found: boolean, own = false): Row => ({ ...m, keep, found, own, ctxText: m.contextWindow ? m.contextWindow.toLocaleString("en-US") : "" });

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** Not a kind of server: a package that brings its own. */
type EditorKind = ProviderKind | "package";

export function ProviderEditor({ view, provider, taken, onCancel, onSaved, onError, onInstalled, embedded }: {
  view: ProvidersView;
  provider?: ProviderInfo;
  /** Names already set up: a new provider cannot take one. */
  taken: Set<string>;
  onCancel: () => void;
  /** Saved; `note` says what else came of it. */
  onSaved: (note?: string) => void;
  onError: (e: string) => void;
  /** A package was installed: the models it brings are there to be fetched. */
  onInstalled?: () => void;
  /** Part of another page — the setup assistant — rather than a card in the list. */
  embedded?: boolean;
}) {
  const editing = !!provider;
  const [choice, setChoice] = useState<EditorKind>(provider?.kind ?? "llama-cpp");
  const kind: ProviderKind = choice === "package" ? "custom" : choice;
  const preset = view.presets.find((p) => p.kind === kind)!;
  const installed = useInstalledPackages();
  const hostedChoices = view.hosted.filter((h) => h.id !== "openrouter");
  const [id, setId] = useState(provider?.id ?? uniqueId(preset.id, taken));
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? preset.baseUrl ?? "");
  const [apiType, setApiType] = useState(provider?.api ?? "openai-completions");
  const [key, setKey] = useState("");
  const [rows, setRows] = useState<Row[]>(() => (provider?.models ?? []).map((m) => toRow(m, true, false, true)));
  const [probe, setProbe] = useState<{ state: "idle" | "asking" | "ok" | "failed"; message?: string }>({ state: "idle" });
  const [manual, setManual] = useState("");
  const [saving, setSaving] = useState(false);
  const probeSeq = useRef(0);
  /** The address the server last answered at, as it said it: put in the field, it is not asked again. */
  const answered = useRef<string | null>(null);

  // A new provider's name and address follow the kind picked, until they are typed in.
  const pickKind = (picked: EditorKind) => {
    setChoice(picked);
    answered.current = null;
    if (picked === "package") return;
    const next = picked;
    const p = view.presets.find((x) => x.kind === next)!;
    if (!editing) {
      // A hosted service is filed under the name pi knows it by — "openrouter-2" would be no service at all.
      setId(next === "hosted" ? "" : p.endpoint ? uniqueId(p.id, taken) : p.id);
      setBaseUrl(p.baseUrl ?? "");
      setRows([]);
      setProbe({ state: "idle" });
    }
  };

  /** Asks the server for its models and merges them with those already chosen. */
  const ask = async (url = baseUrl) => {
    if (!preset.endpoint || !url.trim()) return;
    const seq = ++probeSeq.current;
    setProbe({ state: "asking" });
    try {
      const r = await api.probeProvider({ kind, baseUrl: url, apiKey: key || undefined, id: editing ? provider!.id : undefined });
      if (seq !== probeSeq.current) return;
      answered.current = r.baseUrl;
      setRows((before) => {
        const known = new Map(before.map((row) => [row.id, row]));
        const merged: Row[] = r.models.map((m) => {
          const had = known.get(m.id);
          known.delete(m.id);
          // What is already chosen keeps what was set for it; a new server has everything ticked.
          return had ? { ...had, found: true } : toRow(m, !editing || before.length === 0, true);
        });
        // What this server does not list: one saved or named stays, marked as
        // not listed; one only found at an address asked before goes with it.
        return [...merged, ...[...known.values()].filter((row) => row.own).map((row) => ({ ...row, found: false }))];
      });
      setProbe({ state: "ok", message: r.models.length ? `${r.models.length} model${r.models.length === 1 ? "" : "s"} found` : "It answered, but lists no models — add them by name below." });
      if (r.baseUrl !== url.trim()) setBaseUrl(r.baseUrl);
    } catch (e) {
      if (seq !== probeSeq.current) return;
      setProbe({ state: "failed", message: (e as Error).message });
    }
  };

  // Asked as soon as there is an address: while typing, a moment after the last key.
  useEffect(() => {
    // What was asked before this change is about another address now: its answer is not taken.
    probeSeq.current++;
    setProbe((p) => (p.state === "asking" ? { state: "idle" } : p));
    if (choice === "package" || !preset.endpoint || !looksComplete(baseUrl) || baseUrl.trim() === answered.current) return;
    const t = setTimeout(() => void ask(), editing && probe.state === "idle" ? 0 : 700);
    return () => clearTimeout(t);
  }, [baseUrl, kind]);

  const setRow = (rowId: string, patch: Partial<Row>) => setRows((all) => all.map((r) => (r.id === rowId ? { ...r, ...patch } : r)));
  const addManual = () => {
    const name = manual.trim();
    if (!name || rows.some((r) => r.id === name)) return;
    setRows([...rows, toRow({ id: name }, true, false, true)]);
    setManual("");
  };

  const kept = rows.filter((r) => r.keep);
  const badCtx = kept.find((r) => parseWindow(r.ctxText).kind === "bad");
  const needsKey = preset.key === "required" && !key.trim() && !provider?.key.set;
  const clash = !editing && taken.has(id.trim());
  const canSave = !!id.trim() && !clash && !saving && !badCtx && !needsKey && (!preset.endpoint || (!!baseUrl.trim() && kept.length > 0));

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.saveProvider(id.trim(), {
        kind,
        adding: !editing,
        ...(preset.endpoint ? {
          baseUrl, api: kind === "custom" ? apiType : undefined,
          models: kept.map((r) => {
            const ctx = parseWindow(r.ctxText);
            return { id: r.id, name: r.name, contextWindow: ctx.kind === "ok" ? ctx.tokens : undefined, maxTokens: r.maxTokens, input: r.input, reasoning: r.reasoning };
          }),
        } : {}),
        ...(key.trim() ? { apiKey: key.trim() } : {}),
      });
      onSaved(r.note);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const kindOptions: { value: EditorKind; label: ReactNode; text: string; hint: string }[] = [
    ...view.presets.map((p) => ({
      value: p.kind as EditorKind,
      label: <span className="inline-flex items-center gap-2"><KindIcon kind={p.kind} className="h-3.5 w-3.5 text-accent" />{p.label}</span>,
      text: p.label,
      hint: p.description,
    })),
    {
      value: "package",
      label: <span className="inline-flex items-center gap-2"><LuPackage className="h-3.5 w-3.5 text-accent" />From a package</span>,
      text: "From a package",
      hint: "A service pi does not know of, added by a pi package from npm — LiteLLM, Cohere, gateways.",
    },
  ];

  return (
    <div className={embedded ? "" : "float-in mb-2 rounded-xl border border-accent/30 bg-raised/50 p-4 shadow-lg shadow-black/10"}>
      {!embedded && (
        <div className="mb-3 flex items-center gap-2">
          <h4 className="text-sm font-medium text-fg">{editing ? `Edit ${provider!.label}` : "Add a provider"}</h4>
          <button type="button" onClick={onCancel} aria-label="Cancel" className="ml-auto rounded-lg p-1 text-fg-subtle transition hover:bg-fg/10 hover:text-fg">
            <LuX className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kind" className="sm:col-span-2">
          <Select<EditorKind> className="w-full" aria-label="Kind of provider" value={choice} options={kindOptions} onChange={pickKind} disabled={editing} />
          {!editing && <p className="mt-1 text-[11px] text-fg-faint">{kindOptions.find((o) => o.value === choice)?.hint}</p>}
        </Field>
      </div>

      {choice === "package" ? (
        <div key="package" className="float-in mt-3">
          <PackageCatalog topic="provider" installed={installed.names} onInstalled={() => { void installed.reload(); forget("models"); onInstalled?.(); }} onError={onError} limit={5} />
          <p className="mt-2 text-[11px] text-fg-faint">
            A package's models show in the model menu of chats started after it is installed. Most want a key or an
            address of their own: they appear under Extension settings when it can be set there.
          </p>
        </div>
      ) : (
      <>
      <div key={kind} className="mt-3 grid gap-3 sm:grid-cols-2">

        {kind === "hosted" ? (
          <Field label="Service" className="sm:col-span-2">
            <Select
              className="w-full"
              aria-label="Hosted service"
              value={id}
              placeholder="Choose a service…"
              disabled={editing}
              options={hostedChoices.map((h) => ({ value: h.id, label: h.name, hint: taken.has(h.id) && !editing ? "Already set up" : undefined, disabled: taken.has(h.id) && !editing }))}
              onChange={setId}
            />
          </Field>
        ) : kind !== "openrouter" && (
          <Field label="Name" hint={editing ? "What its models are filed under. Fixed once saved." : "What its models are filed under in the model menu."}>
            <input value={id} onChange={(e) => setId(e.target.value.replace(/\s+/g, "-"))} disabled={editing} spellCheck={false} className={`${inputCls} font-mono`} aria-label="Provider name" />
          </Field>
        )}

        {preset.endpoint && (
          <Field label="Address" hint={kind === "custom" ? "The base of its OpenAI API, usually ending in /v1." : undefined}>
            <div className="relative">
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={preset.baseUrl ?? "https://host/v1"}
                spellCheck={false}
                className={`${inputCls} pr-9 font-mono`}
                aria-label="Server address"
              />
              <ProbeMark state={probe.state} />
            </div>
          </Field>
        )}

        {kind === "custom" && (
          <Field label="API">
            <Select className="w-full" aria-label="API" value={apiType} onChange={setApiType} options={view.apis.map((a) => ({ value: a, label: API_LABELS[a] ?? a, hint: a }))} />
          </Field>
        )}

        {preset.key !== "none" && (
          <Field
            label={preset.key === "required" ? "API key" : "API key (if the server wants one)"}
            hint={provider?.key.set ? `Leave empty to keep the one stored (${provider.key.hint ?? "set"}).` : "Stored in pi's auth files, readable by the portal's user only. $NAME reads it from the environment."}
            className={preset.endpoint ? "" : "sm:col-span-2"}
          >
            <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={provider?.key.set ? "••••••••" : preset.key === "required" ? "sk-…" : "none"} className={`${inputCls} font-mono`} aria-label="API key" />
          </Field>
        )}
      </div>

      {preset.endpoint && (
        <div className="mt-4">
          <div className="flex items-center gap-2">
            <p className="text-xs text-fg-muted">Models</p>
            {probe.message && (
              <span role="status" className={`truncate text-[11px] ${probe.state === "failed" ? "text-danger" : "text-fg-faint"}`}>{probe.message}</span>
            )}
            <button type="button" onClick={() => void ask()} disabled={!baseUrl.trim() || probe.state === "asking"} className={`${ghostCls} ml-auto`}>
              <LuRefreshCw className={`h-3.5 w-3.5 ${probe.state === "asking" ? "animate-spin" : ""}`} /> Ask again
            </button>
          </div>
          <ModelRows rows={rows} onChange={setRow} onAll={(keep) => setRows(rows.map((r) => ({ ...r, keep })))} />
          <div className="mt-2 flex gap-2">
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addManual(); } }}
              placeholder="Add a model by its id"
              spellCheck={false}
              className={`${inputCls} py-1.5 font-mono text-xs`}
              aria-label="Model id to add"
            />
            <button type="button" onClick={addManual} disabled={!manual.trim()} className={btnCls}><LuPlus className="h-4 w-4" /></button>
          </div>
        </div>
      )}

      </>
      )}

      <div className="mt-4 flex items-center gap-2">
        {choice !== "package" && (
          <button type="button" onClick={() => void save()} disabled={!canSave} className={primaryCls}>
            {saving ? <LuRefreshCw className="h-4 w-4 animate-spin" /> : <LuCheck className="h-4 w-4" />}
            {editing ? "Save" : "Add"}
          </button>
        )}
        {!embedded && <button type="button" onClick={onCancel} className={ghostCls}>{choice === "package" ? "Done" : "Cancel"}</button>}
        <span className="ml-auto text-[11px] text-fg-faint">
          {clash ? `${kind === "openrouter" ? "OpenRouter" : `“${id.trim()}”`} is set up already — edit it in the list${kind === "openrouter" || kind === "hosted" ? "" : ", or pick another name"}.` : badCtx ? `${badCtx.id}: the window is a whole number of tokens.` : needsKey ? "It needs a key." : preset.endpoint && kept.length === 0 && rows.length > 0 ? "Tick at least one model." : ""}
        </span>
      </div>
    </div>
  );
}

const API_LABELS: Record<string, string> = {
  "openai-completions": "OpenAI Chat Completions",
  "openai-responses": "OpenAI Responses",
  "anthropic-messages": "Anthropic Messages",
  "google-generative-ai": "Google Generative AI",
};

function ProbeMark({ state }: { state: "idle" | "asking" | "ok" | "failed" }) {
  const cls = "pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2";
  if (state === "asking") return <LuRefreshCw className={`${cls} animate-spin text-fg-faint`} aria-label="Asking the server" />;
  if (state === "ok") return <LuCheck className={`${cls} pop-in text-ok`} aria-label="The server answered" />;
  if (state === "failed") return <LuX className={`${cls} pop-in text-danger`} aria-label="The server did not answer" />;
  return null;
}

function ModelRows({ rows, onChange, onAll }: { rows: Row[]; onChange: (id: string, patch: Partial<Row>) => void; onAll: (keep: boolean) => void }) {
  const [filter, setFilter] = useState("");
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? rows.filter((r) => r.id.toLowerCase().includes(q) || r.name?.toLowerCase().includes(q)) : rows;
  }, [rows, filter]);
  if (!rows.length) return <p className="mt-2 rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-fg-faint">Its models appear here once the server answers.</p>;
  const all = rows.every((r) => r.keep);
  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-line">
      <div className="flex items-center gap-2 border-b border-line bg-fg/[.03] px-2.5 py-1.5">
        <input type="checkbox" checked={all} onChange={() => onAll(!all)} className="h-3.5 w-3.5 accent-accent" aria-label="Choose every model" />
        {rows.length > 8 ? (
          <div className="relative flex-1">
            <LuSearch className="pointer-events-none absolute left-0 top-1/2 h-3 w-3 -translate-y-1/2 text-fg-faint" />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Filter ${rows.length} models`} className="w-full bg-transparent pl-4 text-xs outline-none placeholder:text-fg-faint" aria-label="Filter models" />
          </div>
        ) : <span className="flex-1 text-[11px] text-fg-faint">{rows.filter((r) => r.keep).length} of {rows.length} chosen</span>}
        <span className="w-20 text-right text-[10px] uppercase tracking-wider text-fg-faint">Window</span>
        <span className="w-14 text-center text-[10px] uppercase tracking-wider text-fg-faint">Can</span>
      </div>
      <ul className="max-h-72 divide-y divide-line/60 overflow-y-auto">
        {shown.map((r) => (
          <li key={r.id} className={`flex items-center gap-2 px-2.5 py-1.5 transition-colors ${r.keep ? "" : "opacity-55"}`}>
            <input type="checkbox" checked={r.keep} onChange={() => onChange(r.id, { keep: !r.keep })} className="h-3.5 w-3.5 accent-accent" aria-label={`Use ${r.id}`} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-fg" title={r.id}>{r.name ?? r.id}</p>
              {r.name && <p className="truncate font-mono text-[10px] text-fg-faint">{r.id}</p>}
              {!r.found && <p className="text-[10px] text-fg-faint">Not listed by the server right now</p>}
            </div>
            <input
              value={r.ctxText}
              onChange={(e) => onChange(r.id, { ctxText: e.target.value })}
              placeholder="default"
              inputMode="numeric"
              title="How many tokens it may hold. Empty: pi's default of 128k."
              aria-label={`Context window of ${r.id}`}
              className={`w-20 rounded-md border bg-transparent px-1.5 py-0.5 text-right font-mono text-[11px] outline-none focus:border-accent/60 ${parseWindow(r.ctxText).kind === "bad" ? "border-danger/60" : "border-line"}`}
            />
            <div className="flex w-14 justify-center gap-0.5">
              <Toggle on={!!r.input?.includes("image")} label="Sees images" onClick={() => onChange(r.id, { input: r.input?.includes("image") ? undefined : ["text", "image"] })}><LuEye /></Toggle>
              <Toggle on={!!r.reasoning} label="Thinks before answering" onClick={() => onChange(r.id, { reasoning: !r.reasoning })}><LuBrain /></Toggle>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Toggle({ on, label, onClick, children }: { on: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} aria-label={label} title={label} onClick={onClick}
      className={`grid h-6 w-6 place-items-center rounded-md transition [&>svg]:h-3.5 [&>svg]:w-3.5 ${on ? "bg-accent/15 text-accent" : "text-fg-faint hover:bg-fg/5 hover:text-fg-muted"}`}>
      {children}
    </button>
  );
}
