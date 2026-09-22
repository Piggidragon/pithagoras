/** What of a key event, and of where it landed, the rules below need. */
export interface KeyInfo {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** The element that has focus: a text field, a button, or nothing but the page. */
  target?: { tagName?: string; isContentEditable?: boolean } | null;
}

const TEXT_ENTRY = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/** Whether typing here is meant for the thing that has focus. */
export function isTyping(target: KeyInfo["target"]): boolean {
  if (!target) return false;
  return Boolean(target.isContentEditable) || TEXT_ENTRY.has((target.tagName ?? "").toUpperCase());
}

/**
 * `/` from anywhere on the page goes to the message box, ready for a command.
 *
 * Not while typing somewhere else — it is a character there — and not with a
 * modifier, which are the browser's and the system's own.
 */
export function opensComposer(e: KeyInfo): boolean {
  return e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e.target);
}

/**
 * Escape in the message box stops the run.
 *
 * Only when there is nothing typed — the same moment the send button turns
 * into a stop button — so that it can never cost anybody words; not while an
 * input method is composing, where Escape is how a candidate is dismissed; and
 * not when the command list is open, where it closes that instead.
 */
export function stopsRun(ctx: {
  key: string;
  running: boolean;
  empty: boolean;
  composing: boolean;
  paletteOpen: boolean;
}): boolean {
  return ctx.key === "Escape" && ctx.running && ctx.empty && !ctx.composing && !ctx.paletteOpen;
}

/**
 * Enter that means "done", not Enter that picks a word.
 *
 * With an input method — Japanese, Chinese, Korean — Enter first confirms the
 * candidate being composed, and that keydown reaches the page too. Taken as
 * "send", it sent half a sentence. Safari reports the confirming keydown after
 * composition has ended, as keyCode 229, so that is checked as well.
 */
export function isEnter(e: { key: string; keyCode?: number; nativeEvent?: { isComposing?: boolean }; isComposing?: boolean }): boolean {
  if (e.key !== "Enter") return false;
  return !(e.nativeEvent?.isComposing ?? e.isComposing) && e.keyCode !== 229;
}
