/**
 * Running pi's terminal components for a browser.
 *
 * An extension that draws its own screen does it with pi-tui components and
 * ctx.ui.custom(). Every host that is not a terminal has so far answered that
 * call with undefined, so the screen never appeared and the extension sat
 * waiting for a choice nobody was ever offered — pi's own RPC mode does
 * exactly this. The alternative was to re-write each extension's UI in React,
 * once per extension, forever.
 *
 * So the component is run here, unchanged, and what it drew is sent on. The
 * browser already has a terminal emulator for the shell panel, which makes the
 * frame itself the translation: lines of ANSI go out, keystrokes come back as
 * the byte sequences a TTY would have sent. Anything pi's components can draw
 * arrives intact, including the ones written after this file.
 */

/** What this bridge needs of a pi-tui component. The rest of it is its own business. */
export interface TuiComponent {
  render(width: number): string[];
  handleInput?(data: string): void;
  invalidate?(): void;
  dispose?(): void;
}

type InputResult = { consume?: boolean; data?: string } | undefined;
type InputListener = (data: string) => InputResult;

/** pi-tui's zero-width cursor marker. Copied rather than imported — see tui-runtime. */
const CURSOR_MARKER = "\u001b_pi:c\u0007";

/**
 * Styles must not bleed past the line they were set on, and the erase that
 * follows paints in whatever background is current — so the reset comes first.
 */
const LINE_RESET = "\u001b[0m\u001b]8;;\u0007";

/** pi renders at most this often; a component that asks on every keystroke gets one frame. */
const MIN_FRAME_MS = 16;

interface Overlay {
  component: TuiComponent;
  hidden: boolean;
  capturing: boolean;
  handle: OverlayHandle;
}

/** What showOverlay() hands back, as pi-tui defines it. */
export interface OverlayHandle {
  hide(): void;
  setHidden(hidden: boolean): void;
  isHidden(): boolean;
  focus(): void;
  unfocus(options?: { target: TuiComponent | null }): void;
  isFocused(): boolean;
}

/** A screen, and how many rows of it there are, so the page can be that tall. */
export interface TuiFrame {
  data: string;
  lines: number;
}

/**
 * One screen's worth of ANSI, addressed to a terminal of `rows` rows.
 *
 * The whole viewport is repainted every time rather than diffed: the browser
 * may have missed frames, or have only just opened the dialog, and a diff is
 * only correct against the exact screen it was computed from.
 */
export function buildFrame(lines: string[], rows: number): string {
  // A component sizes itself to its content, not to the viewport. When it
  // overflows, the bottom is what stays — that is where a selector puts the
  // key hints and an editor puts the cursor.
  const view = lines.length > rows ? lines.slice(lines.length - rows) : lines;
  const body = view
    .map((line) => line.split(CURSOR_MARKER).join("") + LINE_RESET + "\u001b[K")
    .join("\r\n");
  // No trailing newline: writing one on the last row would scroll the screen
  // and put every following frame one line out.
  return "\u001b[?25l\u001b[H" + body + "\u001b[J";
}

/**
 * A component, the terminal it thinks it is drawing into, and the frames it produced.
 *
 * This stands in for pi-tui's TUI class, which is not reachable from here and
 * would be the wrong shape anyway: it writes cursor-movement diffs to a file
 * descriptor. Components only ever ask a TUI for four things — render me
 * again, take my focus, watch raw input, put this on top — and those are what
 * this provides.
 */
export class TuiSurface {
  children: TuiComponent[] = [];
  /** Set by pi-tui components that want key-release events. Nothing here sends them. */
  wantsKeyRelease = false;
  onDebug?: () => void;

  private overlays: Overlay[] = [];
  private listeners: InputListener[] = [];
  private focused: TuiComponent | null = null;
  private restore: TuiComponent | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastFrameAt = 0;
  private stopped = false;
  private cols: number;
  private rows: number;
  private readonly onFrame: (frame: TuiFrame) => void;

  /** Stands in for pi-tui's Terminal. Components read the size; the writes go nowhere. */
  readonly terminal: Record<string, unknown>;

  constructor(opts: { cols: number; rows: number; onFrame: (frame: TuiFrame) => void }) {
    this.cols = clampCols(opts.cols);
    this.rows = clampRows(opts.rows);
    this.onFrame = opts.onFrame;
    const surface = this;
    this.terminal = {
      get columns() {
        return surface.cols;
      },
      get rows() {
        return surface.rows;
      },
      get kittyProtocolActive() {
        return false;
      },
      start: () => {},
      stop: () => {},
      drainInput: async () => {},
      write: () => {},
      moveBy: () => {},
      hideCursor: () => {},
      showCursor: () => {},
      clearLine: () => {},
      clearFromCursor: () => {},
      clearScreen: () => {},
      setTitle: () => {},
      setProgress: () => {},
    };
  }

  /** Show a component and give it the keyboard. */
  attach(component: TuiComponent): void {
    this.children = [component];
    this.focused = component;
    this.requestRender(true);
  }

  // --- the TUI surface a component expects -------------------------------

  addChild(component: TuiComponent): void {
    this.children.push(component);
    this.requestRender();
  }

  removeChild(component: TuiComponent): void {
    const at = this.children.indexOf(component);
    if (at >= 0) this.children.splice(at, 1);
    this.requestRender();
  }

  clear(): void {
    this.children = [];
    this.requestRender();
  }

  setFocus(component: TuiComponent | null): void {
    this.focused = component;
  }

  addInputListener(listener: InputListener): () => void {
    this.listeners.push(listener);
    return () => this.removeInputListener(listener);
  }

  removeInputListener(listener: InputListener): void {
    const at = this.listeners.indexOf(listener);
    if (at >= 0) this.listeners.splice(at, 1);
  }

  /**
   * Overlays stack under the screen rather than floating over it.
   *
   * A terminal can composite because it addresses cells; this surface hands
   * over lines. Drawing the overlay after the screen keeps it visible and
   * keeps the component it covers readable, which is the part that matters —
   * the alternative on offer was not drawing it at all.
   */
  showOverlay(component: TuiComponent, options?: { nonCapturing?: boolean }): OverlayHandle {
    const entry: Overlay = {
      component,
      hidden: false,
      capturing: !options?.nonCapturing,
      handle: null as unknown as OverlayHandle,
    };
    entry.handle = {
      hide: () => {
        const at = this.overlays.indexOf(entry);
        if (at < 0) return;
        this.overlays.splice(at, 1);
        if (this.focused === component) this.setFocus(this.restore);
        this.requestRender();
      },
      setHidden: (hidden: boolean) => {
        entry.hidden = hidden;
        this.requestRender();
      },
      isHidden: () => entry.hidden,
      focus: () => {
        if (this.focused !== component) this.restore = this.focused;
        this.setFocus(component);
      },
      unfocus: (opts?: { target: TuiComponent | null }) => {
        this.setFocus(opts ? opts.target : this.restore);
      },
      isFocused: () => this.focused === component,
    };
    this.overlays.push(entry);
    if (entry.capturing) entry.handle.focus();
    this.requestRender();
    return entry.handle;
  }

  hideOverlay(): void {
    this.overlays[this.overlays.length - 1]?.handle.hide();
  }

  hasOverlay(): boolean {
    return this.overlays.some((o) => !o.hidden);
  }

  invalidate(): void {
    for (const c of this.children) c.invalidate?.();
    for (const o of this.overlays) o.component.invalidate?.();
  }

  start(): void {}

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  requestRender(force = false): void {
    if (this.stopped) return;
    if (this.timer) return;
    const due = force ? 0 : Math.max(0, MIN_FRAME_MS - (Date.now() - this.lastFrameAt));
    this.timer = setTimeout(() => {
      this.timer = null;
      this.paint();
    }, due);
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  // TUI knobs that only mean something to a real terminal.
  setClearOnShrink(): void {}
  getClearOnShrink(): boolean {
    return true;
  }
  getShowHardwareCursor(): boolean {
    return false;
  }
  setShowHardwareCursor(): void {}
  setTerminalColorSchemeNotifications(): void {}
  onTerminalColorSchemeChange(): () => void {
    return () => {};
  }
  async queryTerminalBackgroundColor(): Promise<undefined> {
    return undefined;
  }
  async queryTerminalColorScheme(): Promise<undefined> {
    return undefined;
  }
  get fullRedraws(): number {
    return 0;
  }

  // --- what the portal drives ---------------------------------------------

  /** A keystroke from the browser, in the form a terminal would have delivered it. */
  input(data: string): void {
    if (this.stopped) return;
    let payload = data;
    // A copy: a listener is allowed to remove itself while it is being called.
    for (const listener of [...this.listeners]) {
      let result: InputResult;
      try {
        result = listener(payload);
      } catch {
        continue;
      }
      if (typeof result?.data === "string") payload = result.data;
      if (result?.consume) return;
    }
    const target = this.inputTarget();
    try {
      target?.handleInput?.(payload);
    } catch (e) {
      this.fail(e);
      return;
    }
    this.requestRender();
  }

  resize(cols: number, rows: number): void {
    const next = { cols: clampCols(cols), rows: clampRows(rows) };
    if (next.cols === this.cols && next.rows === this.rows) return;
    this.cols = next.cols;
    this.rows = next.rows;
    // Cached renders were laid out for the old width, so they are wrong now.
    this.invalidate();
    this.requestRender(true);
  }

  /** The current screen, without waiting for the next frame. For a page that just opened. */
  frame(): TuiFrame {
    return this.shot(this.compose());
  }

  /** What the component drew, before it is turned into a screen. For a widget, which is text. */
  lines(): string[] {
    return this.compose();
  }

  dispose(): void {
    this.stop();
    for (const o of this.overlays) safely(() => o.component.dispose?.());
    for (const c of this.children) safely(() => c.dispose?.());
    this.overlays = [];
    this.children = [];
    this.listeners = [];
    this.focused = null;
  }

  private inputTarget(): TuiComponent | null {
    if (this.focused) return this.focused;
    const top = [...this.overlays].reverse().find((o) => !o.hidden && o.capturing);
    return top?.component ?? this.children[0] ?? null;
  }

  private compose(): string[] {
    const lines: string[] = [];
    for (const c of this.children) lines.push(...this.draw(c));
    for (const o of this.overlays) if (!o.hidden) lines.push(...this.draw(o.component));
    return lines;
  }

  /**
   * A component that throws takes its own screen down and nothing else. It is
   * somebody else's code running inside a session that is in the middle of
   * something, and the session is worth more than the dialog.
   */
  private draw(component: TuiComponent): string[] {
    try {
      const lines = component.render(this.cols);
      return Array.isArray(lines) ? lines : [];
    } catch (e) {
      return [`  Could not draw this: ${(e as Error).message}`];
    }
  }

  private paint(): void {
    if (this.stopped) return;
    this.lastFrameAt = Date.now();
    this.onFrame(this.shot(this.compose()));
  }

  /** How tall the screen came out, alongside it: the page sizes itself to that. */
  private shot(lines: string[]): TuiFrame {
    return { data: buildFrame(lines, this.rows), lines: Math.min(lines.length, this.rows) };
  }

  private fail(e: unknown): void {
    this.onFrame(this.shot([``, `  The extension's screen stopped: ${(e as Error).message}`]));
    this.stop();
  }
}

// A screen has to be wide enough to hold a border and short enough that a
// component asking for its height does not try to lay out a page.
const clampCols = (n: number) => clamp(n, 20, 400);
const clampRows = (n: number) => clamp(n, 4, 200);

function clamp(n: number, low: number, high: number): number {
  if (!Number.isFinite(n)) return low;
  return Math.min(high, Math.max(low, Math.floor(n)));
}

function safely(fn: () => void): void {
  try {
    fn();
  } catch {
    // Disposal is cleanup; a component that fails at it has nothing left to break.
  }
}

/**
 * The text of a rendered screen, with the styling taken out.
 *
 * Widgets go into the page as plain lines rather than a terminal, so a widget
 * built from a component is flattened to what it says.
 */
export function plainLines(lines: string[]): string[] {
  return lines.map((line) =>
    line
      .split(CURSOR_MARKER)
      .join("")
      // CSI (colours, cursor moves) and OSC (hyperlinks), which is everything
      // pi's components emit.
      .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
      .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "")
      .replace(/\s+$/, "")
  );
}
