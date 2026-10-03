import { lazy, type ComponentType } from "react";

/**
 * A component fetched when it is first drawn, from a module that exports it by
 * name: `lazyComponent(() => import("./components/Page"), "Page")`. Without
 * this the page, and everything only it uses, is part of the file that has to
 * be fetched and read before anything is drawn.
 */
export function lazyComponent<M extends Record<K, ComponentType<any>>, K extends keyof M>(load: () => Promise<M>, name: K) {
  return lazy(async () => ({ default: (await load())[name] }));
}
