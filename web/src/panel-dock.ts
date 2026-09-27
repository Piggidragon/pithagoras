/**
 * Where the panels beside a chat go — the browser, Files, the terminal and
 * the subagents: docked at the conversation's right, left or bottom, or
 * floating over it in a window that can be moved and sized. They are carried
 * there by their header and dropped: at an edge they dock there, anywhere
 * else they float where they were let go.
 *
 * Docked at the right is how they always were. At the bottom they take the
 * width, and two of them sit side by side rather than one above the other.
 * Not at the top: there they came between the chat's title and the
 * conversation, and covered the conversation's start. Floating, the window is
 * kept inside the chat, however the chat is resized after it was placed.
 *
 * Kept per browser, like the panels' width: where they go is a preference,
 * not something about one chat.
 */
export type Dock = "right" | "left" | "bottom" | "float";

export const DOCKS: Dock[] = ["right", "left", "bottom", "float"];

export const isDock = (value: unknown): value is Dock => DOCKS.includes(value as Dock);

/** At the bottom: the panels take the width, and sit side by side. */
export const across = (dock: Dock) => dock === "bottom";

/**
 * What the conversation keeps beside docked panels: 320px of width, and 260px
 * of height — its composer and a few lines above it. The panels are held to
 * it however large they were made (the aside's max sizes in Chat), so a chat
 * made smaller by a window or the keyboard does not lose its composer.
 */
export const KEEP = { w: 320, h: 260 };
/** The least docked panels are made: at a side, and at the bottom. */
export const DOCKED_MIN = { w: 320, h: 160 };

/**
 * The size docked panels are dragged to in a chat of `area`'s size: no more
 * than leaves the conversation its room, and no less than of use — the
 * least winning where the chat is too small for both, so that what is kept
 * is never a height below it, or below nothing.
 */
export function dockedSize(want: { width: number; height: number }, area: { w: number; h: number }) {
  return {
    width: Math.round(Math.max(DOCKED_MIN.w, Math.min(want.width, area.w - KEEP.w))),
    height: Math.round(Math.max(DOCKED_MIN.h, Math.min(want.height, area.h - KEEP.h))),
  };
}

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

/**
 * Where panels carried to `at` (in px from the chat's top left) would go if
 * let go there: docked at the edge it is near, or floating. The edges reach
 * in far enough to hit without aiming, and no further than a sixth of the
 * chat, so that the middle is left for floating.
 */
export function dropTarget(at: { x: number; y: number }, area: { w: number; h: number }): Dock {
  const across = Math.min(96, area.w / 6), up = Math.min(96, area.h / 6);
  if (at.x <= across) return "left";
  if (at.x >= area.w - across) return "right";
  if (at.y >= area.h - up) return "bottom";
  return "float";
}

/** Where docked panels sit in the chat, as a frame — what a drop there would show: as they are drawn, held to the conversation's room. */
export function dockedFrame(dock: Exclude<Dock, "float">, area: { w: number; h: number }, size: { width: number; height: number }): Frame {
  if (dock === "bottom") {
    const h = Math.max(0, Math.min(size.height, area.h - KEEP.h));
    return { x: 0, y: area.h - h, w: area.w, h };
  }
  const w = Math.max(0, Math.min(size.width, area.w - KEEP.w));
  return { x: dock === "left" ? 0 : area.w - w, y: 0, w, h: area.h };
}
