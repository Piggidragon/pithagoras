import { initTheme } from "@earendil-works/pi-coding-agent";

/**
 * The two things a pi component is built with: a theme and a keybinding table.
 *
 * pi publishes both to its own modes and not to embedders — the package's
 * export map stops at the entry point — so they are reached by resolving that
 * entry and walking to the file beside it. That is a deliberate reach into
 * somebody else's package, and the reason it is worth it: the alternative is a
 * second copy of pi's colours and key table here, which would drift silently
 * and render extensions in a scheme their author never chose.
 *
 * If the reach fails, nothing here guesses. Custom UI goes back to what every
 * non-terminal host does today and offers none, which is a visible gap rather
 * than a screen that looks subtly wrong.
 */
export interface TuiRuntime {
  /** pi's Theme instance, handed to every component. */
  theme: unknown;
  /** pi's KeybindingsManager, so a component matches the keys pi documents. */
  keybindings: unknown;
}

let loaded: Promise<TuiRuntime | null> | undefined;

/** Loaded once per process; the failure is remembered too, so it is logged once. */
export function tuiRuntime(): Promise<TuiRuntime | null> {
  return (loaded ??= load());
}

async function load(): Promise<TuiRuntime | null> {
  try {
    // Without this pi's theme singleton throws on first use rather than
    // defaulting, and every component built against it would fail at render.
    initTheme(process.env.PI_THEME || undefined, false);
    const entry = import.meta.resolve("@earendil-works/pi-coding-agent");
    const themes = (await import(new URL("modes/interactive/theme/theme.js", entry).href)) as {
      theme: unknown;
    };
    const keys = (await import(new URL("core/keybindings.js", entry).href)) as {
      KeybindingsManager: { create(): unknown };
    };
    const keybindings = keys.KeybindingsManager.create();
    // Components that were not handed a manager reach for pi-tui's global one,
    // which otherwise builds itself from the TUI defaults alone and disagrees
    // with the one above about every app-level key.
    await adoptGlobalKeybindings(entry, keybindings);
    return { theme: themes.theme, keybindings };
  } catch (e) {
    console.error(
      `[portal] pi's TUI runtime could not be loaded, so extensions cannot draw their own ` +
        `screens: ${(e as Error).message}`
    );
    return null;
  }
}

/**
 * pi-tui is pi's own dependency, so whether npm nested it or hoisted it
 * depends on what else is installed. Neither miss is worth failing over: the
 * components that matter are handed a manager directly, and the global is only
 * the fallback for the ones that are not.
 */
const PI_TUI_CANDIDATES = [
  "../node_modules/@earendil-works/pi-tui/dist/index.js",
  "../../pi-tui/dist/index.js",
];

async function adoptGlobalKeybindings(entry: string, keybindings: unknown): Promise<void> {
  for (const candidate of PI_TUI_CANDIDATES) {
    try {
      const tui = (await import(new URL(candidate, entry).href)) as {
        setKeybindings(k: unknown): void;
      };
      tui.setKeybindings(keybindings);
      return;
    } catch {
      // Try the other layout.
    }
  }
}
