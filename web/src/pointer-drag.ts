/**
 * Following one pointer from a press until it is let go: dragging a window's
 * edge, carrying the chat's panels, moving a divider.
 *
 * The pointer is captured on the element pressed, so the moves keep coming
 * when it crosses an iframe, which would otherwise swallow them. Only that
 * pointer is heard: a second finger lifted mid-drag does not end it.
 *
 * It ends when the pointer is let go — or when the browser takes it over (a
 * touch that turns into a pan) or the element goes away mid-drag and takes
 * the capture with it: then no pointerup ever comes, and `end` is told the
 * drag was cancelled rather than dropped. The ends are heard on the way down
 * from window, which every one of them passes, wherever it is fired.
 */
const ENDS = ["pointerup", "pointercancel", "lostpointercapture"] as const;

export function followPointer(
  press: { pointerId: number; currentTarget: EventTarget | null },
  move: (ev: PointerEvent) => void,
  end?: (cancelled: boolean) => void,
): void {
  const handle = press.currentTarget as HTMLElement;
  handle.setPointerCapture(press.pointerId);
  const moved = (ev: PointerEvent) => {
    if (ev.pointerId === press.pointerId) move(ev);
  };
  const done = (ev: PointerEvent) => {
    if (ev.pointerId !== press.pointerId) return;
    handle.removeEventListener("pointermove", moved);
    for (const name of ENDS) window.removeEventListener(name, done, true);
    end?.(ev.type !== "pointerup");
  };
  handle.addEventListener("pointermove", moved);
  for (const name of ENDS) window.addEventListener(name, done, true);
}
