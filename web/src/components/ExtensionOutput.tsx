import { useEffect, useRef } from "react";
import { LuCircleAlert, LuInfo, LuTriangleAlert, LuX } from "react-icons/lu";
import type { ExtensionNotice, ExtensionStatus, ExtensionWidget } from "../extension-ui";

/**
 * What an extension pinned near the editor, and whatever it is saying about
 * itself in passing.
 *
 * Monospace and preserved whitespace, because the lines were laid out by
 * something that counts columns: rpiv-todo draws a tree with box characters,
 * and reflowing it as prose would break the tree. The colour is gone — it was
 * ANSI, and it is flattened on the way out — so the block carries its meaning
 * in its own words.
 */
export function ExtensionWidgets({
  widgets,
  statuses,
}: {
  widgets: ExtensionWidget[];
  statuses: ExtensionStatus[];
}) {
  if (!widgets.length && !statuses.length) return null;
  return (
    <div className="mb-2 space-y-1.5">
      {widgets.map((widget) => (
        <pre
          key={widget.key}
          aria-label={`${widget.key} panel`}
          className="max-h-48 overflow-auto whitespace-pre rounded-xl border border-line bg-raised/50 px-3 py-2 font-mono text-[11px] leading-[1.45] text-fg-muted"
        >
          {widget.lines.join("\n")}
        </pre>
      ))}
      {statuses.length > 0 && (
        <p className="truncate px-1 text-[11px] text-fg-faint">
          {statuses.map((s) => s.text).join("  ·  ")}
        </p>
      )}
    </div>
  );
}

/** How long a message stays before it goes on its own. An error is worth reading twice. */
const LINGER = { info: 6000, warning: 10000, error: 15000 } as const;

const ICONS = { info: LuInfo, warning: LuTriangleAlert, error: LuCircleAlert };
const TONES = {
  info: "border-line bg-surface text-fg",
  warning: "border-warning/40 bg-warning/10 text-fg",
  error: "border-danger/40 bg-danger/10 text-fg",
};

/**
 * Extension messages, which have nowhere else to be.
 *
 * ctx.ui.notify is how an extension reports what it just did, or why it could
 * not — rpiv-todo answers /todos with one. It is not part of the conversation
 * and does not belong in the transcript, where it would be mistaken for
 * something the agent said.
 */
export function ExtensionNotices({
  notices,
  onDismiss,
}: {
  notices: ExtensionNotice[];
  onDismiss: (id: number) => void;
}) {
  if (!notices.length) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2">
      {notices.map((notice) => (
        <Notice key={notice.id} notice={notice} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function Notice({
  notice,
  onDismiss,
}: {
  notice: ExtensionNotice;
  onDismiss: (id: number) => void;
}) {
  const Icon = ICONS[notice.level];
  // Held in a ref rather than watched: the parent hands down a new closure on
  // every render, and this page re-renders on every event the session streams.
  // Depending on it would restart the timer faster than it could ever run out,
  // and a notice raised mid-reply would never go away on its own.
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    const t = setTimeout(() => dismiss.current(notice.id), LINGER[notice.level]);
    return () => clearTimeout(t);
  }, [notice.id, notice.level]);

  return (
    <div
      role="status"
      className={`pointer-events-auto flex items-start gap-2 rounded-xl border px-3 py-2 shadow-pop ${TONES[notice.level]}`}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" />
      {/* An extension writes for a terminal, so its line breaks are meant. */}
      <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-xs">{notice.text}</p>
      <button
        onClick={() => onDismiss(notice.id)}
        aria-label="Dismiss"
        className="rounded p-0.5 text-fg-subtle transition hover:bg-fg/10 hover:text-fg"
      >
        <LuX className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
