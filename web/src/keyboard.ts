/**
 * The on-screen keyboard, on a phone: only the composer moves up for it.
 *
 * Opened, the keyboard covers the bottom of the page, and the browser pushed
 * the whole page up to keep the box being typed in on screen: the chat's
 * header and its buttons went off the top, and came back when it closed. The
 * page is made as tall as what the keyboard leaves instead: the header stays
 * where it is, the conversation is shorter, and the composer sits on the
 * keyboard.
 *
 * Chrome on Android does that itself when asked to (`interactive-widget` in
 * index.html's viewport), and the page's `100dvh` is then what is left. Safari
 * does not: there `--keyboard` on the root is how much of the page the keyboard
 * covers, read from the visual viewport, which the app's height takes off.
 */
export type Visual = { height: number; offsetTop: number; scale: number };

/** How much of the page's bottom the keyboard covers, in px. */
export function keyboardInset(innerHeight: number, visual: Visual): number {
  // Zoomed in, the visual viewport is smaller for that, not for a keyboard.
  if (Math.abs(visual.scale - 1) > 0.01) return 0;
  return Math.max(0, Math.round(innerHeight - visual.height - visual.offsetTop));
}

export function watchKeyboard(win: Window = window): () => void {
  const visual = win.visualViewport;
  if (!visual) return () => {};
  const root = win.document.documentElement;
  const apply = () => {
    const inset = keyboardInset(win.innerHeight, visual);
    root.style.setProperty("--keyboard", `${inset}px`);
    // Pushed up to show the box: put back, now that the box is above the keyboard.
    if (inset > 0 && win.scrollY > 0) win.scrollTo(0, 0);
  };
  apply();
  visual.addEventListener("resize", apply);
  visual.addEventListener("scroll", apply);
  return () => {
    visual.removeEventListener("resize", apply);
    visual.removeEventListener("scroll", apply);
  };
}
