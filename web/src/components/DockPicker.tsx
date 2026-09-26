import { useLayoutEffect, useRef, useState } from "react";
import type { IconType } from "react-icons";
import { LuPanelBottom, LuPanelLeft, LuPanelRight, LuPanelTop, LuPictureInPicture2 } from "react-icons/lu";
import { DOCKS, type Dock } from "../panel-dock";
import { useDismiss } from "../use-dismiss";

const ICONS: Record<Dock, IconType> = { right: LuPanelRight, left: LuPanelLeft, top: LuPanelTop, bottom: LuPanelBottom, float: LuPictureInPicture2 };
const LABELS: Record<Dock, string> = { right: "Right", left: "Left", top: "Top", bottom: "Bottom", float: "Floating" };

/**
 * Where the panels beside a chat go, from a button in their header: docked at
 * a side of the conversation, or floating over it (see panel-dock.ts).
 *
 * The menu is fixed to the page, not hung inside the panels: they clip what
 * reaches past them, and a short panel docked at the bottom would cut it off.
 * Not on a phone, where the panels cover the chat wherever they are docked.
 */
export function DockPicker({ dock, onDock }: { dock: Dock; onDock: (dock: Dock) => void }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  useDismiss(open, [button, menu], () => setOpen(false), button);
  useLayoutEffect(() => {
    if (!open || !button.current || !menu.current) return;
    const b = button.current.getBoundingClientRect(), height = menu.current.offsetHeight;
    // Under the button, or over it where there is no room below.
    const top = b.bottom + 4 + height <= innerHeight ? b.bottom + 4 : Math.max(4, b.top - 4 - height);
    setAt({ top, right: Math.max(4, innerWidth - b.right) });
  }, [open]);
  const Icon = ICONS[dock];
  return (
    <div className="max-md:hidden">
      <button
        ref={button}
        type="button"
        title="Where the panels go"
        aria-label="Where the panels go"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="grid h-6 w-6 place-items-center rounded text-fg-faint transition hover:bg-fg/5 hover:text-fg"
      >
        <Icon aria-hidden className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label="Where the panels go"
          style={at ? { top: at.top, right: at.right } : { visibility: "hidden" }}
          className="fixed z-50 w-40 rounded-xl border border-line bg-surface p-1 shadow-pop"
        >
          {DOCKS.map((d) => {
            const Each = ICONS[d];
            return (
              <button
                key={d}
                type="button"
                role="menuitemradio"
                aria-checked={dock === d}
                onClick={() => {
                  onDock(d);
                  setOpen(false);
                  button.current?.focus();
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition ${
                  dock === d ? "bg-accent/10 text-accent" : "text-fg-muted hover:bg-fg/5 hover:text-fg"
                }`}
              >
                <Each aria-hidden className="h-3.5 w-3.5" />
                {LABELS[d]}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
