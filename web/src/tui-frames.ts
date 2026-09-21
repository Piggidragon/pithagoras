/**
 * Screens an extension is drawing, on their way from the event stream to the
 * terminal that shows them.
 *
 * They do not go through React state. A frame arrives whenever a component
 * redraws — every keystroke, in an editor — and re-rendering the page around
 * the terminal that many times would be wasted work: the terminal writes the
 * bytes itself and owns what is on screen.
 *
 * The last frame is kept because the request and the terminal do not arrive
 * together. The extension draws first, the dialog opens after, and a frame
 * with nowhere to go would otherwise leave the page blank until the component
 * happened to redraw — which, for a menu waiting on a keypress, is never.
 */
/** A screen, and how many rows of it there are, so the page can be that tall. */
export interface TuiFrame {
  data: string;
  lines: number;
}

export class FrameBus {
  private latest = new Map<string, TuiFrame>();
  private subscribers = new Map<string, (frame: TuiFrame) => void>();

  /** A frame from the server. Delivered if anyone is watching, kept either way. */
  emit(id: string, frame: TuiFrame): void {
    // Every frame repaints the whole screen, so the newest one alone is the
    // truth; holding the ones before it would only replay them in order.
    this.latest.set(id, frame);
    this.subscribers.get(id)?.(frame);
  }

  /**
   * Watch one screen. Whatever arrived before now is delivered straight away,
   * so a terminal that opens late still opens on the current screen.
   */
  subscribe(id: string, onFrame: (frame: TuiFrame) => void): () => void {
    this.subscribers.set(id, onFrame);
    const pending = this.latest.get(id);
    if (pending !== undefined) onFrame(pending);
    return () => {
      if (this.subscribers.get(id) === onFrame) this.subscribers.delete(id);
    };
  }

  /** The screen is over. Without this the last frame of every dialog is kept for the tab's life. */
  forget(id: string): void {
    this.latest.delete(id);
    this.subscribers.delete(id);
  }

  /** Another conversation is being opened, so none of these screens are on the page any more. */
  clear(): void {
    this.latest.clear();
    this.subscribers.clear();
  }
}
