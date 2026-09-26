import { useCallback, useEffect, useRef, useState } from "react";

/** How far from the end still counts as being at the end, in px. */
const NEAR_END = 48;
/** At the end, not near it: where a box whose content shrank is put back. */
const AT_END = 2;

const distance = (el: { scrollHeight: number; scrollTop: number; clientHeight: number }) => el.scrollHeight - el.scrollTop - el.clientHeight;

/** True when a scrolling box is at, or within a hair of, its end. */
export function atEnd(el: { scrollHeight: number; scrollTop: number; clientHeight: number }): boolean {
  return distance(el) <= NEAR_END;
}

/**
 * Keep a growing box scrolled to its end — until the person scrolls away.
 *
 * Following is decided by where they go, not by what arrives: at the end, new
 * content keeps them there; scrolled up to read something, it leaves them
 * alone. Jumping to the end on every update is what made scrolling back during
 * a run impossible, since each new line undid the scroll. Scrolling back down
 * to the end picks following up again.
 *
 * Scrolling up is what stops it, however little. It was being further than a
 * threshold from the end, which snagged both ways while the agent wrote: a
 * short scroll up, within the threshold, was undone by the next word; and the
 * box's own jump to the end, heard a frame later, was measured against what
 * had arrived since — more than the threshold, and following stopped on its
 * own.
 *
 * It holds the end whenever the content grows, not only when something is
 * added: a block of code that highlights, a picture that loads, the thinking
 * that grows into its lines. Those left the end behind until the next word,
 * then jumped to it.
 *
 * The jump is instant. A smooth one fires scroll events on its way that read as
 * the person leaving the end, and it ends up fighting them.
 */
export function useFollowBottom<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const following = useRef(true);
  // Where the box was last seen, to tell up from down.
  const top = useRef(0);
  // The same, for drawing: whether to offer a way back to the end. Kept apart
  // from the ref, which is read on every update and must not wait for a render.
  const [away, setAway] = useState(false);

  const toEnd = useCallback((el: HTMLElement) => {
    el.scrollTop = el.scrollHeight;
    top.current = el.scrollTop;
  }, []);

  /** Wire to the box's onScroll. */
  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const left = distance(el);
    // At the very end — or put there because what was below it went away.
    if (left <= AT_END) following.current = true;
    // Up, and not to the end: the person, reading back.
    else if (el.scrollTop < top.current - 0.5) following.current = false;
    // Back down to near the end picks it up again.
    else if (el.scrollTop > top.current + 0.5 && left <= NEAR_END) following.current = true;
    top.current = el.scrollTop;
    setAway(!following.current && !atEnd(el));
  }, []);

  /**
   * Wire to the box's onWheel: a turn of the wheel upwards is the person
   * leaving the end before the box has moved, so the next word does not undo it.
   */
  const onWheel = useCallback((e: { deltaY: number }) => {
    if (e.deltaY < 0 && ref.current && ref.current.scrollTop > 0) following.current = false;
  }, []);

  /** Call after content changed; `force` to go to the end whatever they were doing. */
  const follow = useCallback((force = false) => {
    const el = ref.current;
    if (!el) return;
    if (force) following.current = true;
    if (following.current) toEnd(el);
    // Said here as well as on scroll: a conversation too short to scroll fires
    // no scroll event, and the way back to the end offered in the last one,
    // scrolled up, stayed on screen in this one for good.
    setAway(!following.current && !atEnd(el));
  }, [toEnd]);

  // Whatever grows — the box's content, or the box itself shrinking as the
  // composer or the keyboard takes room — keeps the end in view while following.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (following.current) toEnd(el);
      else setAway(!atEnd(el));
    });
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    // A box whose content is a list of its own children — the terminal's runs —
    // grows by the ones added.
    const added = new MutationObserver((changes) => {
      for (const change of changes) for (const node of change.addedNodes) if (node instanceof Element) observer.observe(node);
    });
    added.observe(el, { childList: true });
    return () => {
      observer.disconnect();
      added.disconnect();
    };
  }, [toEnd]);

  return { ref, onScroll, onWheel, follow, following, away };
}
