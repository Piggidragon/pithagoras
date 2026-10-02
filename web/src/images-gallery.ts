import type { GalleryPicture, PictureJob, PictureKind, PictureOrigin } from "./api";
import type { ViewerPicture } from "./image-viewer";

/**
 * What the Images page (components/ImagesPage.tsx) works out without a page:
 * which pictures are drawn and in what order, how a page that was asked for
 * again joins the ones already there, what the viewer is given, and the form's
 * extra fields and what it remembers.
 */

export interface Filter {
  origin?: PictureOrigin;
  kind?: PictureKind;
}

const ORIGINS: readonly string[] = ["page", "chat"];
const KINDS: readonly string[] = ["generated", "edited", "uploaded"];

/** The filters in the address; what is not one of them is no filter, so that a link that is out of date shows everything. */
export function readFilter(params: URLSearchParams): Filter {
  const origin = params.get("origin");
  const kind = params.get("kind");
  return {
    ...(origin && ORIGINS.includes(origin) ? { origin: origin as PictureOrigin } : {}),
    ...(kind && KINDS.includes(kind) ? { kind: kind as PictureKind } : {}),
  };
}

/** Whether `a` comes before `b` in the gallery's order: newest first, and by id among those made in the same moment, as the server orders them. */
const before = (a: { createdAt: number; id: string }, b: { createdAt: number; id: string }): boolean =>
  a.createdAt > b.createdAt || (a.createdAt === b.createdAt && a.id > b.id);

/**
 * The pictures there are, once the top of the list has been asked for again —
 * a picture was made, or one was deleted, since: the fresh page takes the place
 * of the head of what is shown, and what was loaded further down stays. A list
 * that fits in the fresh page is that page. A picture that is as it was is the
 * very one that was shown, so that what is drawn of it is not drawn again.
 */
export function mergeTop(loaded: GalleryPicture[], fresh: { pictures: GalleryPicture[]; next: string | null }): GalleryPicture[] {
  const known = new Map(loaded.map((p) => [p.id, p]));
  const head = fresh.pictures.map((p) => {
    const was = known.get(p.id);
    return was && JSON.stringify(was) === JSON.stringify(p) ? was : p;
  });
  const last = head[head.length - 1];
  if (fresh.next === null || !last) return head;
  const have = new Set(head.map((p) => p.id));
  return [...head, ...loaded.filter((p) => !have.has(p.id) && before(last, p))];
}

/** Whether two lists are the same pictures, the very same ones, in the same order. */
export const sameList = (a: readonly unknown[], b: readonly unknown[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/** A page that was loaded further down joins the end of the list; one that was already there, from the top being asked for meanwhile, is not drawn twice. */
export function appendPage(loaded: GalleryPicture[], page: GalleryPicture[]): GalleryPicture[] {
  const have = new Set(loaded.map((p) => p.id));
  return [...loaded, ...page.filter((p) => !have.has(p.id))];
}

/** What the viewer gets for a picture, from where the page fetches its file. */
export function viewerPicture(picture: GalleryPicture, fileUrl: (id: string) => string): ViewerPicture {
  return {
    id: picture.id,
    src: fileUrl(picture.id),
    alt: picture.prompt || picture.fileName,
    ...(picture.prompt ? { caption: picture.prompt } : {}),
    fileName: picture.fileName,
    ...(picture.from ? { from: picture.from } : {}),
  };
}

/**
 * What the viewer steps through: the gallery as loaded, and each original that
 * an edit was made from and that is further down than the page has reached,
 * right after the first edit that names it, so that the link between the two
 * has something to go to. When the gallery gets to it, it is the gallery's own.
 */
export function viewerList(loaded: GalleryPicture[], originals: ReadonlyMap<string, GalleryPicture>): GalleryPicture[] {
  const have = new Set(loaded.map((p) => p.id));
  const list: GalleryPicture[] = [];
  for (const picture of loaded) {
    list.push(picture);
    const original = picture.from && !have.has(picture.from) ? originals.get(picture.from) : undefined;
    if (original) {
      list.push(original);
      have.add(original.id);
    }
  }
  return list;
}

/** What the grid draws in one place: a picture, a job that is making one, or both — the job whose picture it now is. */
export interface Tile {
  /** The job's, where there is one: the tile stays the same one from the wait to the picture. */
  key: string;
  picture?: GalleryPicture;
  job?: PictureJob;
}

/** What a job makes, as a filter says it: a job of the page makes its pictures, and an upload is not made by one. */
const jobMatches = (job: PictureJob, filter: Filter): boolean => {
  if (filter.origin === "chat") return false;
  if (filter.kind === "uploaded") return false;
  if (filter.kind) return filter.kind === (job.kind === "edit" ? "edited" : "generated");
  return true;
};

/**
 * Every tile of the grid, newest first: the jobs on the page — being made, not
 * made, or made and not yet taken in by the list — and then the gallery. A job
 * whose picture is in the list holds that picture's place, and the picture is
 * not drawn a second time. A picture that was deleted is not shown by its job
 * either (`gone`), and what a filter leaves out, jobs included, is not shown.
 */
export function tiles(pictures: GalleryPicture[], jobs: PictureJob[], filter: Filter, gone: ReadonlySet<string> = new Set()): Tile[] {
  const byId = new Map(pictures.map((p) => [p.id, p]));
  const held = new Set<string>();
  const first: Tile[] = [];
  for (const job of [...jobs].sort((a, b) => b.startedAt - a.startedAt)) {
    if (!jobMatches(job, filter)) continue;
    if (job.state === "done") {
      if (!job.pictureId || gone.has(job.pictureId)) continue;
      const picture = byId.get(job.pictureId);
      if (picture) held.add(picture.id);
      first.push({ key: `job:${job.id}`, job, ...(picture ? { picture } : {}) });
    } else {
      first.push({ key: `job:${job.id}`, job });
    }
  }
  return [...first, ...pictures.filter((p) => !held.has(p.id)).map((p): Tile => ({ key: p.id, picture: p }))];
}

/**
 * The extra fields of a request as typed, one `name=value` to a line, or what
 * is wrong with them. The values are text: the portal reads `true`, `false` and
 * plain numbers as such, and a value in double quotes is text whatever it looks
 * like (see parseExtra on the server).
 */
export function parseFields(text: string): { fields: Record<string, string> } | { error: string; line: number } {
  // Without a prototype, so that no name is special: `__proto__` is a field like another, and the portal says it is not a name there can be.
  const fields: Record<string, string> = Object.create(null);
  const lines = text.split(/\r?\n/);
  for (const [i, raw] of lines.entries()) {
    const line = raw.trim();
    if (!line) continue;
    const at = line.indexOf("=");
    const name = at < 0 ? "" : line.slice(0, at).trim();
    if (!name) return { error: "missing", line: i + 1 };
    if (Object.hasOwn(fields, name)) return { error: "twice", line: i + 1 };
    fields[name] = line.slice(at + 1).trim();
  }
  return { fields: { ...fields } };
}

/** A value of an extra field as it is typed, so that it reads back as it was: text that looks like a number or a switch is put in quotes. */
export const typed = (value: string | number | boolean): string =>
  typeof value === "string" && (value === "true" || value === "false" || /^-?\d+(\.\d+)?$/.test(value)) ? `"${value}"` : String(value);

/** The extra fields a picture was made with, as a request says them again. */
export const fieldsOf = (extra: Record<string, string | number | boolean> | undefined): Record<string, string> =>
  Object.fromEntries(Object.entries(extra ?? {}).map(([name, value]) => [name, typed(value)]));

/** The same, one to a line as the form shows them. */
export const fieldsText = (extra: Record<string, string | number | boolean> | undefined): string =>
  Object.entries(fieldsOf(extra))
    .map(([name, value]) => `${name}=${value}`)
    .join("\n");

/** What the form keeps between visits: the settings of a request, not its words. */
export interface FormMemory {
  model: string;
  size: string;
  count: number;
  extra: string;
  open: boolean;
}

export const FORM_KEY = "imagesForm";

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");

/** What was kept, as far as it still makes sense: storage is the person's to change and the page's to survive. */
export function readForm(stored: string | null, most: number): FormMemory {
  let raw: Record<string, unknown> = {};
  try {
    const parsed = stored ? JSON.parse(stored) : null;
    if (parsed && typeof parsed === "object") raw = parsed;
  } catch {
    // Unreadable is as good as nothing kept.
  }
  const count = Number(raw.count);
  return {
    model: text(raw.model, 200),
    size: text(raw.size, 20),
    count: Number.isInteger(count) && count >= 1 ? Math.min(count, Math.max(1, most)) : 1,
    extra: text(raw.extra, 2000),
    open: raw.open === true,
  };
}
