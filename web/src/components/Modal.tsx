import { useEffect, useState, type ReactNode } from "react";
import { LuChevronLeft, LuX } from "react-icons/lu";
import { isEscape } from "../shortcuts";

/**
 * Centered dialog with a dimmed backdrop. Escape and backdrop clicks close it.
 *
 * With a `rail` it becomes a two-pane settings dialog: navigation down the left
 * edge, content on the right. On a narrow screen the two take turns, like a
 * phone's settings: the rail first, then the chosen section with a way back.
 * Stacked, the rail took most of the height and left the section a sliver.
 * `startInRail` false opens straight on the section the caller chose.
 */
export function Modal({
  title,
  subtitle,
  rail,
  onClose,
  children,
  footer,
  wide,
  startInRail = true,
  section,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  rail?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  startInRail?: boolean;
  /** The rail's chosen section: the title on a phone, where the rail is out of sight. */
  section?: ReactNode;
}) {
  // Only read below `sm`; wider, both panes are always there.
  const [inRail, setInRail] = useState(startInRail);
  useEffect(() => {
    // Not the Escape that takes back an input method's word in one of its fields.
    const onKey = (e: KeyboardEvent) => isEscape(e) && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="ui-backdrop fixed inset-0 z-50 flex items-center justify-center bg-canvas/80 p-2 backdrop-blur-sm sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* The rail layout gets a floor as well as a ceiling: its panels fetch
          before they render anything, so without one the dialog opened as a
          bare title bar and snapped to full height a moment later. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        className={`ui-dialog flex max-h-[94dvh] w-full sm:max-h-[88vh] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-pop ${
          // Grows with the viewport rather than to it: the rail plus a settings
          // form has a comfortable width, and a 34-inch screen should not
          // stretch a two-column form across all of it.
          wide ? "max-w-3xl xl:max-w-5xl" : "max-w-2xl"
        } ${rail ? "min-h-[min(34rem,94dvh)] sm:min-h-[min(34rem,88vh)]" : ""}`}
      >
        <header className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          {rail && !inRail && (
            <button
              type="button"
              onClick={() => setInRail(true)}
              className="-ml-2 rounded-lg p-1.5 text-fg-subtle transition hover:bg-fg/10 hover:text-fg sm:hidden"
              aria-label="Back"
            >
              <LuChevronLeft className="h-4 w-4" />
            </button>
          )}
          <div className="min-w-0 flex-1">
            {rail && section && !inRail ? (
              <>
                <h2 className="truncate text-sm font-semibold text-fg sm:hidden">{section}</h2>
                <h2 className="hidden truncate text-sm font-semibold text-fg sm:block">{title}</h2>
                {subtitle && <p className="hidden truncate text-xs text-fg-subtle sm:block">{subtitle}</p>}
              </>
            ) : (
              <>
                <h2 className="truncate text-sm font-semibold text-fg">{title}</h2>
                {subtitle && <p className="truncate text-xs text-fg-subtle">{subtitle}</p>}
              </>
            )}
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
            {/* Any button in the rail picks a section, so any click on one
                turns to it; the rail's own state says which. */}
            <nav
              onClick={(e) => (e.target as HTMLElement).closest("button") && setInRail(false)}
              className={`min-h-0 flex-1 overflow-y-auto bg-canvas/40 p-2 sm:block sm:w-52 sm:flex-none sm:shrink-0 sm:border-r sm:border-line ${inRail ? "" : "hidden"}`}
            >
              {rail}
            </nav>
            <div className={`min-w-0 flex-1 overflow-y-auto px-5 py-4 sm:block ${inRail ? "hidden" : ""}`}>{children}</div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        )}

        {footer && <footer className="border-t border-line px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}
