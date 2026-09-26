/**
 * Where the panels beside a chat go — the browser, Files, the terminal and
 * the subagents: docked at one of the conversation's four sides, or floating
 * over it in a window that can be moved and sized.
 *
 * Docked at the right is how they always were. At the top or the bottom they
 * take the width, and two of them sit side by side rather than one above the
 * other. Floating, the window is kept inside the chat, however the chat is
 * resized after it was placed.
 *
 * Kept per browser, like the panels' width: where they go is a preference,
 * not something about one chat.
 */
export type Dock = "right" | "left" | "top" | "bottom" | "float";

export const DOCKS: Dock[] = ["right", "left", "top", "bottom", "float"];

export const isDock = (value: unknown): value is Dock => DOCKS.includes(value as Dock);

/** At the top or the bottom: the panels take the width, and sit side by side. */
export const across = (dock: Dock) => dock === "top" || dock === "bottom";

/** A floating window, in px from the chat's top left corner. */
export type Frame = { x: number; y: number; w: number; h: number };

/** Smaller than this a panel is no use: a header and a few lines. */
export const FRAME_MIN = { w: 320, h: 200 };
/** Kept clear around a floating window placed for the first time. */
const MARGIN = 16;

/** A frame read back from storage, or null for anything that is not one. */
export function readFrame(raw: string | null | undefined): Frame | null {
  if (!raw) return null;
  try {
    const f = JSON.parse(raw) as Partial<Frame>;
    return [f.x, f.y, f.w, f.h].every((n) => typeof n === "number" && Number.isFinite(n)) ? (f as Frame) : null;
  } catch {
    return null;
  }
}

const clamp = (value: number, least: number, most: number) => Math.min(most, Math.max(least, value));

/**
 * Where a floating window goes in a chat of `area`'s size: where it was put,
 * made to fit — no larger than the chat, no smaller than it may be unless the
 * chat itself is, and wholly inside it. With nowhere put yet, at the top right,
 * where the docked panels were.
 */
export function fitFrame(frame: Frame | null, area: { w: number; h: number }): Frame {
  const want = frame ?? { w: 520, h: 560, x: Infinity, y: MARGIN };
  const w = clamp(want.w, Math.min(FRAME_MIN.w, area.w), area.w);
  const h = clamp(want.h, Math.min(FRAME_MIN.h, area.h), frame ? area.h : Math.max(0, area.h - 2 * MARGIN));
  const x = clamp(frame ? want.x : area.w - w - MARGIN, 0, area.w - w);
  const y = clamp(want.y, 0, area.h - h);
  return { x, y, w, h };
}
