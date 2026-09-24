import { useEffect, useState } from "react";
import { LuBan, LuCircleCheck, LuKeyRound, LuRefreshCw, LuShield, LuUserX } from "react-icons/lu";
import { PageHeader, Stat } from "./PageHeader";
import { api, type AuditEntry } from "../api";
import { pollWhileVisible } from "../poll";

/** What each kind means at a glance, without reading the reason. */
const KIND: Record<string, { label: string; icon: JSX.Element; tone: string }> = {
  refused: { label: "Refused", icon: <LuBan className="h-3.5 w-3.5" />, tone: "text-danger" },
  "allowed-by-rule": {
    label: "Allowed by rule",
    icon: <LuCircleCheck className="h-3.5 w-3.5" />,
    tone: "text-ok",
  },
  "allowed-by-approval": {
    label: "Allowed by approval",
    icon: <LuKeyRound className="h-3.5 w-3.5" />,
    tone: "text-ok",
  },
  stranger: { label: "Turned away", icon: <LuUserX className="h-3.5 w-3.5" />, tone: "text-warn" },
  answered: { label: "You answered", icon: <LuShield className="h-3.5 w-3.5" />, tone: "text-accent" },
};

const FILTERS = [
  { id: "all", label: "Everything" },
  { id: "refused", label: "Refused" },
  { id: "allowed", label: "Allowed" },
  { id: "stranger", label: "Strangers" },
];

const when = (iso: string) => {
  // Stored as UTC without a zone marker, which Date reads as local time.
  const t = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  const mins = Math.round((Date.now() - t.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return t.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

/**
 * What the agent was stopped from doing, and what it was let through on.
 *
 * Refusals used to go to the container log, which answers "is the guard
 * working" and not "what has my agent been asked to do this week" — the
 * question somebody actually has, and the one that tells you whether a rule is
 * pulling its weight or somebody should be a guest.
 */
export function AuditPage() {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="h-full overflow-y-auto px-4 py-6">
      <div className="mx-auto w-full max-w-3xl">
        {error && (
          <div className="mb-4 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}
        <AuditPanel onError={setError} />
      </div>
    </div>
  );
}

function AuditPanel({ onError }: { onError: (e: string) => void }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  const load = () =>
    api
      .audit(300)
      .then((r) => setEntries(r.entries))
      .catch((e) => onError((e as Error).message))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
    return pollWhileVisible(load, 10_000);
  }, []);

  const shown = entries.filter((e) =>
    filter === "all"
      ? true
      : filter === "allowed"
        ? e.kind.startsWith("allowed")
        : e.kind === filter
  );

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-fg-subtle">
        <LuRefreshCw className="h-3.5 w-3.5 animate-spin" /> Loading…
      </p>
    );
  }

  const counts = {
    refused: entries.filter((e) => e.kind === "refused").length,
    allowed: entries.filter((e) => e.kind.startsWith("allowed")).length,
    strangers: entries.filter((e) => e.kind === "stranger").length,
  };

  return (
    <>
      <PageHeader
        icon={<LuShield />}
        title="Audit"
        className="mb-5"
        description={
          <>
            What the agent was stopped from doing, what it was let through on, and who was
            turned away. The last {entries.length} decisions.
          </>
        }
      >
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Stat value={counts.refused} label="refused" tone="text-danger" />
          <Stat value={counts.allowed} label="allowed" tone="text-ok" />
          <Stat value={counts.strangers} label="turned away" tone="text-warn" />
        </div>
      </PageHeader>

      <div className="mb-3 flex flex-wrap items-center gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`rounded-lg px-2.5 py-1 text-xs transition ${
              filter === f.id
                ? "bg-accent/12 text-accent ring-1 ring-inset ring-accent/25"
                : "bg-fg/5 text-fg-muted hover:bg-fg/10"
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-fg-faint">{shown.length}</span>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-xs text-fg-faint">
          Nothing recorded. The guard writes here when it refuses something, lets something
          through on a rule or an approval, or turns a stranger away.
        </p>
      ) : (
        <ul className="stagger-in space-y-1">
          {shown.map((e) => {
            const k = KIND[e.kind] ?? {
              label: e.kind,
              icon: <LuShield className="h-3.5 w-3.5" />,
              tone: "text-fg-muted",
            };
            return (
              <li key={e.id} className="rounded-xl border border-line bg-raised/40 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className={`shrink-0 ${k.tone}`}>{k.icon}</span>
                  <span className={`shrink-0 text-xs ${k.tone}`}>{k.label}</span>
                  {e.person_name && (
                    <span className="truncate text-xs text-fg-muted">{e.person_name}</span>
                  )}
                  <span className="ml-auto shrink-0 text-[11px] text-fg-faint">{when(e.at)}</span>
                </div>
                {e.subject && (
                  <p className="mt-1 truncate font-mono text-[11px] text-fg-muted">
                    {e.tool ? `${e.tool}: ` : ""}
                    {e.subject}
                  </p>
                )}
                {e.reason && <p className="mt-0.5 text-[11px] text-fg-faint">{e.reason}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
