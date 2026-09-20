import { useEffect, useRef, useState } from "react";
import { LuChevronRight, LuRefreshCw } from "react-icons/lu";
import { api, type PiConfig } from "../api";
import { KeepRecent, useKeepRecentSave } from "./KeepRecent";

/**
 * Context fill is the number that decides whether a long session keeps working,
 * so it gets a permanent readout rather than a tooltip: a donut that fills and
 * changes colour, opening onto everything context-related in one place.
 */

const RING = { r: 7, stroke: 3 };
const CIRC = 2 * Math.PI * RING.r;

/** Green while there's room, amber once compaction is near, red when it's close. */
function tone(pct: number) {
  if (pct >= 90) return { stroke: "#f87171", text: "text-danger", bar: "bg-danger" };
  if (pct >= 75) return { stroke: "#fb923c", text: "text-warn", bar: "bg-warn" };
  if (pct >= 50) return { stroke: "#fbbf24", text: "text-warn", bar: "bg-warn" };
  return { stroke: "#34d399", text: "text-ok", bar: "bg-ok" };
}

/**
 * What the model can really hold — the number the percentage and the moment of
 * compaction are measured against.
 *
 * pi takes it from the model's definition, which cannot know how the server is
 * run: llama.cpp with `--parallel 2` gives each chat half of `ctx-size`, so a
 * chat compacts far too late and then fails at the server. This is where it is
 * put right for one model, and it holds for every chat that uses it. A default
 * for all models is in Settings; what is set here wins over it.
 */
function ContextWindow({
  cfg,
  onChanged,
  onError,
}: {
  cfg: PiConfig;
  onChanged: () => Promise<void> | void;
  onError: (error: Error) => void;
}) {
  const { provider, id } = cfg.state.model;
  const limit = cfg.contextLimit ?? null;
  const fallback = cfg.contextDefault ?? null;
  const declared = cfg.models.models.find((m) => m.id === id && m.provider === provider)?.contextWindow;
  // The default is a ceiling: a model that declares less keeps its own.
  const byDefault = fallback ? (declared ? Math.min(declared, fallback) : fallback) : declared;
  const shown = cfg.stats?.contextUsage.contextWindow ?? limit ?? byDefault;
  const source = limit
    ? "set for this model"
    : fallback && (!declared || fallback < declared)
      ? "default from Settings"
      : declared
        ? "from the model"
        : "";
  const [text, setText] = useState(shown ? String(shown) : "");
  const [busy, setBusy] = useState(false);

  // Follows the server when the number changes there, and leaves what is being
  // typed alone while it does not.
  useEffect(() => setText(shown ? String(shown) : ""), [shown]);

  const save = async (tokens: number | null) => {
    setBusy(true);
    try {
      await api.setContextLimit(provider, id, tokens);
      await onChanged();
    } catch (e) {
      onError(e as Error);
      setText(shown ? String(shown) : "");
    } finally {
      setBusy(false);
    }
  };

  const commit = () => {
    const n = Number(text.replace(/[\s,._]/g, ""));
    if (!text.trim() || n === shown) return;
    if (!Number.isInteger(n) || n < 1024) {
      onError(new Error("Enter the window as a whole number of tokens, 1,024 or more"));
      setText(shown ? String(shown) : "");
      return;
    }
    void save(n);
  };

  return (
    <div className="rounded-lg bg-raised/40 px-2 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm text-fg">Context window</p>
        <p className="text-[11px] text-fg-subtle">{source}</p>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <input
          type="text"
          inputMode="numeric"
          value={text}
          disabled={busy}
          aria-label="Context window in tokens"
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-sm tabular-nums text-fg disabled:opacity-50"
        />
        {limit ? (
          <button
            type="button"
            disabled={busy}
            title={
              byDefault
                ? `Back to ${byDefault.toLocaleString()}, ${fallback && byDefault === fallback ? "the default from Settings" : "what the model says"}`
                : "Back to what the model says"
            }
            onClick={() => save(null)}
            className="shrink-0 rounded-md px-2 py-1 text-xs text-fg-muted hover:bg-raised disabled:opacity-50"
          >
            Reset
          </button>
        ) : null}
      </div>
      <p className="mt-1.5 text-[11px] text-fg-faint">
        What the server holds for one chat. Applies to every chat on this model.
      </p>
    </div>
  );
}

function Donut({ pct, color }: { pct: number; color: string }) {
  const filled = Math.max(0, Math.min(100, pct));
  return (
    <svg width={18} height={18} viewBox="0 0 18 18" className="-rotate-90">
      <circle cx={9} cy={9} r={RING.r} fill="none" stroke="#3f3f46" strokeWidth={RING.stroke} />
      <circle
        cx={9}
        cy={9}
        r={RING.r}
        fill="none"
        stroke={color}
        strokeWidth={RING.stroke}
        strokeLinecap="round"
        strokeDasharray={`${(filled / 100) * CIRC} ${CIRC}`}
        className="transition-[stroke-dasharray] duration-500"
      />
    </svg>
  );
}

export function ContextPill({
  sessionId,
  cfg,
  onChanged,
}: {
  sessionId: string;
  /** Only rendered once pi is live, so the stats are known to be there. */
  cfg: PiConfig & { stats: NonNullable<PiConfig["stats"]> };
  /** Stats move after compaction and after toggling auto-compaction. */
  onChanged: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<null | "compact" | "auto">(null);
  /** Read when the popup opens rather than with the transcript — it is pi's file. */
  const [keepRecent, setKeepRecent] = useState<number | null>(null);
  /** pi refuses to compact a short session, so its reason has to be visible. */
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || keepRecent !== null) return;
    api
      .settings()
      .then((r) => setKeepRecent(r.compaction.keepRecentTokens))
      .catch(() => {});
  }, [open, keepRecent]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const usage = cfg.stats.contextUsage;
  const pct = usage.percent ?? 0;
  const t = tone(pct);
  const auto = cfg.state.autoCompactionEnabled !== false;

  const compactNow = async () => {
    setBusy("compact");
    setNote(null);
    try {
      await api.compact(sessionId);
      await onChanged();
      setNote({ text: "Compacted.", error: false });
    } catch (e) {
      setNote({ text: (e as Error).message, error: true });
    } finally {
      setBusy(null);
    }
  };

  /**
   * Saved when the drag ends, not on every step, and applied to open sessions
   * by the server — including this one, so the next compaction uses it.
   */
  const saveKeepRecent = useKeepRecentSave(
    (compaction) => setKeepRecent(compaction.keepRecentTokens),
    (error) => setNote({ text: error.message, error: true }),
  );

  const toggleAuto = async () => {
    setBusy("auto");
    setNote(null);
    try {
      await api.setConfig(sessionId, { autoCompaction: !auto });
      await onChanged();
    } catch (e) {
      setNote({ text: (e as Error).message, error: true });
    } finally {
      setBusy(null);
    }
  };

  const rows: [string, string][] = [
    ["Input", cfg.stats.tokens.input.toLocaleString()],
    ["Output", cfg.stats.tokens.output.toLocaleString()],
    ["Messages", String(cfg.stats.totalMessages ?? 0)],
    ["Tool calls", String(cfg.stats.toolCalls ?? 0)],
    ["Cost", `$${cfg.stats.cost.toFixed(4)}`],
  ];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        title={`Context ${pct.toFixed(1)}% full`}
        className={`flex items-center gap-1.5 rounded px-2 py-1 ${
          open ? "bg-raised" : "hover:bg-raised"
        }`}
      >
        <Donut pct={pct} color={t.stroke} />
        <span className={`tabular-nums ${t.text}`}>{pct.toFixed(0)}%</span>
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-72 rounded-xl border border-line bg-surface p-3 shadow-pop">
          <div className="flex items-baseline justify-between">
            <p className="text-sm text-fg-muted">Context</p>
            <p className={`text-sm tabular-nums ${t.text}`}>{pct.toFixed(1)}% full</p>
          </div>

          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-raised">
            <div
              className={`h-full rounded-full transition-all duration-500 ${t.bar}`}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
          <p className="mt-1.5 text-[11px] tabular-nums text-fg-subtle">
            {usage.tokens.toLocaleString()} of {usage.contextWindow.toLocaleString()} tokens ·{" "}
            {Math.max(0, usage.contextWindow - usage.tokens).toLocaleString()} left
          </p>

          <div className="my-3 border-t border-line" />

          <ContextWindow cfg={cfg} onChanged={onChanged} onError={(e) => setNote({ text: e.message, error: true })} />

          <div className="my-3 border-t border-line" />

          <button
            type="button"
            onClick={toggleAuto}
            disabled={busy !== null}
            className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left hover:bg-raised disabled:opacity-50"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm text-fg">Auto-compact</p>
              <p className="text-[11px] text-fg-subtle">Summarise automatically before it fills</p>
            </div>
            <span
              className={`relative h-5 w-9 shrink-0 rounded-full transition ${
                auto ? "bg-accent" : "bg-raised"
              }`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                  auto ? "left-[1.125rem]" : "left-0.5"
                }`}
              />
            </span>
          </button>

          {keepRecent !== null && (
            <div className="mt-2 rounded-lg bg-raised/40 px-2 py-2">
              <KeepRecent
                value={keepRecent}
                contextWindow={usage.contextWindow}
                onChange={setKeepRecent}
                onCommit={saveKeepRecent}
                disabled={busy !== null}
              />
              <p className="mt-1.5 text-[11px] text-fg-faint">
                Kept word for word; only what is older is summarised. This is where a compaction
                lands, before the summary is added.
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={compactNow}
            disabled={busy !== null}
            className="mt-1 flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left hover:bg-raised disabled:opacity-50"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm text-fg">Compact now</p>
              <p className="text-[11px] text-fg-subtle">Summarise the conversation so far</p>
            </div>
            {busy === "compact" ? (
              <LuRefreshCw className="h-4 w-4 shrink-0 animate-spin text-fg-muted" />
            ) : (
              <LuChevronRight className="h-4 w-4 shrink-0 text-fg-faint" />
            )}
          </button>

          {note && (
            <p className={`mt-2 text-[11px] ${note.error ? "text-danger" : "text-ok"}`}>
              {note.text}
            </p>
          )}

          <div className="my-3 border-t border-line" />

          <dl className="space-y-1">
            {rows.map(([label, value]) => (
              <div key={label} className="flex justify-between text-[11px]">
                <dt className="text-fg-subtle">{label}</dt>
                <dd className="tabular-nums text-fg-muted">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
