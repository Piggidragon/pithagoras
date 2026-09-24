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
