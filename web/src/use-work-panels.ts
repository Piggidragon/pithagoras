import { useLayoutEffect, useRef } from 'react';
export type Panel = 'browser' | 'terminal' | 'canvas' | 'files';
/** Two panels beside the conversation is what fits; a third would cover one of them. */
const MAX_OPEN = 2;

/**
 * Which panels to close so that no more than two stay open: the ones open the
 * longest. `order` is the panels in the order they were opened, and is returned
 * brought up to date.
 */
export function settlePanels(order: Panel[], open: Panel[]): { order: Panel[]; close: Panel[] } {
  const next = order.filter(p => open.includes(p));
  for (const panel of open) if (!next.includes(panel)) next.push(panel);
  const close: Panel[] = [];
  while (next.length > MAX_OPEN) close.push(next.shift()!);
  return { order: next, close };
}

/** Enforce before paint so a third panel never covers the current workspace. */
export function useWorkPanels(open: Record<Panel, boolean>, hide: (panel: Panel) => void) {
  const order = useRef<Panel[]>([]), callback = useRef(hide); callback.current = hide;
  useLayoutEffect(() => {
    const settled = settlePanels(order.current, (Object.keys(open) as Panel[]).filter(p => open[p]));
    order.current = settled.order;
    for (const panel of settled.close) callback.current(panel);
  }, [open.browser, open.terminal, open.canvas, open.files]);
}
