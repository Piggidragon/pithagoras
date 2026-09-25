import { useEffect, useRef, useState } from "react";
import { api, type BackgroundState } from "./api";

const EMPTY: BackgroundState = { supported: false, jobs: [], statuses: [], widgets: [] };

/**
 * Jobs the agent left running, and what extensions say about themselves,
 * asked for every few seconds while the page is looked at — more often while
 * something is running. `nudge` asks at once: an extension just changed its
 * status, or a job was stopped.
 */
export function useBackground(sessionId: string, busy: boolean, nudged: unknown): [BackgroundState, () => void] {
  // An extension can move its status several times a second — a spinner, a
  // count — and each asked again at once, a /proc walk every time.
  const nudge = useThrottled(nudged, NUDGE_MS);
  // Kept with the chat it is of. Cleared in an effect, another chat's state
  // lasted a render into the next, long enough for its status lines to make
  // this one list its commands, which starts its pi.
  const [held, setHeld] = useState<{ sessionId: string; state: BackgroundState }>({ sessionId, state: EMPTY });
  const state = held.sessionId === sessionId ? held.state : EMPTY;
  const current = useRef(sessionId);
  current.current = sessionId;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    const load = () => {
      if (document.hidden) return;
      api.background(sessionId).then(
        (s) => live && current.current === sessionId && setHeld({ sessionId, state: normalize(s) }),
        () => undefined,
      );
    };
    load();
    const running = state.jobs.some((j) => j.state === "running");
    const t = window.setInterval(load, busy || running ? 2000 : 6000);
    const visible = () => !document.hidden && load();
    document.addEventListener("visibilitychange", visible);
    return () => {
      live = false;
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [sessionId, busy, nudge, tick, state.jobs.some((j) => j.state === "running")]);
  return [state, () => setTick((n) => n + 1)];
}

/** How often a moving status asks again, at most. */
const NUDGE_MS = 1500;

/** `value`, changing at most once per `ms`; the last of a burst still comes through. */
function useThrottled<T>(value: T, ms: number): T {
  const [shown, setShown] = useState(value);
  const last = useRef(0);
  useEffect(() => {
    if (Object.is(value, shown)) return;
    const t = window.setTimeout(() => {
      last.current = Date.now();
      setShown(value);
    }, Math.max(0, last.current + ms - Date.now()));
    return () => window.clearTimeout(t);
  }, [value, shown, ms]);
  return shown;
}

/**
 * Only what the chat can draw. A server from before this endpoint, or a proxy
 * answering in its place, sends something else, and a missing list here was a
 * TypeError that took the whole page down with it.
 */
function normalize(s: Partial<BackgroundState> | null | undefined): BackgroundState {
  const list = <T,>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : []);
  return { supported: s?.supported === true, jobs: list(s?.jobs), statuses: list(s?.statuses), widgets: list(s?.widgets) };
}
