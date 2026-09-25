import { useMemo, useState } from "react";
import { LuArrowLeft, LuArrowRight, LuCheck, LuPlus, LuRefreshCw, LuRocket } from "react-icons/lu";
import { api, type AvailableModel } from "../api";
import { forget, useCached } from "../settings-cache";
import { formatTokens } from "../transcript";
import { Modal } from "./Modal";
import { PackageCatalog } from "./PackageCatalog";
import { KindIcon, ProviderEditor, StatusBadge, useInstalledPackages, useProviderStatus } from "./ProvidersPanel";
import { Select } from "./Select";
import { EffortPicker, ghostCls, primaryCls } from "./SettingsUi";

const DONE_KEY = "pithagoras.setup";

/** Whether this browser has been through the assistant, or waved it away. */
export function setupDismissed(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) !== null;
  } catch {
    return false;
  }
}

function dismiss(how: "done" | "skipped") {
  try {
    localStorage.setItem(DONE_KEY, how);
  } catch {
    // Asked again next time, which is no harm.
  }
}

const STEPS = [
  { title: "Provider", lead: "Where the models come from" },
  { title: "Model", lead: "What new chats start with" },
  { title: "Agent", lead: "What it can do besides" },
];

/**
 * The first run, one step at a time: a provider, the model new chats start
 * with, and what the agent can do beyond its own tools. Each step is what
 * the matching Settings page does, and each can be changed there later.
 * It opens by itself while no model can be used, until it is finished or
 * skipped; Settings → Providers opens it again.
 */
export function SetupAssistant({ onClose, onStartChat }: { onClose: () => void; onStartChat: () => void }) {
  const [step, setStep] = useState(0);
  const [back, setBack] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const providers = useCached("providers", api.providers, { onError: (e) => setError(e.message) });
  const models = useCached("models", api.allModels, { freshMs: 0 });
  const settings = useCached("settings", api.settings);
  const status = useProviderStatus();
  const installed = useInstalledPackages();
  const [adding, setAdding] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);
  const [effort, setEffort] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const list = models.value?.models ?? [];
  const ready = list.length > 0;
  const configured = providers.value?.providers ?? [];

  const keyOf = (m: { provider: string; id: string }) => `${m.provider}\u0000${m.id}`;
  const stored = settings.value?.stored.model ? `${settings.value.stored.provider || settings.value.defaults.provider}\u0000${settings.value.stored.model}` : "";
  // A stored model that can no longer be used is no choice: the first that can is offered instead, and saved on Next.
  const current = choice ?? (list.some((m) => keyOf(m) === stored) ? stored : list[0] ? keyOf(list[0]) : "");
  const picked = list.find((m) => keyOf(m) === current);
  const level = effort ?? settings.value?.stored.thinkingLevel ?? "";

  const go = (to: number) => {
    setBack(to < step);
    setError(null);
    setStep(to);
  };

  const providerSaved = async () => {
    forget("models");
    setAdding(false);
    await Promise.all([providers.reload(), models.reload()]);
    status.check();
  };

  const saveModel = async () => {
    if (!picked) return go(2);
    setSaving(true);
    try {
      await api.saveSettings({ provider: picked.provider, model: picked.id, thinkingLevel: picked.reasoning ? level : "" });
      forget("settings");
      go(2);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const finish = (start: boolean) => {
    dismiss("done");
    onClose();
    if (start) onStartChat();
  };

  const modelOptions = useMemo(
    () =>
      list.map((m) => ({
        value: keyOf(m),
        label: m.name,
        text: `${m.name} ${m.id} ${m.provider}`,
        hint: describe(m, models.value?.providers[m.provider]),
      })),
    [list, models.value],
  );

  return (
    <Modal
      title="Set up Pithagoras"
      subtitle="Three steps. Everything here can be changed later in Settings."
      onClose={() => { dismiss("skipped"); onClose(); }}
      footer={
        <div className="flex items-center gap-2">
          {step > 0 ? (
            <button type="button" onClick={() => go(step - 1)} className={ghostCls}><LuArrowLeft className="h-3.5 w-3.5" /> Back</button>
          ) : (
            <button type="button" onClick={() => { dismiss("skipped"); onClose(); }} className={ghostCls}>Skip for now</button>
          )}
          <span className="ml-auto" />
          {step === 0 && (
            <button type="button" disabled={!ready} onClick={() => go(1)} className={primaryCls} title={ready ? undefined : "Add a provider with at least one model first"}>
              Next <LuArrowRight className="h-4 w-4" />
            </button>
          )}
          {step === 1 && (
            <button type="button" disabled={saving} onClick={() => void saveModel()} className={primaryCls}>
              {saving ? <LuRefreshCw className="h-4 w-4 animate-spin" /> : null} Next <LuArrowRight className="h-4 w-4" />
            </button>
          )}
          {step === 2 && (
            <>
              <button type="button" onClick={() => finish(false)} className={ghostCls}>Done</button>
              <button type="button" onClick={() => finish(true)} className={primaryCls}><LuRocket className="h-4 w-4" /> Start a chat</button>
            </>
          )}
        </div>
      }
    >
      <ol className="setup-steps mb-5" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s.title} className={`setup-step ${i < step ? "is-done" : i === step ? "is-current" : ""}`} aria-current={i === step ? "step" : undefined}>
            <span className="flex items-center gap-1">
              {i < step && <LuCheck className="h-3 w-3 text-ok" />}
              <span className="font-medium">{i + 1}. {s.title}</span>
            </span>
          </li>
        ))}
      </ol>

      {error && <p role="alert" className="mb-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}

      {/* One height for every step: the dialog is centred, and a step of
          another height moved the whole of it up or down as it came in. */}
      <div key={step} className={`setup-pane min-h-[min(30rem,58vh)] ${back ? "is-back" : ""}`}>
        <h3 className="text-base font-medium text-fg">{STEPS[step].lead}</h3>

        {step === 0 && (
          <div className="mt-1">
            <p className="mb-4 text-sm text-fg-subtle">
              A server on your network — llama.cpp, llama-swap, Ollama — or a hosted service with a key. Its models are
              looked up as soon as it answers.
            </p>
            {!providers.value ? (
              <div className="skeleton-group space-y-2"><div className="skeleton h-10 w-full" /><div className="skeleton h-24 w-full" /></div>
            ) : configured.length > 0 && !adding ? (
              <>
                <ul className="stagger-in space-y-1.5">
                  {configured.map((p) => (
                    <li key={p.id} className="flex items-center gap-3 rounded-xl border border-line bg-raised/40 px-3 py-2.5">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent"><KindIcon kind={p.kind} /></span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-fg">{p.label}</p>
                        <p className="truncate text-[11px] text-fg-faint">
                          {p.endpoint ? `${p.models.length} model${p.models.length === 1 ? "" : "s"} · ${p.baseUrl}` : "Hosted — every model pi knows of from it"}
                        </p>
                      </div>
                      {p.endpoint && <StatusBadge status={status.of[p.id]} />}
                    </li>
                  ))}
                </ul>
                <button type="button" onClick={() => setAdding(true)} className={`${ghostCls} mt-2`}><LuPlus className="h-3.5 w-3.5" /> Add another</button>
                {!ready && models.value && <p className="mt-2 text-xs text-warn">None of these offers a model yet — edit one in Settings → Providers, or add another.</p>}
              </>
            ) : (
              <div className="rounded-xl border border-line bg-raised/30 p-4">
                <ProviderEditor
                  embedded
                  view={providers.value}
                  taken={new Set(configured.filter((p) => p.key.source !== "environment").map((p) => p.id))}
                  onCancel={() => setAdding(false)}
                  onSaved={() => void providerSaved()}
                  onInstalled={() => void Promise.all([providers.reload(), models.reload()])}
                  onError={setError}
                />
                {configured.length > 0 && (
                  <button type="button" onClick={() => setAdding(false)} className={`${ghostCls} mt-2`}>Keep what is set up</button>
                )}
              </div>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="mt-1 space-y-4">
            <p className="text-sm text-fg-subtle">Each chat can switch under its chat box; this is only where they start.</p>
            <Select className="w-full" aria-label="Model for new chats" value={current} options={modelOptions} onChange={setChoice} placeholder="Choose a model…" />
            {picked?.reasoning ? (
              <div className="float-in">
                <p className="mb-1 text-xs text-fg-muted">How hard it thinks <span className="text-fg-faint">— more is slower, and usually better</span></p>
                <EffortPicker label="Effort for new chats" value={level} inherited={settings.value?.defaults.thinkingLevel} onChange={setEffort} />
              </div>
            ) : picked ? (
              <p className="text-xs text-fg-faint">This model answers straight away, without a thinking phase.</p>
            ) : null}
          </div>
        )}

        {step === 2 && (
          <div className="mt-1">
            <p className="mb-4 text-sm text-fg-subtle">
              pi reads, writes and runs commands on its own. Packages add more — searching the web, delegating to
              helpers, other tools. These are the most used; Settings → Extensions has the rest.
            </p>
            <PackageCatalog installed={installed.names} onInstalled={() => void installed.reload()} onError={setError} limit={5} searchable={false} />
          </div>
        )}
      </div>
    </Modal>
  );
}

function describe(m: AvailableModel, providerName?: string): string {
  const parts = [providerName ?? m.provider];
  if (m.contextWindow) parts.push(`${formatTokens(m.contextWindow)} window`);
  if (m.input?.includes("image")) parts.push("sees images");
  if (m.reasoning) parts.push("thinks");
  return parts.join(" · ");
}
