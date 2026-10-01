/**
 * The screen protocol: how what an extension knows reaches the page, drawn
 * with the portal's own building blocks.
 *
 * Not a way to run an extension's own interface in the browser. An extension
 * says what it has as data, blocks (a text, a status, a list, a checklist, a
 * group of those), and the page draws them in the Screens panel. Nothing here
 * knows any extension: the data is put together by a small extension of the
 * person's own, glue that watches the other one (its tool results, its session
 * entries) and says what it sees. The skill `extension-screens` has the agent
 * write that.
 *
 * Like the subagent protocol it rides on pi's event bus (`pi.events` inside an
 * extension), so the glue needs no dependency on the portal and does nothing
 * where nobody listens.
 *
 * Extension → portal:
 *
 *   screen:v1:set    { id, title?, blocks }   what the screen shows now, the whole of it;
 *                                             sent again, it replaces the last
 *   screen:v1:clear  { id }                   the screen goes
 *
 * A block is `{ type, ...}`. Which types there are, and what each takes, is
 * the page's to say (web/src/screens.ts): what the page does not know it
 * leaves out, so a newer glue on an older page loses a block and not the
 * screen. Here only the shape is held: values are plain data, and bounded.
 *
 * The portal keeps each chat's screens while its pi runs, and a page opened
 * later asks for them. They are not stored: the glue says them again when the
 * chat starts, which is what it reads its extension's state back for.
 */
export const SCREEN_SET = "screen:v1:set";
export const SCREEN_CLEAR = "screen:v1:clear";

/** What a page is sent of a screen. */
export interface Screen {
  id: string;
  title?: string;
  blocks: Record<string, unknown>[];
}

/** How many screens a chat has: what a glue that makes up a new id every time would otherwise grow without end. */
export const SCREENS_MAX = 12;
const ID_MAX = 120;
const TITLE_MAX = 120;
/** A text, a label, a key. */
const TEXT_MAX = 2000;
const KEY_MAX = 40;
/** How many entries one list, or one block, has. */
const ENTRIES_MAX = 200;
/**
 * How many levels of objects there are: a screen's block is the first, and each block in a group, each
 * item in an item adds one, lists between them do not. A checklist of checklists of … is a tree nobody
 * reads, and the page follows no more than this.
 */
const DEPTH_MAX = 7;
/** Everything in one screen: more is cut, not refused, since the glue made a list longer than it knew. */
const NODES_MAX = 4000;
/**
 * The characters of all the texts and keys in one screen. The counts above bound
 * how many values there are, not how long: a screen is sent whole on every
 * change and with every poll of the page, so it has to stay a few hundred
 * kilobytes however long the strings are that a glue puts in it. What does not
 * fit is left out whole, with what follows it, and never cut in the middle.
 */
const CHARS_MAX = 100_000;

type Bus = { on(channel: string, handler: (data: unknown) => void): () => void };
type Emit = (event: Record<string, unknown>) => void;

/** Unsubscribes when called. */
export type ScreenBridge = (() => void) & {
  /** The screens as they are now, in the order they first appeared. */
  list(): Screen[];
};

const text = (value: unknown, max: number): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;

/** What is left of the limits of one screen. */
interface Budget {
  left: number;
  chars: number;
}

/**
 * Spends `nodes` values and `chars` characters, if they are there. If not,
 * nothing more is let through: what is cut is cut at a whole value, never in it.
 */
function take(budget: Budget, nodes: number, chars: number): boolean {
  if (nodes > budget.left || chars > budget.chars) {
    budget.left = 0;
    budget.chars = 0;
    return false;
  }
  budget.left -= nodes;
  budget.chars -= chars;
  return true;
}

const spent = (budget: Budget) => budget.left <= 0 || budget.chars <= 0;
const isScalar = (value: unknown) => typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
/** What there is to lose: a value that is data, as against null, undefined, a function, NaN, which were never anything to show. */
const isData = (value: unknown) => isScalar(value) || (!!value && typeof value === "object");

/**
 * Plain data only, and bounded: strings, finite numbers, booleans, lists and
 * objects of them. Functions, symbols, `undefined` and what is deeper or
 * further than the limits are left out, so whatever a glue puts together
 * arrives as JSON the page can hold, however it was made.
 */
function plain(value: unknown, depth: number, budget: Budget): unknown {
  if (spent(budget)) return undefined;
  if (typeof value === "string") {
    const kept = value.slice(0, TEXT_MAX);
    return take(budget, 1, kept.length) ? kept : undefined;
  }
  if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) {
    return take(budget, 1, 0) ? value : undefined;
  }
  if (!value || typeof value !== "object" || depth > DEPTH_MAX) return undefined;
  if (Array.isArray(value)) {
    if (!take(budget, 1, 0)) return undefined;
    const kept: unknown[] = [];
    const entries = value.slice(0, ENTRIES_MAX);
    let lost = false;
    for (const [at, entry] of entries.entries()) {
      // Cut between the entries: one that does not fit is left out whole, and so is what follows.
      if (spent(budget)) {
        lost = entries.slice(at).some(isData);
        break;
      }
      // The entries of a list are on the level of the list, which its holder put a level down: a list in a list is one more.
      const one = plain(entry, Array.isArray(entry) ? depth + 1 : depth, budget);
      if (one !== undefined) kept.push(one);
      else if (isData(entry)) lost = true;
    }
    // A list that had data and keeps none of it, for the limits of size or of depth, is not an empty list:
    // the page would say there is nothing in it. One that held nothing to begin with is.
    return kept.length || !lost ? kept : undefined;
  }
  // An object is all of its own fields or none: a block without its `type`, an item
  // without its `state`, would be drawn as something it is not. What it holds in lists
  // and objects of their own is cut as they are, so the object still says what it is,
  // unless one of them is cut away to nothing: a group without its blocks says it has none.
  const fields = Object.entries(value)
    .slice(0, ENTRIES_MAX)
    .map(([key, entry]): [string, unknown, boolean] => [key.slice(0, KEY_MAX), entry, isScalar(entry)])
    .filter(([, entry, scalar]) => scalar || (!!entry && typeof entry === "object"));
  const own = fields.filter(([, , scalar]) => scalar);
  const chars = fields.reduce((sum, [name, entry, scalar]) => sum + name.length + (scalar && typeof entry === "string" ? Math.min(entry.length, TEXT_MAX) : 0), 0);
  if (!take(budget, 1 + own.length, chars)) return undefined;
  const kept: Record<string, unknown> = {};
  for (const [name, entry, scalar] of fields) {
    const one = scalar ? (typeof entry === "string" ? entry.slice(0, TEXT_MAX) : entry) : plain(entry, depth + 1, budget);
    if (one === undefined && !scalar && (Array.isArray(entry) ? entry.slice(0, ENTRIES_MAX).some(isData) : Object.keys(entry as object).length > 0 && spent(budget))) return undefined;
    if (one !== undefined) kept[name] = one;
  }
  return kept;
}

/** A screen as a page is sent it, or undefined for what is not one. */
export function cleanScreen(data: unknown): Screen | undefined {
  const given = data as { id?: unknown; title?: unknown; blocks?: unknown } | null | undefined;
  const id = text(given?.id, ID_MAX);
  if (!id || !Array.isArray(given?.blocks)) return undefined;
  const budget = { left: NODES_MAX, chars: CHARS_MAX };
  const blocks: Record<string, unknown>[] = [];
  for (const block of given.blocks.slice(0, ENTRIES_MAX)) {
    const one = plain(block, 1, budget) as Record<string, unknown> | undefined;
    // A block says what it is; one that does not is no block.
    if (one && !Array.isArray(one) && typeof one.type === "string") blocks.push(one);
  }
  const title = text(given.title, TITLE_MAX);
  return { id, ...(title ? { title } : {}), blocks };
}

/**
 * Listens on the bus and hands the portal what an extension shows, as session
 * events: `portal_screen` with `op: "set"` (the screen, whole) or `"clear"`,
 * delivered to whoever watches and not stored. Returns the unsubscribe, which
 * also lists the screens as they stand.
 */
export function bridgeScreens(bus: Bus, emit: Emit): ScreenBridge {
  // As last said, to leave out a set that says nothing new: a glue that runs
  // on every tool call would otherwise send the page the same list each time.
  const shown = new Map<string, { screen: Screen; json: string }>();
  const off = [
    bus.on(SCREEN_SET, (data) => {
      const screen = cleanScreen(data);
      if (!screen) return;
      const json = JSON.stringify(screen);
      const was = shown.get(screen.id);
      if (was?.json === json) return;
      // A new screen past the limit is not shown; one that is there is always replaced.
      if (!was && shown.size >= SCREENS_MAX) return;
      shown.set(screen.id, { screen, json });
      emit({ type: "portal_screen", op: "set", ...screen });
    }),
    bus.on(SCREEN_CLEAR, (data) => {
      const id = text((data as { id?: unknown } | null | undefined)?.id, ID_MAX);
      if (!id || !shown.delete(id)) return;
      emit({ type: "portal_screen", op: "clear", id });
    }),
  ];
  return Object.assign(() => off.forEach((f) => f()), {
    list: () => [...shown.values()].map((s) => s.screen),
  });
}
