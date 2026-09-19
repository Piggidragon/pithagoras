import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Asking "are you sure" in the portal's own dialog instead of the browser's.
 *
 * window.confirm() is a grey system box that ignores the theme, cannot say what
 * the button will do, and looks like something from a different site — for the
 * one moment the portal is about to delete something. This keeps the call shape
 * (ask, get a yes or no) so a call site changes by one word:
 *
 *   if (await confirmDialog({ title: "Delete it?", danger: true })) …
 */
export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  /** What the button says. "OK" tells nobody what it is about to do. */
  confirmLabel?: string;
  /** Destructive: the button is red, and focus starts on Cancel. */
  danger?: boolean;
}

type Pending = ConfirmOptions & { id: number; resolve: (ok: boolean) => void };

let present: ((p: Pending) => void) | null = null;
let counter = 0;

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  // Nothing mounted to draw it — which is a bug, but not one that should make
  // a delete button do nothing.
  if (!present) {
    const text = typeof options.message === "string" ? `\n\n${options.message}` : "";
    return Promise.resolve(window.confirm(options.title + text));
  }
  return new Promise((resolve) => present!({ ...options, id: ++counter, resolve }));
}

/** Mounted once, at the root. Draws whatever confirmDialog() asked for, in order. */
export function ConfirmHost() {
  const [queue, setQueue] = useState<Pending[]>([]);
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const current = queue[0];

  useEffect(() => {
    present = (p) => setQueue((q) => [...q, p]);
    return () => {
      present = null;
    };
  }, []);

  const answer = (ok: boolean) => {
    current?.resolve(ok);
    setQueue((q) => q.slice(1));
  };

  useEffect(() => {
    if (!current) return;
    // Back to whatever had focus, so a keyboard user is not dropped at the top
    // of the page after answering.
    const before = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      // Capture phase, and stopped: a settings dialog underneath listens for
      // Escape too, and one keypress should close only the topmost thing.
      if (e.key === "Escape") {
        e.stopPropagation();
        answer(false);
      } else if (e.key === "Tab") {
        // Two buttons; Tab moves between them rather than out into the page
        // behind the backdrop.
        e.preventDefault();
        (document.activeElement === cancel.current ? confirm : cancel).current?.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      before?.focus?.();
    };
    // answer closes over `current`, which is what this effect is keyed on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  if (!current) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-canvas/80 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && answer(false)}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={current.message ? "confirm-message" : undefined}
        className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-pop"
      >
        <h2 id="confirm-title" className="text-sm font-semibold text-fg">
          {current.title}
        </h2>
        {current.message && (
          <div id="confirm-message" className="mt-2 whitespace-pre-line text-sm text-fg-muted">
            {current.message}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            key={`cancel-${current.id}`}
            ref={cancel}
            type="button"
            autoFocus={current.danger}
            onClick={() => answer(false)}
            className="rounded-lg px-3 py-1.5 text-sm text-fg-muted transition hover:bg-fg/5 hover:text-fg"
          >
            Cancel
          </button>
          <button
            key={`confirm-${current.id}`}
            ref={confirm}
            type="button"
            autoFocus={!current.danger}
            onClick={() => answer(true)}
            className={`rounded-lg px-3 py-1.5 text-sm ring-1 ring-inset transition ${
              current.danger
                ? "bg-danger/15 text-danger ring-danger/30 hover:bg-danger/25"
                : "bg-accent/15 text-accent ring-accent/30 hover:bg-accent/25"
            }`}
          >
            {current.confirmLabel ?? "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
