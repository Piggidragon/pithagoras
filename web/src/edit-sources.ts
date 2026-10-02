import type { GalleryPicture } from "./api";

/**
 * The pictures an edit on the Images page works from, and how that list
 * changes: what the editor (components/ImageMaker.tsx) works out without a page.
 *
 * The list is in the order the request sends it: the endpoint knows the
 * pictures by their place, the description says "the second picture", and the
 * mask belongs to the first. Whether it may hold more than one is said of the
 * editing endpoint (Settings → Agent → Images, "Several pictures per edit"), and
 * a request that names more than it takes is refused by the portal; here the
 * list is kept within what is allowed, and what could not be kept is counted, so
 * that the page can say so rather than drop it without a word.
 */

/** The most pictures one edit takes, as the portal sets it (MAX_EDIT_PICTURES). */
export const MAX_SOURCES = 8;
/** What they may weigh together, as the portal sets it (MAX_EDIT_TOTAL_BYTES). */
export const MAX_SOURCES_BYTES = 50 * 1024 * 1024;

export interface Added {
  list: GalleryPicture[];
  /** How many of the added pictures were not taken: there was no room, or the endpoint takes one. */
  left: number;
}

/**
 * `current` with `added` after it, and what did not fit counted. A picture that is in the list already is not
 * added twice, and is no loss. Where the endpoint takes one picture (`multiple` is false) a picture put in takes
 * the place of the one there is: the first of what was added, as the person means to change that.
 */
export function addSources(current: readonly GalleryPicture[], added: readonly GalleryPicture[], multiple: boolean): Added {
  if (!multiple) return { list: added.slice(0, 1), left: Math.max(0, added.length - 1) };
  const have = new Set(current.map((p) => p.id));
  const fresh = added.filter((p, i) => !have.has(p.id) && added.findIndex((q) => q.id === p.id) === i);
  const room = Math.max(0, MAX_SOURCES - current.length);
  return { list: [...current, ...fresh.slice(0, room)], left: Math.max(0, fresh.length - room) };
}

/** How many more pictures a list can be given at once: all that are left of the limit, and one where it takes one. */
export const roomFor = (have: number, multiple: boolean): number => (multiple ? Math.max(0, MAX_SOURCES - have) : 1);

/** `list` with the picture at `index` one place earlier (`by` -1) or later (1); the list itself where there is no such place. */
export function moved<T>(list: readonly T[], index: number, by: -1 | 1): T[] {
  const to = index + by;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return [...list];
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** What the pictures weigh together. */
export const weightOf = (list: readonly GalleryPicture[]): number => list.reduce((sum, p) => sum + p.bytes, 0);

/** What a picture is called where it stands among others: what it was made from, else its file, on one line. */
export function sourceName(picture: GalleryPicture, longest = 60): string {
  const flat = (picture.prompt || picture.fileName).replace(/\s+/g, " ").trim();
  return flat.length > longest ? `${flat.slice(0, longest - 1)}…` : flat;
}

/**
 * Why the pictures cannot be sent as they are, in the form's own terms, or nothing when they can:
 * "one" is several where the endpoint takes one, "weight" is more than an edit takes together.
 */
export function refusal(list: readonly GalleryPicture[], multiple: boolean): "one" | "weight" | undefined {
  if (!multiple && list.length > 1) return "one";
  if (weightOf(list) > MAX_SOURCES_BYTES) return "weight";
  return undefined;
}
