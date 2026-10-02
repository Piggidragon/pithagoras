import { randomBytes } from "node:crypto";
import { lstatSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./data-dir.js";
import { getDb, getSession } from "./db.js";
import type { ExtraValue } from "./image-generation.js";
import { isUnderText } from "./within.js";
import { FileError, baseDir, openPicture, readPicture, removeEntry, saveNewFile } from "./workspace-files.js";

/**
 * The pictures of the Images page, in one list: the ones the page made itself
 * and the ones the agent made in a chat with generate_image or edit_image.
 *
 * A row in the `images` table names a picture and says what it was made from;
 * the picture is a file, in one of two places the portal knows. The page's own
 * are in a folder of its own under the portal's data, under a name made here.
 * The agent's are where its tools put them, in the `generated-images` folder
 * of the chat, and are listed from the moment they are made: the tools record
 * each one (see recordChatPicture), so the portal keeps an index and never
 * has to look through every folder there is. A file is only ever opened and
 * served through the same checks the Files panel's pictures have — a path
 * inside the folder, no link followed out of it, and what the bytes say it is.
 *
 * What goes from the list when a file does: a picture whose file is gone — the
 * Files panel took it, or somebody did by hand — is dropped the next time the
 * page looks, and the pictures of a chat go from the list with the chat, while
 * the files stay in its folder, which is not the chat's to take away.
 * Pictures that were made before this index existed are not in it.
 */

/** Where the agent's tools put what they make, inside the chat's folder, so that it does not mix with the work. */
export const GENERATED_DIR = "generated-images";

export type PictureOrigin = "page" | "chat";
/** Made from a description, changed from another picture, or put in by the person to be changed. */
export type PictureKind = "generated" | "edited" | "uploaded";

/** What a picture was asked for with, as far as it is known. */
export interface PictureParams {
  model?: string;
  size?: string;
  /** Fields of the request beyond the four it is made of. */
  extra?: Record<string, ExtraValue>;
  /** An edit's pictures in the order they were given, by their ids here: the first is the one it is `from`. Those that are not in the list are not here either. */
  sources?: string[];
  /** The edit had a mask. The mask itself is not kept. */
  masked?: boolean;
}

/** A picture as the page is told of it. */
export interface GalleryPicture {
  id: string;
  origin: PictureOrigin;
  /** The chat that made it, for the agent's pictures. */
  chat: { id: string; title: string } | null;
  kind: PictureKind;
  prompt: string;
  params: PictureParams;
  /** The picture an edit was made from, when that one is in the list. */
  from: string | null;
  createdAt: number;
  bytes: number;
  /** What a download is called. */
  fileName: string;
}

interface Row {
  id: string;
  origin: PictureOrigin;
  session_id: string | null;
  path: string;
  kind: PictureKind;
  prompt: string;
  params: string;
  source_id: string | null;
  bytes: number;
  created_at: number;
}
type ListedRow = Row & { chat_title: string | null };

/** Where the page's own pictures are kept. */
export const imagesDir = (): string => path.join(path.resolve(DATA_DIR), "images");

/** The params a row holds, kept to the fields that are known: what is in the database is the portal's own, but only as far as it is read back. */
function readParams(text: string): PictureParams {
  let raw: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") raw = parsed;
  } catch {
    // Unreadable is as good as nothing said.
  }
  const params: PictureParams = {};
  if (typeof raw.model === "string" && raw.model) params.model = raw.model;
  if (typeof raw.size === "string" && raw.size) params.size = raw.size;
  if (raw.extra && typeof raw.extra === "object" && !Array.isArray(raw.extra)) params.extra = raw.extra as Record<string, ExtraValue>;
  if (Array.isArray(raw.sources)) params.sources = raw.sources.filter((s): s is string => typeof s === "string");
  if (raw.masked === true) params.masked = true;
  return params;
}

/** What a download of a picture is called: the file's own name for the agent's, one made from the time for the page's. */
function downloadName(row: Row): string {
  if (row.origin === "chat") return path.basename(row.path);
  const stamp = new Date(row.created_at).toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
  return `image-${stamp}-${row.id.slice(0, 4)}${path.extname(row.path)}`;
}

function shown(row: ListedRow): GalleryPicture {
  return {
    id: row.id,
    origin: row.origin,
    chat: row.session_id ? { id: row.session_id, title: row.chat_title ?? "" } : null,
    kind: row.kind,
    prompt: row.prompt,
    params: readParams(row.params),
    from: row.source_id,
    createdAt: row.created_at,
    bytes: row.bytes,
    fileName: downloadName(row),
  };
}

const SELECT = "SELECT images.*, sessions.title AS chat_title FROM images LEFT JOIN sessions ON sessions.id = images.session_id";

const rowOf = (id: string): ListedRow | undefined => getDb().prepare(`${SELECT} WHERE images.id = ?`).get(id) as ListedRow | undefined;

/** The chat of a picture is not there any more. */
class ChatGone extends FileError {
  constructor() {
    super("missing", "The chat that made this picture is gone");
  }
}

/**
 * The folder of a chat, real; the reason it is not there otherwise. What a pass
 * over many pictures has worked out is kept in `folders`, failures too, so that
 * a chat with a hundred pictures is asked about once.
 */
function chatFolder(sessionId: string, folders: Map<string, string | FileError>): string {
  let found = folders.get(sessionId);
  if (found === undefined) {
    try {
      const session = getSession(sessionId);
      if (!session) throw new ChatGone();
      found = baseDir(session.workspace);
    } catch (e) {
      if (!(e instanceof FileError)) throw e;
      found = e;
    }
    folders.set(sessionId, found);
  }
  if (found instanceof FileError) throw found;
  return found;
}

/** The real folder a chat's files are in, or nothing when it cannot be told: the chat is gone, or its folder cannot be reached. */
function folderOf(sessionId: string): string | undefined {
  try {
    const session = getSession(sessionId);
    return session ? baseDir(session.workspace) : undefined;
  } catch {
    return undefined;
  }
}

/** Where a picture's file is, as a folder the portal knows and a path inside it; the reason it is not anywhere that can be served otherwise. */
function locate(row: Row, folders: Map<string, string | FileError> = new Map()): { base: string; rel: string } {
  if (row.origin === "page") return { base: baseDir(imagesDir()), rel: row.path };
  // Only what the agent's tools write: inside the folder of generated pictures, by where the path really goes and not by how it begins, wherever the index may have come from.
  if (!row.session_id || !isUnderText(GENERATED_DIR, row.path)) throw new FileError("invalid", "That is not a picture the agent made");
  return { base: chatFolder(row.session_id, folders), rel: row.path };
}

/**
 * Whether a picture's folder is only out of reach for the moment: a chat's
 * folder on a drive that is not mounted. Its pictures are not gone, and what
 * looks at them leaves them in the list. A chat that is gone is another thing.
 */
const unreachable = (row: Row, e: unknown): boolean => row.origin === "chat" && e instanceof FileError && e.code === "missing" && !(e instanceof ChatGone);

/** Whether a picture is still to be shown: its file is there as a plain file, or its folder is out of reach and it may be. */
function isThere(row: Row, folders: Map<string, string | FileError>): boolean {
  let at: { base: string; rel: string };
  try {
    at = locate(row, folders);
  } catch (e) {
    return unreachable(row, e);
  }
  try {
    return lstatSync(path.join(at.base, at.rel)).isFile();
  } catch {
    return false;
  }
}

const insert = (row: Row) =>
  getDb()
    .prepare("INSERT OR IGNORE INTO images (id, origin, session_id, path, kind, prompt, params, source_id, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(row.id, row.origin, row.session_id, row.path, row.kind, row.prompt, row.params, row.source_id, row.bytes, row.created_at);

const newId = (): string => randomBytes(6).toString("hex");

/** Puts a picture the page made, or was given, in the page's own folder and in the list. */
export function addPagePicture(picture: { bytes: Buffer; ext: string; kind: PictureKind; prompt: string; params: PictureParams; sourceId?: string }): GalleryPicture {
  const id = newId();
  mkdirSync(imagesDir(), { recursive: true });
  // Written the way every file the portal makes is: beside its place first, never over anything, and only inside the folder.
  const rel = saveNewFile(baseDir(imagesDir()), "", `${id}.${picture.ext}`, picture.bytes);
  const row: Row = {
    id,
    origin: "page",
    session_id: null,
    path: rel,
    kind: picture.kind,
    prompt: picture.prompt,
    params: JSON.stringify(picture.params),
    source_id: picture.sourceId ?? null,
    bytes: picture.bytes.length,
    created_at: Date.now(),
  };
  insert(row);
  return shown({ ...row, chat_title: null });
}

/**
 * Lists a picture the agent has just made in a chat, with what it was asked
 * for. The picture is already where the chat's folder has it; this only says
 * so. `from` are the pictures an edit was made from, as paths in the chat's
 * folder: those the list knows are linked, the others are not.
 */
export function recordChatPicture(picture: { sessionId: string; path: string; kind: "generated" | "edited"; prompt: string; params: PictureParams; from?: string[]; bytes: number }): void {
  // A picture that was made is made: that it could not be listed is not the tool's failure, and the agent has nothing to do about it.
  try {
    // Chats share a folder — every chat of a project, every one in Home — so a path names a file for all of them: the rows of the chats whose folder is this one, this chat's first.
    const mine = folderOf(picture.sessionId);
    const rowsOf = (file: string) =>
      (getDb().prepare("SELECT id, session_id FROM images WHERE origin = 'chat' AND path = ? ORDER BY (session_id = ?) DESC, created_at DESC").all(file, picture.sessionId) as { id: string; session_id: string }[])
        .filter((row) => row.session_id === picture.sessionId || (mine !== undefined && folderOf(row.session_id) === mine))
        .map((row) => row.id);
    const known = (file: string) => rowsOf(file)[0];
    // A file name that comes back — an edit is named after its original — is a new picture: its file was taken away by something that did not tell the list, and the old rows are not this file's.
    const before = rowsOf(picture.path);
    const sources = (picture.from ?? []).map(known).filter((id): id is string => !!id && !before.includes(id));
    const first = picture.from?.[0] !== undefined ? known(picture.from[0]) : undefined;
    getDb().transaction(() => {
      if (before.length) forget(before);
      insert({
        id: newId(),
        origin: "chat",
        session_id: picture.sessionId,
        path: picture.path,
        kind: picture.kind,
        prompt: picture.prompt,
        params: JSON.stringify({ ...picture.params, ...(sources.length ? { sources } : {}) }),
        // The first of them, as the picture the edit is named after: only when that very one is in the list.
        source_id: first && !before.includes(first) ? first : null,
        bytes: picture.bytes,
        created_at: Date.now(),
      });
    })();
  } catch (e) {
    console.error("[portal] images: could not list the picture in the gallery:", (e as Error).message);
  }
}

/**
 * Drops what the list names that is not there to show: a file that is gone, a
 * chat that is, a path that leads out. Looked at when the list is looked at from
 * the top, which is a stat for each picture and no more.
 */
export function pruneMissing(): number {
  const folders = new Map<string, string | FileError>();
  const rows = getDb().prepare("SELECT * FROM images").all() as Row[];
  const gone = rows.filter((row) => !isThere(row, folders)).map((row) => row.id);
  if (gone.length) forget(gone);
  return gone.length;
}

/** Takes pictures from the list, and what pointed at them from the edits made of them. The files are not touched. */
function forget(ids: string[]): void {
  const d = getDb();
  d.transaction(() => {
    for (const id of ids) {
      d.prepare("DELETE FROM images WHERE id = ?").run(id);
      d.prepare("UPDATE images SET source_id = NULL WHERE source_id = ?").run(id);
    }
  })();
}

export interface ListQuery {
  origin?: PictureOrigin;
  kind?: PictureKind;
  /** The `next` of the page before. */
  before?: string;
  limit?: number;
}

export const DEFAULT_PAGE = 48;
export const MAX_PAGE = 100;

/** A page of the list, newest first, the next one's start, and what there is in all. */
export function listPictures(query: ListQuery = {}): { pictures: GalleryPicture[]; next: string | null; total: number; pageBytes: number } {
  // The whole list is looked at when it is looked at from the top, not once for every page of it.
  if (!query.before) pruneMissing();
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (query.origin) {
    where.push("images.origin = ?");
    args.push(query.origin);
  }
  if (query.kind) {
    where.push("images.kind = ?");
    args.push(query.kind);
  }
  const d = getDb();
  const counted = d.prepare(`SELECT COUNT(*) AS n FROM images${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`).get(...args) as { n: number };
  const pageBytes = (d.prepare("SELECT COALESCE(SUM(bytes), 0) AS n FROM images WHERE origin = 'page'").get() as { n: number }).n;
  const cursor = /^(\d+):([0-9a-f]+)$/.exec(query.before ?? "");
  if (cursor) {
    where.push("(images.created_at < ? OR (images.created_at = ? AND images.id < ?))");
    args.push(Number(cursor[1]), Number(cursor[1]), cursor[2]);
  }
  const limit = Math.min(MAX_PAGE, Math.max(1, Math.floor(query.limit ?? DEFAULT_PAGE)));
  const rows = d
    .prepare(`${SELECT}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY images.created_at DESC, images.id DESC LIMIT ?`)
    .all(...args, limit + 1) as ListedRow[];
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    pictures: page.map(shown),
    next: rows.length > limit && last ? `${last.created_at}:${last.id}` : null,
    total: counted.n,
    pageBytes,
  };
}

/** Some pictures by their ids, as far as they are in the list: what an edit's original is, to be reached from it. */
export function picturesById(ids: string[]): GalleryPicture[] {
  return ids.map(rowOf).filter((row): row is ListedRow => !!row).map(shown);
}

export const pictureById = (id: string): GalleryPicture | undefined => {
  const row = rowOf(id);
  return row ? shown(row) : undefined;
};

/**
 * A picture opened to be sent: the descriptor, its size and its type, from
 * the same check a picture in the Files panel gets. A file that is gone, or
 * that has become something that is no picture, is not served, and is taken
 * from the list.
 */
export function openListed(id: string): { fd: number; size: number; name: string; mimeType: string; origin: PictureOrigin } {
  const row = rowOf(id);
  if (!row) throw new FileError("missing", "There is no such picture");
  let at: { base: string; rel: string };
  try {
    at = locate(row);
  } catch (e) {
    // Out of reach is not gone: the picture is shown again when its folder is back.
    if (e instanceof FileError && e.code === "missing" && !unreachable(row, e)) forget([id]);
    throw e;
  }
  try {
    return { ...openPicture(at.base, at.rel), origin: row.origin };
  } catch (e) {
    if (e instanceof FileError && e.code === "missing") forget([id]);
    throw e;
  }
}

/** The bytes of a picture, for an edit that starts from it; same checks as serving one. */
export function readListed(id: string): { bytes: Buffer; picture: GalleryPicture } {
  const row = rowOf(id);
  if (!row) throw new FileError("missing", "There is no such picture");
  const { base, rel } = locate(row);
  return { bytes: readPicture(base, rel).bytes, picture: shown(row) };
}

/**
 * Takes a picture away: its file, and its place in the list. A picture in a
 * chat's folder is that chat's file, so this is only ever asked for on
 * purpose, by the person (see the page's confirmation). A file that is gone
 * already is as good as deleted. A folder that cannot be reached is not: the
 * file may well be in it, so this says so and leaves the picture in the list.
 */
export async function deletePicture(id: string): Promise<void> {
  const row = rowOf(id);
  if (!row) throw new FileError("missing", "There is no such picture");
  const missing = (e: unknown) => e instanceof FileError && e.code === "missing";
  let at: { base: string; rel: string } | undefined;
  try {
    at = locate(row);
  } catch (e) {
    // Its chat is gone: nothing is left of it to delete. Out of reach is something else.
    if (!missing(e) || unreachable(row, e)) throw e;
  }
  try {
    if (at) await removeEntry(at.base, at.rel);
  } catch (e) {
    // Gone since: what was asked for.
    if (!missing(e)) throw e;
  }
  forget([id]);
}
