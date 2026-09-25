/**
 * Where the windows go in voice mode: one in the middle, one at the side.
 *
 * The browser is always the middle one and the terminal always the side one,
 * since that is what their shapes suit. The conversation, Files and pictures
 * fill whichever is left, the side first — beside a full orb, which moves over for it — and
 * the middle when the side is taken. At most two are open at once (see
 * use-work-panels.ts), so there is always a place.
 */
export type VoiceWindow = "browser" | "terminal" | "files" | "pictures" | "conversation";

export function placeWindows(open: Partial<Record<VoiceWindow, boolean>>): { main?: VoiceWindow; side?: VoiceWindow } {
  let main: VoiceWindow | undefined = open.browser ? "browser" : undefined;
  let side: VoiceWindow | undefined = open.terminal ? "terminal" : undefined;
  for (const window of ["conversation", "files", "pictures"] as const) {
    if (!open[window]) continue;
    if (!side) side = window;
    else if (!main) main = window;
  }
  return { main, side };
}

/** The orb and its buttons, standing on their own, need about this much width. */
export const PRESENCE_WIDTH = 280;

/**
 * The widest stretch across the stage that no window covers, when the orb
 * fits in it — where it goes once windows have been sized by hand, as it
 * would with nothing open. Null when there is no such stretch: the orb then
 * waits in its dock under the windows.
 *
 * Only across: the windows take the stage's height, so a gap between them
 * runs from top to bottom.
 */
export function freeStrip(stage: { left: number; right: number }, windows: { left: number; right: number }[], least = PRESENCE_WIDTH): { center: number; width: number } | null {
  const taken = windows
    .map(w => ({ left: Math.max(stage.left, w.left), right: Math.min(stage.right, w.right) }))
    .filter(w => w.right > w.left)
    .sort((a, b) => a.left - b.left);
  let best: { center: number; width: number } | null = null;
  let from = stage.left;
  for (const w of [...taken, { left: stage.right, right: stage.right }]) {
    const width = w.left - from;
    if (width >= least && (!best || width > best.width)) best = { center: from + width / 2, width };
    from = Math.max(from, w.right);
  }
  return best;
}

/**
 * The voice dock, as stage.css draws it on a wide screen: centred, up to
 * 520px wide and 16px short of the stage at either side, its top edge 90px
 * above the stage's bottom (`top: calc(100% - 50px)`, 80px tall, centred on
 * that).
 */
export const DOCK = { width: 520, top: 90, inset: 16 };

/**
 * How tall a window may be with the orb back in its dock: the height that
 * ends `gap` above the dock, where the window reaches over it. Null when it
 * does not. A window can reach down there while the orb stands elsewhere,
 * and the dock coming back would be drawn over it.
 */
export function clearOfDock(stage: { left: number; right: number; bottom: number }, window: { left: number; right: number; top: number; bottom: number }, gap = 16, least = 180): number | null {
  const width = Math.min(DOCK.width, stage.right - stage.left - 2 * DOCK.inset);
  const middle = (stage.left + stage.right) / 2;
  const dock = { left: middle - width / 2, right: middle + width / 2, top: stage.bottom - DOCK.top };
  if (window.right <= dock.left || window.left >= dock.right || window.bottom <= dock.top - gap) return null;
  return Math.max(least, dock.top - gap - window.top);
}
