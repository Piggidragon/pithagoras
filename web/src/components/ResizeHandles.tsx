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

function begin(e: ReactPointerEvent, el: HTMLElement, edge: Edge, mode: ResizeMode) {
  if (e.button !== 0) return;
  e.preventDefault(); e.stopPropagation();
  const handle = e.currentTarget as HTMLElement;
  handle.setPointerCapture(e.pointerId);
  const box = el.getBoundingClientRect();
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
  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
    if (edge.includes("e")) el.style.width = `${Math.max(MIN.width, Math.min(start.width + dx, parent.width - start.left))}px`;
    if (edge.includes("w")) {
      // Growing leftwards: the right edge stays where it was.
      const width = Math.max(MIN.width, Math.min(start.width - dx, mode === "pin" ? start.left + start.width : box.right - 8));
      el.style.width = `${width}px`;
      if (mode === "pin") el.style.left = `${start.left + start.width - width}px`;
    }
    if (edge.includes("s")) el.style.height = `${Math.max(MIN.height, Math.min(start.height + dy, (mode === "pin" ? parent.height - start.top : innerHeight - box.top) - 8))}px`;
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
