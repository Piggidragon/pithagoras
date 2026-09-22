import { useCallback, useRef, useState } from "react";

/** How far from the end still counts as being at the end, in px. */
const NEAR_END = 48;

/** True when a scrolling box is at, or within a hair of, its end. */
export function atEnd(el: { scrollHeight: number; scrollTop: number; clientHeight: number }): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_END;
}

/**
 * Keep a growing box scrolled to its end — until the person scrolls away.
 *
 * Following is decided by where they are, not by what arrives: at the end, new
 * content keeps them there; scrolled up to read something, it leaves them
 * alone. Jumping to the end on every update is what made scrolling back during
 * a run impossible, since each new line undid the scroll. Scrolling back down
 * to the end picks following up again.
 *
 * The jump is instant. A smooth one fires scroll events on its way that read as
 * the person leaving the end, and it ends up fighting them.
 */
export function useFollowBottom<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const following = useRef(true);
  // The same, for drawing: whether to offer a way back to the end. Kept apart
  // from the ref, which is read on every update and must not wait for a render.
  const [away, setAway] = useState(false);

  /** Wire to the box's onScroll. */
  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    following.current = atEnd(el);
    setAway(!following.current);
  }, []);

  /** Call after content changed; `force` to go to the end whatever they were doing. */
  const follow = useCallback((force = false) => {
    const el = ref.current;
    if (!el) return;
    if (force) following.current = true;
    if (following.current) el.scrollTop = el.scrollHeight;
  }, []);

  return { ref, onScroll, follow, following, away };
}
