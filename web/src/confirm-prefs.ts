import { useState } from "react";

const KEY = "confirmDeletes";

/**
 * Whether deleting something asks first.
 *
 * On by default, and kept per browser like the other preferences of the page
 * rather than on the server: a phone that trips over a delete button is not
 * made safer by the laptop having turned the question off.
 */
export function asksBeforeDeleting(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setAsksBeforeDeleting(ask: boolean): void {
  try {
    localStorage.setItem(KEY, ask ? "on" : "off");
  } catch {
    // Storage blocked: the question keeps being asked, which is the safe side.
  }
}

export function useAsksBeforeDeleting() {
  const [ask, setAsk] = useState(asksBeforeDeleting);
  return [
    ask,
    (next: boolean) => {
      setAsksBeforeDeleting(next);
      setAsk(next);
    },
  ] as const;
}
