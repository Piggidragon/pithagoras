import { useEffect, type ReactNode } from "react";
import { LuX } from "react-icons/lu";
import { isEscape } from "../shortcuts";

/**
 * Centered dialog with a dimmed backdrop. Escape and backdrop clicks close it.
 *
 * With a `rail` it becomes a two-pane settings dialog: navigation down the left
 * edge, content on the right. The rail collapses above the content on narrow
 * screens rather than squeezing both into an unusable width.
 */
export function Modal({
  title,
  subtitle,
  rail,
  onClose,
  children,
  footer,
  wide,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  rail?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    // Not the Escape that takes back an input method's word in one of its fields.
    const onKey = (e: KeyboardEvent) => isEscape(e) && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/80 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* The rail layout gets a floor as well as a ceiling: its panels fetch
          before they render anything, so without one the dialog opened as a
          bare title bar and snapped to full height a moment later. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        className={`flex max-h-[88vh] w-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-pop ${
          // Grows with the viewport rather than to it: the rail plus a settings
          // form has a comfortable width, and a 34-inch screen should not
          // stretch a two-column form across all of it.
          wide ? "max-w-3xl xl:max-w-5xl" : "max-w-2xl"
        } ${rail ? "min-h-[min(34rem,88vh)]" : ""}`}
      >
        <header className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-fg">{title}</h2>
            {subtitle && <p className="truncate text-xs text-fg-subtle">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-fg-subtle transition hover:bg-fg/10 hover:text-fg"
            aria-label="Close"
          >
            <LuX className="h-4 w-4" />
          </button>
        </header>

        {rail ? (
          <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
            <nav className="shrink-0 overflow-y-auto border-b border-line bg-canvas/40 p-2 sm:w-52 sm:border-b-0 sm:border-r">
              {rail}
            </nav>
            <div className="min-w-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        )}

        {footer && <footer className="border-t border-line px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}
