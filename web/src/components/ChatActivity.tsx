import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  LuBrain,
  LuChevronRight,
  LuCircleSlash,
  LuFilePen,
  LuFilePlus,
  LuFileSearch,
  LuFileText,
  LuFoldVertical,
  LuGlobe,
  LuImage,
  LuListTodo,
  LuSearch,
  LuSquareTerminal,
  LuTriangleAlert,
  LuWrench,
  LuX,
} from "react-icons/lu";
import type { Activity, Item } from "../transcript";
import { SHELL_TOOL } from "./VoiceTerminal";

type ToolItem = Extract<Item, { kind: "tool" }>;
type CompactionItem = Extract<Item, { kind: "compaction" }>;

export const formatElapsed = (s: number) =>
  s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;

const formatDuration = (ms: number) =>
  ms < 1000 ? `${Math.max(0.1, ms / 1000).toFixed(1)}s` : ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : formatElapsed(Math.round(ms / 1000));

export const tokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/**
 * Opens and closes by animating its height to what the content needs — the
 * grid-rows trick, so nothing has to be measured.
 */
export function Collapse({ open, children, className = "" }: { open: boolean; children: ReactNode; className?: string }) {
  // Kept mounted a moment after closing, so it can animate shut; not mounted
  // at all until first opened, so a long transcript does not build every body.
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) return setMounted(true);
    const t = window.setTimeout(() => setMounted(false), 320);
    return () => window.clearTimeout(t);
  }, [open]);
  return (
    <div className={`chat-collapse ${open ? "is-open" : ""} ${className}`} aria-hidden={!open}>
      <div className="chat-collapse-inner">{(open || mounted) && children}</div>
    </div>
  );
}

/** Text that shimmers while it is still true: "Thinking", "Loading model". */
export const Shimmer = ({ children }: { children: ReactNode }) => <span className="chat-shimmer">{children}</span>;

/** A small ring that spins — or, given a fraction, fills. */
export function Ring({ value, className = "" }: { value?: number; className?: string }) {
  const r = 6.5;
  const c = 2 * Math.PI * r;
  const determinate = value !== undefined;
  return (
    <svg viewBox="0 0 16 16" className={`chat-ring ${determinate ? "" : "is-spinning"} ${className}`} aria-hidden>
      <circle cx="8" cy="8" r={r} className="chat-ring-track" />
      <circle
        cx="8"
        cy="8"
        r={r}
        className="chat-ring-value"
        strokeDasharray={c}
        strokeDashoffset={determinate ? c * (1 - Math.min(1, Math.max(0, value))) : c * 0.7}
      />
    </svg>
  );
}

/**
 * The reasoning before an answer, folded away.
 *
 * While it is being written the header shimmers and the newest line runs
 * underneath, so there is something alive to look at without the whole of it
 * pushing the conversation down. Opened, it follows the end as it grows.
 */
export function ThinkingBlock({
  thinking,
  streaming,
  since,
  until,
}: {
  thinking: string;
  streaming: boolean;
  since?: number;
  until?: number;
}) {
  const [open, setOpen] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!streaming) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [streaming]);
  useLayoutEffect(() => {
    const el = body.current;
    if (el && streaming && open) el.scrollTop = el.scrollHeight;
  }, [thinking, streaming, open]);

  const seconds = since ? Math.max(0, Math.round(((streaming ? now : until ?? since) - since) / 1000)) : undefined;
  const label = streaming ? "Thinking" : seconds && seconds >= 1 ? `Thought for ${formatElapsed(seconds)}` : "Thought process";
  // The last line that says something, for the ticker under a closed header.
  const tail = streaming && !open ? lastLine(thinking) : "";

  return (
    <div className={`chat-thinking ${streaming ? "is-streaming" : ""} ${open ? "is-open" : ""}`}>
      <button type="button" className="chat-thinking-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="chat-thinking-icon" aria-hidden>
          <LuBrain />
        </span>
        {streaming ? <Shimmer>{label}</Shimmer> : <span>{label}</span>}
        {streaming && seconds !== undefined && seconds >= 1 && <span className="chat-faint tabular-nums">{formatElapsed(seconds)}</span>}
        <LuChevronRight className="chat-chevron" aria-hidden />
      </button>
      {tail && (
        <div className="chat-thinking-ticker" aria-hidden>
          <span key={tail}>{tail}</span>
        </div>
      )}
      <Collapse open={open}>
        <div ref={body} className="chat-thinking-body">
          {thinking}
        </div>
      </Collapse>
    </div>
  );
}

function lastLine(text: string): string {
  const lines = text.trim().split(/\n+/);
  const line = lines[lines.length - 1]?.trim() ?? "";
  return line.length > 140 ? "…" + line.slice(-139) : line;
}

/** What a tool is, as a picture. Guessed from its name — pi's tools and whatever an extension adds. */
function ToolIcon({ name }: { name: string }) {
  const n = name.toLowerCase();
  if (SHELL_TOOL.test(n)) return <LuSquareTerminal />;
  if (/^(edit|multi_?edit|patch|apply_patch)/.test(n)) return <LuFilePen />;
  if (/^(write|create)/.test(n)) return <LuFilePlus />;
  if (/^(read|view|cat|open)/.test(n)) return <LuFileText />;
  if (/(grep|find|glob|search|ls|list)/.test(n) && !/web/.test(n)) return /grep|search/.test(n) ? <LuSearch /> : <LuFileSearch />;
  if (/(web|browser|fetch|http|url|navigate)/.test(n)) return <LuGlobe />;
  if (/(image|picture|screenshot)/.test(n)) return <LuImage />;
  if (/(todo|task|plan)/.test(n)) return <LuListTodo />;
  return <LuWrench />;
}

/** A clock that ticks once a second while `on`. */
function useNow(on: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [on]);
  return now;
}

/**
 * How a shell command ended, read from what pi's bash tool appends to its
 * output: an exit code, a timeout, or a stop.
 */
export function shellOutcome(status: ToolItem["status"], output: string, interrupted?: boolean): { label: string; tone: "ok" | "error" | "warn" } | undefined {
  if (status === "running") return undefined;
  if (interrupted) return { label: "interrupted", tone: "warn" };
  if (status === "done") return { label: "exit 0", tone: "ok" };
  const code = /Command exited with code (-?\d+)\s*$/.exec(output);
  if (code) return { label: `exit ${code[1]}`, tone: "error" };
  const timeout = /Command timed out after (\d+) seconds\s*$/.exec(output);
  if (timeout) return { label: `timed out · ${timeout[1]}s`, tone: "warn" };
  if (/Command aborted\s*$/.test(output)) return { label: "stopped", tone: "warn" };
  return { label: "failed", tone: "error" };
}

const lineCount = (text: string) => (text ? text.replace(/\n$/, "").split("\n").length : 0);

/** Past this, the output shown in the chat is the end of it; the terminal has the rest. */
const INLINE_OUTPUT = 6000;

/**
 * One tool call: its name, and folded away what it was called with and what
 * came back. A shell command shows whole, with its output, and a way into the
 * agent terminal for all of it.
 */
export function ToolCall({ item, onOpenTerminal }: { item: ToolItem; onOpenTerminal?: (callId: string) => void }) {
  const [open, setOpen] = useState(false);
  const shell = SHELL_TOOL.test(item.name);
  const args = item.args && typeof item.args === "object" ? (item.args as Record<string, unknown>) : undefined;
  const command = shell ? String(args?.command ?? args?.cmd ?? (typeof item.args === "string" ? item.args : "")) : "";
  const took = item.since && item.until ? item.until - item.since : undefined;
  const output = item.output?.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "") ?? "";
  const clipped = output.length > INLINE_OUTPUT;
  const running = item.status === "running";
  const now = useNow(running && shell);
  const elapsed = running && item.since ? Math.max(0, Math.floor((now - item.since) / 1000)) : undefined;
  // A command given a timeout has an end to measure against; the ring fills towards it.
  const timeout = typeof args?.timeout === "number" && args.timeout > 0 ? args.timeout : undefined;
  const outcome = shell
    ? shellOutcome(item.status, output, item.interrupted)
    : item.interrupted
      ? ({ label: "interrupted", tone: "warn" } as const)
      : undefined;
  const lines = shell ? lineCount(output) : 0;
  const lastOutput = shell && running && !open ? lastLine(output) : "";

  return (
    <div className={`chat-tool is-${item.status} ${item.interrupted ? "is-interrupted" : ""} ${open ? "is-open" : ""}`}>
      <button type="button" className="chat-tool-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="chat-tool-icon" aria-hidden>
          {running ? (
            <Ring value={timeout && elapsed !== undefined ? elapsed / timeout : undefined} />
          ) : item.interrupted ? (
            <LuCircleSlash className="text-warn" />
          ) : item.status === "error" ? (
            <LuX className="text-danger" />
          ) : (
            <ToolIcon name={item.name} />
          )}
        </span>
        <span className="chat-tool-name">{running ? <Shimmer>{item.name}</Shimmer> : item.name}</span>
        {outcome && <span className={`chat-tool-badge is-${outcome.tone}`}>{outcome.label}</span>}
        {shell && running && elapsed !== undefined && (
          <span className="chat-faint tabular-nums">
            {formatElapsed(elapsed)}
            {timeout ? ` / ${formatElapsed(timeout)}` : ""}
          </span>
        )}
        {took !== undefined && <span className="chat-faint tabular-nums">{formatDuration(took)}</span>}
        {shell && lines > 0 && (
          <span className="chat-faint tabular-nums">
            {lines.toLocaleString()} {lines === 1 ? "line" : "lines"}
          </span>
        )}
        <LuChevronRight className="chat-chevron" aria-hidden />
      </button>
      {lastOutput && (
        <div className="chat-tool-ticker" aria-hidden>
          <span key={lastOutput}>{lastOutput}</span>
        </div>
      )}
      <Collapse open={open}>
        <div className="chat-tool-body">
          {shell ? (
            <pre className="chat-tool-command">
              <span aria-hidden>$ </span>
              {command || "(no command)"}
            </pre>
          ) : (
            <ToolArgs args={item.args} />
          )}
          {output ? (
            <div className="chat-tool-output-wrap">
              <div className="chat-tool-label">
                {item.status === "error" && !item.interrupted ? "Error" : "Output"}
                {clipped && <span className="chat-faint"> · last {tokens(INLINE_OUTPUT)} characters</span>}
              </div>
              <pre className={`chat-tool-output ${item.status === "error" && !item.interrupted ? "is-error" : ""}`}>{clipped ? output.slice(-INLINE_OUTPUT) : output}</pre>
            </div>
          ) : (
            item.status === "running" && <div className="chat-tool-label"><Shimmer>Waiting for output…</Shimmer></div>
          )}
          {shell && onOpenTerminal && item.callId && (
            <button type="button" className="chat-tool-link" onClick={() => onOpenTerminal(item.callId!)}>
              <LuSquareTerminal aria-hidden />
              {clipped ? "Show the whole output in the agent terminal" : "Open in the agent terminal"}
            </button>
          )}
        </div>
      </Collapse>
    </div>
  );
}

function ToolArgs({ args }: { args: unknown }) {
  if (args === undefined || args === null) return <div className="chat-tool-label">No parameters</div>;
  if (typeof args !== "object") return <pre className="chat-tool-value">{String(args)}</pre>;
  const entries = Object.entries(args as Record<string, unknown>);
  if (!entries.length) return <div className="chat-tool-label">No parameters</div>;
  return (
    <dl className="chat-tool-args">
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>
            <pre className="chat-tool-value">{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The conversation being summarized, and then the mark where it was: what
 * came before it is what the agent now remembers only as the summary.
 */
export function CompactionMarker({ item }: { item: CompactionItem }) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const running = item.status === "running";
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [running]);
  const seconds = item.since ? Math.max(0, Math.floor((now - item.since) / 1000)) : 0;

  if (running) {
    return (
      <div className="chat-compaction is-running" role="status">
        <span className="chat-compaction-rule" />
        <span className="chat-compaction-pill">
          <span className="chat-squeeze" aria-hidden>
            <i />
            <i />
            <i />
            <i />
          </span>
          <Shimmer>Compacting the conversation</Shimmer>
          {seconds >= 1 && <span className="chat-faint tabular-nums">{formatElapsed(seconds)}</span>}
        </span>
        <span className="chat-compaction-rule" />
      </div>
    );
  }
  const failed = item.status === "failed";
  return (
    <div className={`chat-compaction ${failed ? "is-failed" : "is-done"}`}>
      <div className="chat-compaction-line">
        <span className="chat-compaction-rule" />
        <button
          type="button"
          className="chat-compaction-pill"
          onClick={() => item.summary && setOpen((v) => !v)}
          aria-expanded={item.summary ? open : undefined}
          disabled={!item.summary}
        >
          {failed ? <LuTriangleAlert aria-hidden /> : <LuFoldVertical aria-hidden />}
          <span>
            {failed ? "Compaction did not finish" : "Conversation compacted"}
            {!failed && item.tokensBefore ? ` · ${tokens(item.tokensBefore)} tokens summarized` : ""}
          </span>
          {item.summary && <LuChevronRight className="chat-chevron" aria-hidden />}
        </button>
        <span className="chat-compaction-rule" />
      </div>
      {item.summary && (
        <Collapse open={open}>
          <div className="chat-compaction-summary">{item.summary}</div>
        </Collapse>
      )}
    </div>
  );
}

const promptLabels = ["Reading the conversation", "Reviewing the context", "Preparing to respond"];

/**
 * What the agent is doing between the things that show for themselves.
 *
 * One small pill whose contents change with the phase — loading the model,
 * reading the prompt with how far it has got, thinking before anything has
 * been said — rather than a card that grows and shrinks. Writing and tool calls
 * are drawn where they happen, so this steps aside for them.
 */
export function StatusIndicator({ phase, now }: { phase: Activity; now: number }) {
  const seconds = phase.since ? Math.max(0, Math.floor((now - phase.since) / 1000)) : 0;
  const elapsed = seconds >= 2 ? formatElapsed(seconds) : null;
  const p = phase.prefill;
  // `processed` already counts the cached prefix.
  const percent = p && p.total > 0 ? Math.round((Math.min(p.total, p.processed) / p.total) * 100) : undefined;

  let kind: string;
  let icon: ReactNode;
  let text: ReactNode;
  let extra: ReactNode = null;
  switch (phase.label) {
    case "loading the model":
      kind = "model";
      icon = (
        <span className="chat-model-load" aria-hidden>
          <i />
          <i />
          <i />
        </span>
      );
      text = <Shimmer>Loading model</Shimmer>;
      extra = phase.model ? <span className="chat-status-model">{phase.model}</span> : null;
      break;
    case "processing the prompt": {
      kind = "prefill";
      icon = <Ring value={percent !== undefined ? percent / 100 : undefined} />;
      const label = promptLabels[Math.floor(seconds / 4) % promptLabels.length];
      text = (
        <span key={label} className="chat-status-swap">
          <Shimmer>{label}</Shimmer>
        </span>
      );
      extra = percent !== undefined ? (
        <span className="chat-status-percent" title={p ? `${p.processed.toLocaleString()} / ${p.total.toLocaleString()} tokens${p.cache ? ` · ${p.cache.toLocaleString()} from cache` : ""}` : undefined}>
          {percent}%
        </span>
      ) : null;
      break;
    }
    case "compacting the conversation":
      kind = "compact";
      icon = (
        <span className="chat-squeeze" aria-hidden>
          <i />
          <i />
          <i />
          <i />
        </span>
      );
      text = <Shimmer>Compacting the conversation</Shimmer>;
      break;
    case "retrying after an error":
      kind = "retry";
      icon = <Ring />;
      text = <span className="text-warn">Retrying after an error</span>;
      break;
    case "thinking":
    case "working":
      kind = "thinking";
      icon = <span className="chat-orbit" aria-hidden><i /><i /><i /></span>;
      text = <Shimmer>{phase.label === "thinking" ? "Thinking" : "Working"}</Shimmer>;
      break;
    default:
      return null;
  }

  return (
    <div className="chat-status" role="status" aria-live="polite">
      <span key={kind} className="chat-status-pill">
        <span className="chat-status-icon">{icon}</span>
        {text}
        {extra}
        {elapsed && <span className="chat-faint tabular-nums">{elapsed}</span>}
      </span>
    </div>
  );
}
