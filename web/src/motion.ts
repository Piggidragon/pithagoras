import { useCallback, useLayoutEffect, useRef, useSyncExternalStore, type MutableRefObject, type RefObject } from "react";
import { local } from "./safe-storage";

/**
 * The extra animations: a layer of flourish on top of the motion the portal
 * always had (index.css and styles/*.css), switched off in one place.
 *
 * Whether it plays is decided once, by `installMotion`, and written on the page
 * as `data-motion="fancy"` on <html>. The style sheet (styles/motion.css) and
 * the code here both read that and nothing else, so they cannot disagree.
 * Two things turn it off: the switch in Settings → This browser, kept in this
 * browser like `panelDock`, and the system's own "reduce motion", which wins
 * whatever the switch says. Off, the page is exactly what it was before.
 *
 * What is made here is for things CSS cannot do alone: an element that is
 * already gone from the page when it is meant to leave (`useLeaveRef`, `keep`),
 * and rows that slide to where they now are (`useFlip`, `mark`). Both only
 * decorate: the real page changes at once, as it always did, and a picture
 * of what was there plays out above it and never takes a click.
 */

const KEY = "animations";
const REDUCED = "(prefers-reduced-motion: reduce)";

/** Whether the switch is on. It is, until somebody turns it off: storage that cannot be read reads as on. */
export const animationsChosen = (): boolean => local.get(KEY) !== "off";
/** Whether the system asks for less motion. */
export const reducedMotion = (): boolean => typeof matchMedia === "function" && matchMedia(REDUCED).matches;
/** What plays: the switch, unless the system asks against it. */
export const plays = (chosen: boolean, reduced: boolean): boolean => chosen && !reduced;
/** Whether the extra animations play right now, as the page says. */
export const fancy = (): boolean => typeof document !== "undefined" && document.documentElement.dataset.motion === "fancy";

const listeners = new Set<() => void>();

function sync(): void {
  const root = document.documentElement;
  if (plays(animationsChosen(), reducedMotion())) root.dataset.motion = "fancy";
  else delete root.dataset.motion;
  listeners.forEach((fn) => fn());
}

/** Once, before the first draw: puts the state on the page and keeps it there. */
export function installMotion(): void {
  sync();
  matchMedia(REDUCED).addEventListener("change", sync);
  // Another tab turned them on or off.
  window.addEventListener("storage", (e) => e.key === KEY && sync());
}

export function setAnimations(on: boolean): void {
  local.set(KEY, on ? "on" : "off");
  sync();
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

/** The switch in Settings, and whether the system's own setting makes it moot. */
export function useAnimations() {
  const chosen = useSyncExternalStore(subscribe, animationsChosen);
  const reduced = useSyncExternalStore(subscribe, reducedMotion);
  return { chosen, reduced, set: setAnimations };
}

/* ── Pictures: what leaves is a copy of itself, laid over the page where it was ── */

/** How an element goes: each is a look in `LEAVES`. */
export type Leave = "dialog" | "menu" | "panel" | "row" | "message" | "page" | "gone";

const SPRING = "cubic-bezier(.34, 1.56, .64, 1)";
const OUT = "cubic-bezier(.22, 1, .36, 1)";
const IN = "cubic-bezier(.5, 0, .75, 0)";

const LEAVES: Record<Leave, (el: HTMLElement, delay: number) => Animation[]> = {
  // The dimming lets go and the dialog sinks, tilting back the way it came.
  dialog: (el) => {
    const card = el.firstElementChild as HTMLElement | null;
    return [
      el.animate([{ backgroundColor: getComputedStyle(el).backgroundColor, backdropFilter: getComputedStyle(el).backdropFilter }, { backgroundColor: "transparent", backdropFilter: "blur(0px)" }], { duration: 260, easing: "linear", fill: "both" }),
      ...(card ? [card.animate([{ transform: "none", opacity: 1 }, { transform: "perspective(1000px) translateY(26px) rotateX(8deg) scale(.9)", opacity: 0 }], { duration: 280, easing: IN, fill: "both" })] : []),
    ];
  },
  menu: (el) => [el.animate([{ transform: "none", opacity: 1 }, { transform: "translateY(8px) scale(.92)", opacity: 0 }], { duration: 190, easing: IN, fill: "both" })],
  // Back the way it came: out through the edge it was docked at.
  panel: (el) => {
    const dock = el.dataset.dock;
    const to = dock === "left" ? "translateX(-64px)" : dock === "bottom" ? "translateY(64px)" : dock === "float" ? "translateY(28px) scale(.9)" : "translateX(64px)";
    return [el.animate([{ transform: "none", opacity: 1 }, { transform: to, opacity: 0 }], { duration: 320, easing: IN, fill: "both" })];
  },
  // A deleted row flashes red, then comes apart: shrinks away to the side, out of focus.
  row: (el) => [
    el.animate(
      [
        { transform: "none", opacity: 1, filter: "blur(0px)", boxShadow: "inset 0 0 0 999px rgb(var(--danger) / 0)" },
        { offset: 0.22, transform: "scale(1.025)", opacity: 1, filter: "blur(0px)", boxShadow: "inset 0 0 0 999px rgb(var(--danger) / .2)" },
        { transform: "translateX(-36px) scale(.82) rotate(-2deg)", opacity: 0, filter: "blur(7px)", boxShadow: "inset 0 0 0 999px rgb(var(--danger) / .2)" },
      ],
      { duration: 460, easing: OUT, fill: "both" },
    ),
  ],
  // A message in the conversation: pushed off to the side it was said from, out of focus.
  message: (el, delay) => [el.animate([{ transform: "none", opacity: 1, filter: "blur(0px)" }, { transform: "translateX(48px) scale(.9) rotate(1.5deg)", opacity: 0, filter: "blur(8px)" }], { duration: 440, delay, easing: OUT, fill: "both" })],
  // The page that was there drifts up and away as the next one comes in.
  page: (el) => [el.animate([{ transform: "none", opacity: 1 }, { transform: "translateY(-30px) scale(.97)", opacity: 0 }], { duration: 340, easing: OUT, fill: "both" })],
  // A chat that no longer exists: it shrinks away where it stood.
  gone: (el) => [el.animate([{ transform: "none", opacity: 1 }, { transform: "translateY(14px) scale(.88)", opacity: 0 }], { duration: 520, easing: OUT, fill: "both" })],
};

const MAX_GHOSTS = 8;
const ghosts = new Set<HTMLElement>();
/** Set while a page is being swapped for another, whose own picture covers everything in it. */
let swapping = false;
let swapTimer = 0;
export const swapPages = (on: boolean): void => {
  swapping = on;
  window.clearTimeout(swapTimer);
  // A swap that was begun and never drawn must not leave every picture after it silenced.
  if (on) swapTimer = window.setTimeout(() => (swapping = false), 400);
};

/** What a copy must not keep: ids and roles that would count twice, and what loads or takes focus. */
function scrub(copy: HTMLElement): void {
  copy.querySelectorAll("iframe, video, audio, script").forEach((n) => n.remove());
  for (const el of [copy, ...copy.querySelectorAll<HTMLElement>("[id], [role], [aria-modal], [data-popover-layer], [tabindex], [autofocus], [contenteditable], [title], [name]")]) {
    for (const attr of ["id", "role", "aria-modal", "data-popover-layer", "tabindex", "autofocus", "contenteditable", "title", "name"]) el.removeAttribute(attr);
  }
}

export interface Picture {
  frame: HTMLElement;
  el: HTMLElement;
}

/**
 * A copy of `source` as it looks now, held at the same place on the page, in
 * a frame that can be cut off at `clip`'s edge (a list that scrolls). Not on
 * the page yet: `out` puts it there. Null where there is nothing to show.
 */
export function picture(source: HTMLElement | null, clip?: HTMLElement | null): Picture | null {
  if (!source || !fancy() || !source.isConnected) return null;
  const rect = source.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  const el = source.cloneNode(true) as HTMLElement;
  scrub(el);
  const bounds = clip ? clip.getBoundingClientRect() : new DOMRect(0, 0, innerWidth, innerHeight);
  const frame = document.createElement("div");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("data-ghost", "");
  frame.setAttribute("inert", "");
  Object.assign(frame.style, {
    position: "fixed", left: `${bounds.left}px`, top: `${bounds.top}px`, width: `${bounds.width}px`, height: `${bounds.height}px`,
    overflow: clip ? "hidden" : "visible", pointerEvents: "none", zIndex: "1000",
  });
  // Placed by its box alone: whatever moved the original (a translate, an
  // inset, a margin) is already in where it is.
  Object.assign(el.style, {
    position: "absolute", left: `${rect.left - bounds.left}px`, top: `${rect.top - bounds.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
    right: "auto", bottom: "auto", margin: "0", transform: "none", translate: "none", scale: "none", rotate: "none", maxWidth: "none", maxHeight: "none", minWidth: "0", minHeight: "0",
    animation: "none", transition: "none", pointerEvents: "none",
  });
  frame.append(el);
  return { frame, el };
}

/** Puts a picture on the page and plays it out. */
export function out(shot: Picture | null, how: Leave, delay = 0): void {
  if (!shot || !fancy() || swapping) return;
  const { frame, el } = shot;
  for (const old of ghosts) if (ghosts.size >= MAX_GHOSTS) { old.remove(); ghosts.delete(old); }
  document.body.append(frame);
  ghosts.add(frame);
  const done = () => {
    frame.remove();
    ghosts.delete(frame);
  };
  const played = LEAVES[how](el, delay);
  // Not trusted to end: a page in the background may never get the frame it needs to say so.
  void Promise.allSettled(played.map((a) => a.finished)).then(done);
  window.setTimeout(done, 1200 + delay);
}

/** A picture of `el` taken now, to be played out once it is gone from the page. */
export function keep(el: HTMLElement | null, clip?: HTMLElement | null): (how: Leave) => void {
  const shot = picture(el, clip);
  return (how) => out(shot, how);
}

/**
 * A ref that sees its element go. It is the element that is given back to
 * React's `ref` as it leaves — still on the page, for that moment — so a picture
 * can be taken then, and played out where it was. Stable, so React does not
 * call it with null again at every render. `into` is the ref the element
 * would have had; `how` may say "not this time" with null.
 */
export function useLeaveRef<T extends HTMLElement>(how: Leave | (() => Leave | null), into?: MutableRefObject<T | null>) {
  const held = useRef<{ el: T | null; since: number; how: Leave | (() => Leave | null) }>({ el: null, since: 0, how });
  held.current.how = how;
  return useCallback(
    (el: T | null) => {
      const h = held.current;
      if (into) into.current = el;
      if (el) {
        h.el = el;
        h.since = performance.now();
        return;
      }
      const gone = h.el;
      h.el = null;
      // Development React puts an element away and back at once to see that it
      // can: nobody saw it, so nothing leaves.
      if (!gone || performance.now() - h.since < 150) return;
      const kind = typeof h.how === "function" ? h.how() : h.how;
      if (kind && !swapping) out(picture(gone), kind);
    },
    [into],
  );
}

/* ── Moves ── */

/**
 * A panel carried from one place to another: it goes from where it was to
 * where it now is as one move, over the page, not out of one place and into
 * the other. Measured from `from`, which was taken before the change. What
 * is in `hold` has the entrance of its own taken off for the while.
 */
export function glide(el: HTMLElement, from: DOMRect, hold: HTMLElement[] = []): void {
  if (!fancy() || typeof el.animate !== "function") return;
  for (const h of hold) h.setAttribute("data-flown", "");
  const to = el.getBoundingClientRect();
  const done = () => hold.forEach((h) => h.removeAttribute("data-flown"));
  if (to.width < 1 || to.height < 1 || from.width < 1 || from.height < 1) return done();
  const at = (transform: string) => ({ transformOrigin: "0 0", transform });
  el.animate([at(`translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`), at("none")], { duration: 620, easing: SPRING }).finished.then(done, done);
}

/** Sent: the arrow goes up and out, a new one rises where it was, and a ring leaves the button. */
export function launch(button: Element | null): void {
  if (!button || !fancy()) return;
  button.querySelector("svg")?.animate(
    [
      { transform: "none", opacity: 1 },
      { offset: 0.35, transform: "translateY(-30px) scale(.7)", opacity: 0 },
      { offset: 0.36, transform: "translateY(26px) scale(.7)", opacity: 0 },
      { transform: "none", opacity: 1 },
    ],
    { duration: 560, easing: "cubic-bezier(.34, 1.4, .64, 1)" },
  );
  button.animate([{ boxShadow: "0 0 0 0 rgb(var(--fg) / .4)" }, { boxShadow: "0 0 0 16px rgb(var(--fg) / 0)" }], { duration: 560, easing: OUT });
}

/* ── Rows that slide to where they now are ── */

/** A row that slid or came in, to know how far it is from where it lies while it is on its way. */
const moving = new WeakMap<Element, Animation>();
/** How far a row on its way is drawn from where it lies, down the page. */
function lifted(el: Element): number {
  if (moving.get(el)?.playState !== "running") return 0;
  const [, y] = getComputedStyle(el).translate.split(" ");
  return Number.parseFloat(y ?? "") || 0;
}

/** Where each row lies: by its `data-flip` (or `data-key`) and how far down its box, in the page or in the box's own content. */
function spotsOf(box: HTMLElement, attr: string, inContent: boolean): Map<string, number> {
  const spots = new Map<string, number>();
  const top = box.getBoundingClientRect().top - (inContent ? box.scrollTop : 0);
  box.querySelectorAll<HTMLElement>(`[${attr}]`).forEach((el) => spots.set(el.getAttribute(attr)!, el.getBoundingClientRect().top - lifted(el) - top));
  return spots;
}

const SLIDE = { duration: 420, easing: SPRING } as const;

/** Rows that were somewhere else slide from there, and new ones come in. */
function reflow(box: HTMLElement, attr: string, before: Map<string, number>, now: Map<string, number>, entering: boolean): Animation[] {
  const played: Animation[] = [];
  const first = before.size === 0;
  // Where a row has gone, the others wait for it to break apart before they close the gap.
  const wait = [...before.keys()].some((key) => !now.has(key)) ? 150 : 0;
  let order = 0;
  box.querySelectorAll<HTMLElement>(`[${attr}]`).forEach((el) => {
    const key = el.getAttribute(attr)!;
    const was = before.get(key);
    let a: Animation | undefined;
    if (was === undefined) {
      if (!entering) return;
      // The first rows to arrive come one after another; one that arrives later, on its own.
      a = el.animate(
        [
          { translate: "-28px 0", scale: ".9", opacity: 0, filter: "blur(5px)", backgroundColor: "rgb(var(--accent) / .22)" },
          { translate: "0 0", scale: "1", opacity: 1, filter: "blur(0px)", backgroundColor: "rgb(var(--accent) / 0)" },
        ],
        { duration: 560, delay: first ? Math.min(order++, 10) * 34 : 0, easing: SPRING, fill: "backwards" },
      );
    } else {
      const dy = was - now.get(key)!;
      // Not rows that jumped a whole screen: those are another list, not a move.
      if (Math.abs(dy) < 2 || Math.abs(dy) > 700) return;
      a = el.animate([{ translate: `0 ${dy}px` }, { translate: "0 0" }], { ...SLIDE, delay: wait, fill: "backwards" });
    }
    moving.set(el, a);
    played.push(a);
  });
  return played;
}

/**
 * A list whose rows slide into their new places when the order changes
 * (`order` is any string that changes with it) and rise in when they are new.
 * Rows carry `data-flip`, their id; the box this returns is the one that
 * holds them, and scrolls if the list does.
 *
 * Looked at after every draw, so that what a row is compared with is where it
 * last was and not where it was when the order last changed, but only played
 * when the order has: a folder opened, a window resized, a search typed
 * (`quiet`) moves rows without that being news. A list that brings its
 * new rows in itself says `entering` is false.
 */
export function useFlip<T extends HTMLElement>(order: string, quiet = false, entering = true): RefObject<T> {
  const box = useRef<T>(null);
  const last = useRef<{ order: string; spots: Map<string, number> } | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    // Nothing is looked at while they are off: this is drawn with every change to the list.
    if (!fancy()) return void (last.current = null);
    const spots = spotsOf(el, "data-flip", true);
    const before = last.current;
    last.current = { order, spots };
    if (before && before.order !== order && !quiet) reflow(el, "data-flip", before.spots, spots, entering);
  });
  return box;
}

/**
 * Where a list's rows are, and a picture of each that is on screen, taken
 * before something is done to them. `settle` then plays out those that are gone
 * and slides the others — for a message deleted, whose row goes when the
 * server says so, a moment after it was asked.
 */
export interface Mark {
  box: HTMLElement;
  clip: HTMLElement | null;
  spots: Map<string, number>;
  shots: Map<string, Picture>;
  at: number;
}

export function mark(box: HTMLElement | null, clip: HTMLElement | null): Mark | null {
  if (!box || !fancy()) return null;
  const spots = spotsOf(box, "data-key", false);
  const shots = new Map<string, Picture>();
  const view = (clip ?? box).getBoundingClientRect();
  for (const el of box.querySelectorAll<HTMLElement>(":scope > [data-key]")) {
    const r = el.getBoundingClientRect();
    if (r.bottom < view.top || r.top > view.bottom || shots.size >= 40) continue;
    const shot = picture(el, clip);
    if (shot) shots.set(el.getAttribute("data-key")!, shot);
  }
  return { box, clip, spots, shots, at: performance.now() };
}

/** Whether the list has changed from what was marked, and so the mark is done with. */
export function settle(m: Mark, how: Leave = "message"): boolean {
  const now = spotsOf(m.box, "data-key", false);
  let changed = false;
  let n = 0;
  for (const [key, shot] of m.shots) {
    if (now.has(key)) continue;
    // One after another, the way they were said.
    out(shot, how, Math.min(n++ * 45, 400));
    changed = true;
  }
  if (!changed) return false;
  const slid = reflow(m.box, "data-key", m.spots, now, false);
  // Rows that start from below the end of the list would make it scroll further
  // than it does: a conversation that is followed at its end took that for being
  // left behind, and offered the way back to it for good. So what is below the
  // list's edge is cut off while they slide, and the scrolling box does not see it.
  if (slid.length) {
    const { overflow, overflowClipMargin } = m.box.style;
    Object.assign(m.box.style, { overflow: "clip", overflowClipMargin: "8px" });
    const restore = () => Object.assign(m.box.style, { overflow, overflowClipMargin });
    void Promise.allSettled(slid.map((a) => a.finished)).then(restore);
  }
  return true;
}
