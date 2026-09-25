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

type Box = { left: number; top: number; right: number; bottom: number };

/**
 * The voice dock's measures, as the stage's styles set them (see `--dock-*`
 * on .voice-stage in stage.css): its width, at most, and its height; how far
 * above the stage's bottom its middle is; and what it keeps clear at the
 * stage's sides.
 */
export type DockSize = { width: number; height: number; middle: number; inset: number };

export function dockSize(stage: Element): DockSize {
  const style = getComputedStyle(stage);
  const px = (name: string) => parseFloat(style.getPropertyValue(name)) || 0;
  return { width: px("--dock-width"), height: px("--dock-height"), middle: px("--dock-middle"), inset: px("--dock-inset") };
}

/** Where the dock is on a stage: centred at its foot. */
export function dockBox(stage: Box, size: DockSize): Box {
  const width = Math.min(size.width, stage.right - stage.left - 2 * size.inset);
  const middle = (stage.left + stage.right) / 2, y = stage.bottom - size.middle;
  return { left: middle - width / 2, right: middle + width / 2, top: y - size.height / 2, bottom: y + size.height / 2 };
}

/**
 * The dock, where the orb is in it — as the stage's styles place it, not
 * where the orb is on its way there. Null when the orb stands on its own:
 * beside a single window, in a gap between two, or with nothing open.
 */
export function dockOf(stage: HTMLElement): Box | null {
  const docked = stage.classList.contains("is-docked") && stage.dataset.panels !== "1" && stage.dataset.presence !== "free";
  return docked ? dockBox(stage.getBoundingClientRect(), dockSize(stage)) : null;
}

/**
 * How tall a window may be with the orb back in its dock, where it reaches
 * under the dock: the height that ends `gap` above it. Null when it does
 * not. A window can reach down there while the orb stands elsewhere, and the
 * dock coming back would be drawn over it.
 */
export function clearOfDock(dock: Box, window: Box, gap = 16, least = 180): number | null {
  if (window.right <= dock.left || window.left >= dock.right || window.bottom <= dock.top) return null;
  return Math.max(least, dock.top - gap - window.top);
}
