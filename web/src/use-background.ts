import { useEffect, useRef, useState } from "react";
import { api, type BackgroundState } from "./api";

const EMPTY: BackgroundState = { supported: false, jobs: [], statuses: [], widgets: [] };

/**
 * Jobs the agent left running, and what extensions say about themselves,
 * asked for every few seconds while the page is looked at — more often while
 * something is running. `nudge` asks at once: an extension just changed its
 * status, or a job was stopped.
 */
export function useBackground(sessionId: string, busy: boolean, nudge: unknown): [BackgroundState, () => void] {
  const [state, setState] = useState<BackgroundState>(EMPTY);
  const current = useRef(sessionId);
  current.current = sessionId;
  const [tick, setTick] = useState(0);
  useEffect(() => setState(EMPTY), [sessionId]);
  useEffect(() => {
    let live = true;
    const load = () => {
      if (document.hidden) return;
      api.background(sessionId).then(
        (s) => live && current.current === sessionId && setState(normalize(s)),
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

/**
 * Only what the chat can draw. A server from before this endpoint, or a proxy
 * answering in its place, sends something else, and a missing list here was a
 * TypeError that took the whole page down with it.
 */
function normalize(s: Partial<BackgroundState> | null | undefined): BackgroundState {
  const list = <T,>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : []);
  return { supported: s?.supported === true, jobs: list(s?.jobs), statuses: list(s?.statuses), widgets: list(s?.widgets) };
}
