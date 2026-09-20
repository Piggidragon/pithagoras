/** What a context window may be; the server refuses anything else, so the field can say so first. */
export const WINDOW_MIN = 1_024;
export const WINDOW_MAX = 10_000_000;

export type ParsedWindow =
  | { kind: "empty" }
  | { kind: "ok"; tokens: number }
  | { kind: "bad"; message: string };

/** A typed window: digits, with the spaces, commas, dots and underscores people group them by ignored. */
export function parseWindow(text: string): ParsedWindow {
  const digits = text.replace(/[\s,._]/g, "");
  if (!digits) return { kind: "empty" };
  const n = Number(digits);
  if (!Number.isInteger(n) || n < WINDOW_MIN || n > WINDOW_MAX) {
    return {
      kind: "bad",
      message: `Enter the window as a whole number of tokens, from ${WINDOW_MIN.toLocaleString("en-US")} to ${WINDOW_MAX.toLocaleString("en-US")}`,
    };
  }
  return { kind: "ok", tokens: n };
}
