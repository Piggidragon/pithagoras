import type { PointerEvent as ReactPointerEvent, RefObject } from "react";

export type Edge = "e" | "w" | "s" | "se" | "sw";

/** Smaller than this a window is no use: a header and a few lines. */
const MIN = { width: 280, height: 180 };

/**
 * Where a window sits is decided by the voice stage's layout — centred, at
 * the side, one of two — through classes and transforms. Dragging an edge
 * takes it out of that: the window is pinned where it is, in pixels, and from
 * then on its size is the person's. `clearSize` hands it back to the layout;
 * the stage does that when the arrangement of windows changes.
 *
 * The canvas panel is not placed by the stage but hangs from the top right of
 * its own corner, so it is only given a size: its left edge and its bottom
 * move, and the corner stays.
 */
export type ResizeMode = "pin" | "anchored";

export function clearSize(el: HTMLElement | null) {
  if (!el?.dataset.sized) return;
  for (const p of ["left", "top", "right", "bottom", "width", "height", "transform", "maxWidth", "maxHeight"] as const) el.style[p] = "";
  delete el.dataset.sized;
}

const ENDS = ["pointerup", "pointercancel", "lostpointercapture"] as const;

/** Every window a voice stage or a chat can have open, the canvas included. */
export const WINDOWS = ".voice-browser-window.is-open, .voice-terminal-window.is-open, .voice-files-window.is-open, .session-canvases.is-open .canvas-panel";
/** Kept clear between two windows, so that neither's edge or shadow is taken for the other's. */
const GAP = 16;
/** Kept clear at the edges of the area a window lives in. */
const EDGE = 8;

type Box = { left: number; top: number; right: number; bottom: number };

/**
 * The windows open around `root` — a chat's workspace, which holds the voice
 * stage's windows and the canvas — that are there to be seen: not one hidden
 * under a maximized browser. What the orb makes room for and what a window
 * being resized stops at are the same windows.
 */
export function openWindows(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(WINDOWS)].filter(w => {
    const o = w.getBoundingClientRect();
    return o.width > 0 && o.height > 0 && getComputedStyle(w).visibility !== "hidden";
  });
}

/** The chat's voice stage, for a window in it or for the canvas, which hangs beside it. */
const stageOf = (el: HTMLElement) => el.closest<HTMLElement>(".voice-stage") ?? el.closest(".session-workspace")?.querySelector<HTMLElement>(".voice-stage") ?? null;

/**
 * How far each edge of a window may go, in the page's coordinates, and the
 * other windows it must stay clear of.
 *
 * Inside the area it belongs to — the voice stage, or the chat's workspace for
 * the canvas, which hangs over it and would otherwise reach under the sidebar.
 * Below, the voice dock and the stage's buttons stop it as well, the canvas's
 * too. The orb does not: it moves aside for a window rather than holding one
 * back (see the effect in VoiceStage that places it). Other windows are for
 * the drag itself to keep clear of (see `clear`): which edge one stops depends
 * on where the drag takes the window.
 */
export function limitsFor(el: HTMLElement): Box & { others: Box[] } {
  const box = el.getBoundingClientRect();
  const areaEl = el.closest(".voice-stage") ?? el.closest(".session-workspace") ?? el.offsetParent;
  const area = areaEl?.getBoundingClientRect() ?? { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
  const out = { left: area.left + EDGE, top: area.top, right: area.right - EDGE, bottom: area.bottom - EDGE };
  const root = el.closest(".session-workspace") ?? document;
  const others = openWindows(root).filter(other => other !== el && !other.contains(el) && !el.contains(other)).map(o => o.getBoundingClientRect());
  for (const below of stageOf(el)?.querySelectorAll<HTMLElement>(".voice-presence, .voice-utilities") ?? []) {
    const o = below.getBoundingClientRect();
    if (o.width && o.left < box.right && o.right > box.left && o.top >= box.bottom - 1) out.bottom = Math.min(out.bottom, o.top - GAP);
  }
  return { ...out, others };
}

/**
 * The window a drag would make, kept clear of every other window by GAP.
 *
 * Only the edges being dragged give way, and only toward a window they were
 * clear of when the drag began: one to the right stops the right edge, one to
 * the left the left edge, one below the bottom. A window off at a corner could
 * stop either: the one that has to give up less does, so the window slides
 * along the other's edge instead of catching on its corner.
 */
export function clear(from: Box, want: Box, edge: Edge, others: Box[]): Box {
  const out = { ...want };
  for (const o of others) {
    if (!(out.left < o.right + GAP && out.right > o.left - GAP && out.top < o.bottom + GAP && out.bottom > o.top - GAP)) continue;
    const ways: { side: "right" | "left" | "bottom"; to: number; cost: number }[] = [];
    if (edge.includes("e") && o.left >= from.right - 1) ways.push({ side: "right", to: o.left - GAP, cost: out.right - (o.left - GAP) });
    if (edge.includes("w") && o.right <= from.left + 1) ways.push({ side: "left", to: o.right + GAP, cost: o.right + GAP - out.left });
    if (edge.includes("s") && o.top >= from.bottom - 1) ways.push({ side: "bottom", to: o.top - GAP, cost: out.bottom - (o.top - GAP) });
    const way = ways.sort((a, b) => a.cost - b.cost)[0];
    if (way) out[way.side] = way.to;
  }
  return out;
}

/** Between the smallest a window may be and what there is room for — never more than the room. */
const fit = (want: number, least: number, room: number) => Math.min(room, Math.max(Math.min(least, room), want));

function begin(e: ReactPointerEvent, el: HTMLElement, edge: Edge, mode: ResizeMode) {
  if (e.button !== 0) return;
  e.preventDefault(); e.stopPropagation();
  const handle = e.currentTarget as HTMLElement;
  handle.setPointerCapture(e.pointerId);
  const box = el.getBoundingClientRect();
  const limit = limitsFor(el);
  const parent = (el.offsetParent as HTMLElement | null)?.getBoundingClientRect() ?? { left: 0, top: 0, width: innerWidth, height: innerHeight, right: innerWidth, bottom: innerHeight };
  const start = { x: e.clientX, y: e.clientY, left: box.left - parent.left, top: box.top - parent.top, width: box.width, height: box.height };
  if (mode === "pin") {
    Object.assign(el.style, { left: `${start.left}px`, top: `${start.top}px`, width: `${start.width}px`, height: `${start.height}px`, right: "auto", bottom: "auto", transform: "none" });
  }
  el.style.maxWidth = "none"; el.style.maxHeight = "none";
  el.dataset.sized = "1";
  // No sliding into place while dragging, and no frame under the pointer taking the moves.
  el.style.transition = "none";
  document.body.classList.add("is-resizing");
  // Heard by whatever arranges itself around the windows — the voice orb.
  const moved = () => el.dispatchEvent(new Event("panel-resize", { bubbles: true }));
  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
    // Where the pointer takes each edge, within the area; then clear of the others.
    const want = { ...box.toJSON() as Box };
    if (edge.includes("e")) want.right = box.left + fit(start.width + dx, MIN.width, limit.right - box.left);
    if (edge.includes("w")) want.left = box.right - fit(start.width - dx, MIN.width, box.right - limit.left);
    if (edge.includes("s")) want.bottom = box.top + fit(start.height + dy, MIN.height, limit.bottom - box.top);
    const got = clear(box, want, edge, limit.others);
    const width = Math.max(0, got.right - got.left), height = Math.max(0, got.bottom - got.top);
    if (edge.includes("e") || edge.includes("w")) el.style.width = `${width}px`;
    // Growing leftwards: the right edge stays where it was.
    if (edge.includes("w") && mode === "pin") el.style.left = `${start.left + start.width - width}px`;
    if (edge.includes("s")) el.style.height = `${height}px`;
    moved();
  };
  // Over when the pointer is let go — or when the window closes mid-drag and
  // takes the handle with it: then the capture is lost at the document, and
  // no pointerup ever reaches the handle. Heard on the way down from window,
  // which every one of these passes, wherever it is fired.
  const end = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    handle.removeEventListener("pointermove", move);
    for (const name of ENDS) window.removeEventListener(name, end, true);
    el.style.transition = "";
    document.body.classList.remove("is-resizing");
    moved();
  };
  handle.addEventListener("pointermove", move);
  for (const name of ENDS) window.addEventListener(name, end, true);
}

/** Grips on a window's edges and bottom corners. Hidden on phones, where windows take the width. */
export function ResizeHandles({ target, mode = "pin", edges = ["e", "w", "s", "se", "sw"] }: { target: RefObject<HTMLElement>; mode?: ResizeMode; edges?: Edge[] }) {
  const name: Record<Edge, string> = { e: "right edge", w: "left edge", s: "bottom edge", se: "bottom right corner", sw: "bottom left corner" };
  return <>{edges.map(edge => <div key={edge} className={`resize-handle resize-${edge}`} aria-hidden="true" title={`Drag the ${name[edge]} to resize`}
    onPointerDown={e => { if (target.current) begin(e, target.current, edge, mode); }} />)}</>;
}
