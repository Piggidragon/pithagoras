/**
 * Where the windows go in voice mode: one in the middle, one at the side.
 *
 * The browser is always the middle one and the terminal always the side one,
 * since that is what their shapes suit. Files and pictures fill whichever is
 * left, the side first — beside a full orb, which moves over for it — and
 * the middle when the side is taken. At most two are open at once (see
 * use-work-panels.ts), so there is always a place.
 */
export type VoiceWindow = "browser" | "terminal" | "files" | "pictures";

export function placeWindows(open: Record<VoiceWindow, boolean>): { main?: VoiceWindow; side?: VoiceWindow } {
  let main: VoiceWindow | undefined = open.browser ? "browser" : undefined;
  let side: VoiceWindow | undefined = open.terminal ? "terminal" : undefined;
  for (const window of ["files", "pictures"] as const) {
    if (!open[window]) continue;
    if (!side) side = window;
    else if (!main) main = window;
  }
  return { main, side };
}
