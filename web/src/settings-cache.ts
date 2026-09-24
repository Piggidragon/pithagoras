import { useCallback, useEffect, useState } from "react";

/**
 * What Settings shows, kept between one opening and the next.
 *
 * Each page used to fetch when it was switched to, then draw: the dialog
 * opened on a placeholder that one part at a time turned into the page, and
 * the rail's extension settings arrived last of all. Kept here, a page that
 * was seen before draws at once and is quietly brought up to date, and what
 * is fetched ahead of time is there before anyone asks.
 */

type Entry = { value?: unknown; at: number; pending?: Promise<unknown> };
const store = new Map<string, Entry>();
const listeners = new Map<string, Set<(value: unknown) => void>>();

export function peek<T>(key: string): T | undefined {
  return store.get(key)?.value as T | undefined;
}

function publish(key: string, value: unknown) {
  store.set(key, { value, at: Date.now() });
  for (const fn of listeners.get(key) ?? []) fn(value);
}

/**
 * The value, fetched unless one younger than `freshMs` is kept. Asking again
 * while a fetch is on its way waits for that one rather than starting another.
 */
export function load<T>(key: string, fetcher: () => Promise<T>, freshMs = 0): Promise<T> {
  const had = store.get(key);
  if (had?.pending) return had.pending as Promise<T>;
  if (had && "value" in had && had.value !== undefined && Date.now() - had.at < freshMs) return Promise.resolve(had.value as T);
  const pending = fetcher().then(
    (value) => {
      publish(key, value);
      return value;
    },
    (e) => {
      const entry = store.get(key);
      if (entry?.pending === pending) store.set(key, { value: entry.value, at: entry.at });
      throw e;
    },
  );
  store.set(key, { ...had, at: had?.at ?? 0, pending });
  return pending;
}

/** Drop a kept value, so the next look fetches it: after a change that makes it stale. */
export function forget(key: string) {
  const had = store.get(key);
  if (had) store.set(key, { value: had.value, at: 0 });
}

/**
 * A kept value in a component: drawn from what is kept at once, fetched
 * again on mount when older than `freshMs`, and updated wherever else the
 * same key is loaded.
 */
export function useCached<T>(key: string, fetcher: () => Promise<T>, { freshMs = 3000, onError }: { freshMs?: number; onError?: (e: Error) => void } = {}) {
  const [value, setValue] = useState<T | undefined>(() => peek<T>(key));
  const [failed, setFailed] = useState<Error | null>(null);

  useEffect(() => {
    const fn = (v: unknown) => setValue(v as T);
    let set = listeners.get(key);
    if (!set) listeners.set(key, (set = new Set()));
    set.add(fn);
    return () => void set!.delete(fn);
  }, [key]);

  const fetch = useCallback(
    (fresh: number) =>
      load(key, fetcher, fresh).then(
        (v) => {
          setFailed(null);
          return v;
        },
        (e: Error) => {
          setFailed(e);
          onError?.(e);
          return undefined;
        },
      ),
    // The fetcher and handler are the caller's; the key is what names the data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  useEffect(() => {
    void fetch(freshMs);
  }, [fetch]);

  const reload = useCallback(() => fetch(0), [fetch]);
  return { value, failed, reload };
}
