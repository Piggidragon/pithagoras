/**
 * Where the panels beside a chat go — the browser, Files, the terminal, Git
 * and the subagents: docked at the conversation's right, left or bottom, or
 * floating over it in a window that can be moved and sized. Each is carried
 * there by its header and dropped: at an edge it docks there, anywhere else
 * it floats where it was let go. Each goes on its own, so the terminal can
 * sit at the left while Files is at the right (see Places).
 *
 * Docked at the right is how they always were. At the bottom they take the
 * width under the conversation, and two of them sit side by side rather than
 * one above the other. Not at the top: there they came between the chat's
 * title and the conversation, and covered the conversation's start.
 * Floating, the window is kept inside the chat, however the chat is resized
 * after it was placed.
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
 * where the docked panels were, and ending above the composer — the room
 * docked panels leave it (KEEP): it covered Send and Stop, and nothing could
 * be sent until it was moved.
 */
export function fitFrame(frame: Frame | null, area: { w: number; h: number }): Frame {
  const want = frame ?? { w: 520, h: 560, x: Infinity, y: MARGIN };
  const w = clamp(want.w, Math.min(FRAME_MIN.w, area.w), area.w);
  const least = Math.min(FRAME_MIN.h, area.h);
  const most = frame ? area.h : Math.min(Math.max(least, area.h - KEEP.h - MARGIN), Math.max(0, area.h - 2 * MARGIN));
  const h = clamp(want.h, least, most);
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

/**
 * Each panel goes where it was carried: the terminal at the left and Files at
 * the right, say. One that was never carried anywhere goes where all of them
 * went before they were placed one by one (`panelDock`), so that nothing moves
 * for someone who kept them on one side. Panels in the same place share it as
 * before: one above the other at a side, side by side at the bottom, and one
 * window when they float.
 */
export type Places = Partial<Record<string, Dock>>;

/** Places read back from storage: only those that are places a panel can go. */
export function readPlaces(raw: string | null | undefined): Places {
  if (!raw) return {};
  try {
    const stored = JSON.parse(raw) as unknown;
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
    return Object.fromEntries(Object.entries(stored).filter(([, place]) => isDock(place))) as Places;
  } catch {
    return {};
  }
}

/** A panel's own size: its width at a side, its height at the bottom. */
export type Size = { width: number; height: number };
export type Sizes = Partial<Record<string, Partial<Size>>>;

/** Sizes read back from storage: only those at least as large as docked panels are drawn. */
export function readSizes(raw: string | null | undefined): Sizes {
  if (!raw) return {};
  try {
    const stored = JSON.parse(raw) as unknown;
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
    const sizes: Sizes = {};
    for (const [kind, size] of Object.entries(stored as Record<string, Partial<Size>>)) {
      if (!size || typeof size !== "object") continue;
      const kept: Partial<Size> = {};
      if (typeof size.width === "number" && Number.isFinite(size.width) && size.width >= DOCKED_MIN.w) kept.width = size.width;
      if (typeof size.height === "number" && Number.isFinite(size.height) && size.height >= DOCKED_MIN.h) kept.height = size.height;
      if (kept.width !== undefined || kept.height !== undefined) sizes[kind] = kept;
    }
    return sizes;
  } catch {
    return {};
  }
}

/** The panels open, in their order, gathered by the place each goes: left, right, bottom, then floating. */
export function groupPanels<K extends string>(kinds: readonly K[], placeOf: (kind: K) => Dock): { place: Dock; kinds: K[] }[] {
  return DOCKS_IN_ORDER.map((place) => ({ place, kinds: kinds.filter((k) => placeOf(k) === place) })).filter((g) => g.kinds.length > 0);
}
const DOCKS_IN_ORDER: Dock[] = ["left", "right", "bottom", "float"];

/**
 * The widths panels at the left and at the right are drawn at in a chat `w`
 * wide: each as it was made, unless together they would leave the
 * conversation less than its 320px — then both give way, each in proportion
 * to its width. 0 for a side with nothing there. A chat not measured yet
 * (`w` 0) has them as they were made.
 */
export function fitSides(left: number, right: number, w: number): { left: number; right: number } {
  const room = Math.max(0, w - KEEP.w);
  if (!w || left + right <= room) return { left, right };
  const scale = room / (left + right);
  return { left: Math.floor(left * scale), right: Math.floor(right * scale) };
}

/**
 * Where a panel carried to `dock` would sit in the chat, as a frame — what a
 * drop there shows, as it would be drawn. `size` is the size it would have
 * there, and `others` the widths wanted at the sides without it: panels at a
 * side give way to the other side as fitSides has them, and panels at the
 * bottom sit under the conversation, between the sides.
 */
export function dockedFrameAmong(
  dock: Exclude<Dock, "float">,
  area: { w: number; h: number },
  size: Size,
  others: { left: number; right: number },
): Frame {
  if (dock === "bottom") {
    const sides = fitSides(others.left, others.right, area.w);
    const h = Math.max(0, Math.min(size.height, area.h - KEEP.h));
    return { x: sides.left, y: area.h - h, w: Math.max(0, area.w - sides.left - sides.right), h };
  }
  const sides = dock === "left" ? fitSides(size.width, others.right, area.w) : fitSides(others.left, size.width, area.w);
  const w = sides[dock];
  return { x: dock === "left" ? 0 : area.w - w, y: 0, w, h: area.h };
}
