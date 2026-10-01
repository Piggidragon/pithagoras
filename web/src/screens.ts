import type { Screen, ScreenBlock } from "./api";

/**
 * What the Screens panel draws: the building blocks, and what each takes.
 *
 * An extension's data reaches the page as blocks, made up by a glue of the
 * person's own (see server/src/screens.ts, and the skill `extension-screens`
 * that has the agent write it). The page holds nothing of any extension, only
 * these generic pieces, which compose:
 *
 *   group      { title?, blocks }                    blocks in a stack, under a heading
 *   text       { text, tone? }                       a paragraph
 *   status     { label?, text, tone? }               one fact: a label and its value
 *   list       { items, ordered?, empty? }           items, which may hold items
 *   checklist  { items, empty? }                     items with a state, which may hold items
 *
 * An item is a string, or `{ text, detail?, tone?, items? }`, and in a checklist
 * `{ …, state? }` as well. `tone` is one of ok, warn, error, muted; `state` one
 * of todo, doing, done, blocked (todo unless it says). `empty` is what is said
 * where there are no items.
 *
 * To add a block: its type here, its component in components/ScreenBlocks.tsx
 * (typed so that one is not left without), its line in the skill's reference
 * (skills/extension-screens/reference/blocks.md, which a test keeps in step),
 * and the page's German for what it says.
 *
 * What is not a known block is shown as a note saying so, and what a block does
 * not understand of its data is left out, so that a glue written for another
 * version loses a line and not the screen.
 */
export const BLOCK_TYPES = ["group", "text", "status", "list", "checklist"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export const isBlockType = (type: unknown): type is BlockType => (BLOCK_TYPES as readonly unknown[]).includes(type);

export const TONES = ["ok", "warn", "error", "muted"] as const;
export type Tone = (typeof TONES)[number];

export const CHECK_STATES = ["todo", "doing", "done", "blocked"] as const;
export type CheckState = (typeof CHECK_STATES)[number];

export const toneOf = (value: unknown): Tone | undefined => (TONES as readonly unknown[]).includes(value) ? (value as Tone) : undefined;
export const stateOf = (value: unknown): CheckState => ((CHECK_STATES as readonly unknown[]).includes(value) ? (value as CheckState) : "todo");

/** The words of a block's text: a string, or a number or flag as it reads. */
export const wordsOf = (value: unknown): string | undefined =>
  typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : undefined;

/** An item of a list or checklist, as the page reads it. */
export interface Item {
  text: string;
  detail?: string;
  tone?: Tone;
  state: CheckState;
  items: Item[];
}

/** How deep items hold items, as far as the page follows: the server stops them earlier. */
const DEPTH = 6;

/** The items of a block: strings and objects with words, anything else left out. */
export function itemsOf(value: unknown, depth = 0): Item[] {
  if (!Array.isArray(value) || depth > DEPTH) return [];
  const items: Item[] = [];
  for (const entry of value) {
    const given = (entry && typeof entry === "object" ? entry : { text: entry }) as Record<string, unknown>;
    const text = wordsOf(given.text);
    if (text === undefined) continue;
    items.push({ text, detail: wordsOf(given.detail), tone: toneOf(given.tone), state: stateOf(given.state), items: itemsOf(given.items, depth + 1) });
  }
  return items;
}

/**
 * The screens after what the portal said of one: the whole screen, which
 * replaces the one of its id and keeps its place, or that it is gone.
 */
export function withScreen(screens: Screen[], said: { op?: unknown; id?: unknown; title?: unknown; blocks?: unknown }): Screen[] {
  if (typeof said.id !== "string") return screens;
  if (said.op === "clear") return screens.filter((s) => s.id !== said.id);
  if (said.op !== "set" || !Array.isArray(said.blocks)) return screens;
  const screen: Screen = { id: said.id, ...(typeof said.title === "string" ? { title: said.title } : {}), blocks: said.blocks as ScreenBlock[] };
  return screens.some((s) => s.id === screen.id) ? screens.map((s) => (s.id === screen.id ? screen : s)) : [...screens, screen];
}

/** Screens as the portal answered, what is not one left out: a page must not fall over what an older server sent. */
export function screensOf(value: unknown): Screen[] {
  if (!Array.isArray(value)) return [];
  return value.filter((s): s is Screen => !!s && typeof s.id === "string" && Array.isArray(s.blocks));
}
