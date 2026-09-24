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
const WINDOWS = ".voice-browser-window.is-open, .voice-terminal-window.is-open, .voice-files-window.is-open, .session-canvases.is-open .canvas-panel";
/** Kept clear between two windows, so that neither's edge or shadow is taken for the other's. */
const GAP = 16;
/** Kept clear at the edges of the area a window lives in. */
const EDGE = 8;

type Box = { left: number; top: number; right: number; bottom: number };

/**
 * How far each edge of a window may go, in the page's coordinates.
 *
 * Inside the area it belongs to — the voice stage, or the chat's workspace for
 * the canvas, which hangs over it and would otherwise reach under the sidebar —
 * and never over another window: one beside it stops the edge that faces it.
 * Below, the voice dock and the stage's buttons stop it as well. The orb does
 * not: it moves aside for a window rather than holding one back (see
 * placePresence in VoiceStage).
 */
export function limitsFor(el: HTMLElement, box: Box = el.getBoundingClientRect()): Box {
  const areaEl = el.closest(".voice-stage") ?? el.closest(".session-workspace") ?? el.offsetParent;
  const area = areaEl?.getBoundingClientRect() ?? { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
  const out = { left: area.left + EDGE, top: area.top, right: area.right - EDGE, bottom: area.bottom - EDGE };
  const root = el.closest(".session-workspace") ?? document;
  for (const other of root.querySelectorAll<HTMLElement>(WINDOWS)) {
    if (other === el || other.contains(el) || el.contains(other)) continue;
    const o = other.getBoundingClientRect();
    if (!o.width || !o.height || getComputedStyle(other).visibility === "hidden") continue;
    const beside = o.top < box.bottom && o.bottom > box.top;
    if (beside && o.left >= box.right - 1) out.right = Math.min(out.right, o.left - GAP);
    else if (beside && o.right <= box.left + 1) out.left = Math.max(out.left, o.right + GAP);
    else if (o.left < box.right && o.right > box.left && o.top >= box.bottom - 1) out.bottom = Math.min(out.bottom, o.top - GAP);
  }
  const stage = el.closest(".voice-stage");
  for (const below of stage?.querySelectorAll<HTMLElement>(".voice-presence, .voice-utilities") ?? []) {
    const o = below.getBoundingClientRect();
    if (o.width && o.left < box.right && o.right > box.left && o.top >= box.bottom - 1) out.bottom = Math.min(out.bottom, o.top - GAP);
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
  const limit = limitsFor(el, box);
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
    if (edge.includes("e")) el.style.width = `${fit(start.width + dx, MIN.width, limit.right - box.left)}px`;
    if (edge.includes("w")) {
      // Growing leftwards: the right edge stays where it was.
      const width = fit(start.width - dx, MIN.width, box.right - limit.left);
      el.style.width = `${width}px`;
      if (mode === "pin") el.style.left = `${start.left + start.width - width}px`;
    }
    if (edge.includes("s")) el.style.height = `${fit(start.height + dy, MIN.height, limit.bottom - box.top)}px`;
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
