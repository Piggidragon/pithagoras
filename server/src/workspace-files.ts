import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
  fchownSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import path from "node:path";

/**
 * Looking at, changing and taking away the files in a chat's folder, from the browser.
 *
 * The folder is one the agent already works in with full access, so this gives
 * the browser the same view and nothing more. What it must not do is let a
 * name that arrives in a URL reach past that folder, and the agent can leave
 * links in it that point anywhere. So a path is checked twice: as text, and
 * again where it really leads once every link along it is followed. And a file
 * is opened without following a link in its last place, which closes the gap
 * between the check and the open.
 *
 * The listing, reading and resolving here were first written for the workspace
 * file browser in PR 2, keyed by workspace name; this is the same, keyed by
 * folder, so that a chat in Home — outside the workspace root — has files too.
 */

/** Above this a file is offered as a download only: it is neither shown nor sent back whole. */
export const MAX_EDIT_BYTES = 1024 * 1024;
/** A folder with more than this is cut off, and says so. */
export const MAX_ENTRIES = 2_000;
/** Left out of the whole-folder archive: regenerable, or huge, and not the work itself. */
export const ARCHIVE_EXCLUDES = ["node_modules", ".git", "__pycache__", ".venv", "venv", "dist", "build"];

export type FileErrorCode = "invalid" | "missing" | "conflict" | "exists" | "too_large" | "failed";

export class FileError extends Error {
  constructor(
    readonly code: FileErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface FileEntry {
  name: string;
  /** "link" is a link that could not be followed to something inside the folder. */
  type: "dir" | "file" | "link";
  /**
   * The entry is a link, whatever `type` says. A link that leads to a folder inside
   * this one is listed as a "dir", but taking it away removes the link, not the folder.
   */
  link?: boolean;
  size: number;
  mtime: number;
}

const isWithin = (root: string, p: string) => p === root || p.startsWith(root + path.sep);

const lexists = (p: string): boolean => {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
};

/**
 * The real folder `dir` stands for, or an error if there is none.
 *
 * Canonical once, up front, so that every check after it compares real paths
 * with real paths.
 */
export function baseDir(dir: string): string {
  try {
    const real = realpathSync(dir);
    if (!statSync(real).isDirectory()) throw new Error("not a directory");
    return real;
  } catch {
    throw new FileError("missing", "This chat's folder does not exist");
  }
}

/** `p` with every link in the part of it that exists followed; the rest stays as written. */
function realThroughExisting(p: string): string {
  let current = p;
  const tail: string[] = [];
  // lstat, not exists: a link that points nowhere still exists, and stopping at
  // it is what lets realpath below refuse it. Walking past it would treat its
  // name as a plain missing folder, and a write would then follow the link.
  while (!lexists(current)) {
    const parent = path.dirname(current);
    if (parent === current) throw new FileError("missing", "There is no such place");
    tail.unshift(path.basename(current));
    current = parent;
  }
  let real: string;
  try {
    real = realpathSync(current);
  } catch {
    throw new FileError("invalid", "That path leads outside the folder");
  }
  return tail.length ? path.join(real, ...tail) : real;
}

/**
 * The absolute path for `rel` inside `base` (which is already canonical).
 *
 * Refuses `..`, an absolute path and anything that a link leads out of the
 * folder by. What is returned is the checked, canonical path — use it, not the
 * text that came in.
 */
export function resolveInside(base: string, rel: unknown): string {
  const text = String(rel ?? "");
  if (text.includes("\0")) throw new FileError("invalid", "That is not a valid path");
  const resolved = path.resolve(base, text.replace(/^[/\\]+/, ""));
  if (!isWithin(base, resolved)) throw new FileError("invalid", "That path leads outside the folder");
  const real = realThroughExisting(resolved);
  if (!isWithin(base, real)) throw new FileError("invalid", "That path leads outside the folder");
  return real;
}

/** What is directly in a folder: folders first, then files, each by name. */
export function listDir(base: string, rel: unknown): { path: string; entries: FileEntry[]; truncated: boolean } {
  const target = resolveInside(base, rel);
  let names;
  try {
    names = readdirSync(target, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOTDIR") throw new FileError("invalid", "That is not a folder");
    throw new FileError("missing", "There is no such folder");
  }
  // The cap bounds the work, not only the answer: every entry that is looked at
  // is a syscall (two more for a link), on the thread that also serves every
  // other request. So a big folder is cut down first, on what the listing
  // already says — folders before files, then by name — and only what is kept is
  // looked at. That is also the order the answer is in, so nothing is lost by it.
  let candidates = names.filter((d) => d.name !== ".git");
  const total = candidates.length;
  if (total > MAX_ENTRIES) {
    const kind = (d: (typeof candidates)[number]) => (d.isDirectory() ? 0 : 1);
    candidates = candidates
      .sort((a, b) => kind(a) - kind(b) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .slice(0, MAX_ENTRIES);
  }
  const entries: FileEntry[] = [];
  for (const dirent of candidates) {
    const full = path.join(target, dirent.name);
    try {
      let st = lstatSync(full);
      let type: FileEntry["type"] = st.isDirectory() ? "dir" : "file";
      const link = st.isSymbolicLink();
      if (link) {
        // Shown as what it leads to, but only if that is inside the folder.
        // A link that leads out, or nowhere, is listed and left alone.
        type = "link";
        const real = realpathSync(full);
        if (isWithin(base, real)) {
          st = statSync(real);
          type = st.isDirectory() ? "dir" : "file";
        }
      }
      entries.push({ name: dirent.name, type, ...(link ? { link } : {}), size: st.size, mtime: st.mtimeMs });
    } catch {
      // Gone since it was listed, or a link to nowhere.
      entries.push({ name: dirent.name, type: "link", link: true, size: 0, mtime: 0 });
    }
  }
  entries.sort((a, b) => {
    const rank = (t: FileEntry["type"]) => (t === "dir" ? 0 : 1);
    return rank(a.type) - rank(b.type) || a.name.localeCompare(b.name);
  });
  return { path: path.relative(base, target), entries, truncated: total > MAX_ENTRIES };
}

/** What is said when a save would put older text over newer, or over a file that is gone. */
export const CHANGED = "The file changed after you opened it";

/**
 * Opens a plain file without following a link in its last place, or waiting on one.
 * A pipe left there would otherwise hold the server; a device is not a file.
 */
function openPlain(file: string, flags: number): number {
  let fd: number;
  try {
    fd = openSync(file, flags | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o644);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new FileError("missing", "There is no such file");
    // Only where a file is being made and something is there by now.
    if (code === "EEXIST") throw new FileError("conflict", CHANGED);
    if (code === "ELOOP" || code === "ENXIO" || code === "EISDIR") {
      throw new FileError("invalid", "That is a link, a folder or not a plain file");
    }
    throw e;
  }
  if (!fstatSync(fd).isFile()) {
    closeSync(fd);
    throw new FileError("invalid", "That is not a plain file");
  }
  return fd;
}

/** Null bytes early in a file are the cheap, reliable sign that it is not text. */
const looksBinary = (head: Buffer) => head.includes(0);

export type FileContent = { binary: true; size: number; mtime: number } | { binary: false; size: number; mtime: number; content: string };

/** A file's text, or the fact that it is not text or too large to show. */
export function readText(base: string, rel: unknown): FileContent {
  const fd = openPlain(resolveInside(base, rel), constants.O_RDONLY);
  try {
    const st = fstatSync(fd);
    if (st.size > MAX_EDIT_BYTES) return { binary: true, size: st.size, mtime: st.mtimeMs };
    const buffer = Buffer.alloc(st.size);
    let read = 0;
    while (read < st.size) {
      const n = readSync(fd, buffer, read, st.size - read, read);
      if (n === 0) break;
      read += n;
    }
    const data = buffer.subarray(0, read);
    if (looksBinary(data.subarray(0, 8000))) return { binary: true, size: st.size, mtime: st.mtimeMs };
    return { binary: false, size: st.size, mtime: st.mtimeMs, content: data.toString("utf8") };
  } finally {
    closeSync(fd);
  }
}

/**
 * A plain file opened for sending as a download: the descriptor, its size and its name.
 *
 * What is sent is read from the descriptor that was opened here, without
 * following a link, so nothing can be swapped in between the check and the
 * send. Handing the path on to be opened again is what that would allow, and it
 * would also treat a name that starts with a dot as one to refuse. The caller
 * owns the descriptor.
 */
export function openDownload(base: string, rel: unknown): { fd: number; size: number; name: string } {
  const file = resolveInside(base, rel);
  const fd = openPlain(file, constants.O_RDONLY);
  return { fd, size: fstatSync(fd).size, name: path.basename(file) };
}

/**
 * What a failed change is called to the person, by what the system said.
 * Anything not known here is left as it is, and becomes a plain 500 with a log line.
 */
function ioFailure(e: unknown, what: string, after: string): unknown {
  const code = (e as NodeJS.ErrnoException)?.code;
  // Gone since it was looked at, or the folder it was to go in is not there.
  if (code === "ENOENT") return new FileError("missing", "There is no such file or folder");
  if (code === "ENOTDIR") return new FileError("invalid", "That is not a folder");
  if (code && ["ENOSPC", "EDQUOT", "EIO", "EROFS", "EACCES", "EPERM", "EFBIG", "ENOTEMPTY", "EBUSY"].includes(code)) {
    return new FileError("failed", `${what} (${code}). ${after}`);
  }
  return e;
}

/** A save that did not happen: the file is as it was. */
const writeFailure = (e: unknown) => ioFailure(e, "The file could not be saved", "It was left as it was.");

/**
 * Saves a file's text.
 *
 * `expected` is the modification time the editor was showing. If the file has
 * changed since — the agent writes here too — the save is refused instead of
 * putting the older text over the newer, and the person chooses what to keep.
 *
 * The text is written to a file beside it and put in place by a rename, not
 * written into the file itself. Cutting a file off and then failing to fill it
 * (a full disk, an I/O error) leaves an empty file where the work was, and a
 * file whose time has moved, so the next save is refused as a conflict. Done this
 * way a failed save leaves the file exactly as it was. The rename also replaces
 * whatever is at the name and does not follow it, so a link put there after the
 * check is replaced, not written through.
 */
export function writeText(
  base: string,
  rel: unknown,
  content: string,
  expected?: number,
  /** Only make it: a file already there is not replaced. What "New file" means. */
  createOnly = false,
): { size: number; mtime: number } {
  if (Buffer.byteLength(content, "utf8") > MAX_EDIT_BYTES) {
    throw new FileError("too_large", `Files over ${MAX_EDIT_BYTES / 1024 / 1024} MB are not edited here`);
  }
  const target = resolveInside(base, rel);
  if (target === base) throw new FileError("invalid", "That is the folder, not a file");
  // Looked at before anything is written, and without O_CREAT: a file that is
  // there is checked as it is, so an emptied one is compared like any other. One
  // that is not there was either never made (no `expected`, so make it) or has
  // been taken away since it was opened, and putting it back with old text is
  // not what a save means.
  let mode = 0o644;
  let owner: { uid: number; gid: number } | undefined;
  let existed = true;
  try {
    // Only to look at: what is written goes to a file beside it, so the file itself
    // need not be writable (a read-only one is replaced, and keeps its mode).
    const fd = openPlain(target, constants.O_RDONLY);
    try {
      const st = fstatSync(fd);
      if (createOnly) throw new FileError("exists", `There is already something called "${path.basename(target)}" here`);
      if (st.nlink > 1) throw new FileError("invalid", "That file is shared with another, so it is left alone");
      if (expected !== undefined && Math.abs(st.mtimeMs - expected) > 1) throw new FileError("conflict", CHANGED);
      mode = st.mode & 0o7777;
      owner = { uid: st.uid, gid: st.gid };
    } finally {
      closeSync(fd);
    }
  } catch (e) {
    if (!(e instanceof FileError) || e.code !== "missing") throw writeFailure(e);
    if (expected !== undefined) throw new FileError("conflict", CHANGED);
    existed = false;
  }

  const temp = path.join(path.dirname(target), `.${path.basename(target).slice(0, 100)}.${randomBytes(6).toString("hex")}.tmp`);
  let fd: number | undefined;
  try {
    fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
    // What the file had: the mode is cut by the umask on creation, and the owner is not ours if the portal runs as another user.
    fchmodSync(fd, mode);
    if (owner) {
      try {
        fchownSync(fd, owner.uid, owner.gid);
      } catch {
        // Not allowed to give it away; it stays ours.
      }
    }
    const data = Buffer.from(content, "utf8");
    let written = 0;
    while (written < data.length) written += writeSync(fd, data, written, data.length - written, written);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    if (existed) {
      renameSync(temp, target);
    } else {
      // A file that is made is not put over one that has appeared since: a link
      // fails where a rename would replace. Where links are not possible, rename.
      try {
        linkSync(temp, target);
        unlinkSync(temp);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new FileError("conflict", CHANGED);
        renameSync(temp, target);
      }
    }
  } catch (e) {
    if (fd !== undefined) closeSync(fd);
    rmSync(temp, { force: true });
    throw writeFailure(e);
  }
  const after = statSync(target);
  return { size: after.size, mtime: after.mtimeMs };
}

/**
 * Removes a file, or a folder and all that is in it. A link is removed as the
 * link it is, and what it points at stays. The folder itself is not removable
 * from here: that is the chat's place, not something in it.
 */
export function removeEntry(base: string, rel: unknown): void {
  const text = String(rel ?? "");
  if (text.includes("\0")) throw new FileError("invalid", "That is not a valid path");
  const lexical = path.resolve(base, text.replace(/^[/\\]+/, ""));
  if (!isWithin(base, lexical)) throw new FileError("invalid", "That path leads outside the folder");
  if (lexical === base) throw new FileError("invalid", "The folder itself is not removed from here");
  // The parent is followed and checked; the last name is not, so that a link
  // there goes, not what it leads to.
  const parent = resolveInside(base, path.relative(base, path.dirname(lexical)));
  const target = path.join(parent, path.basename(lexical));
  if (!lexists(target)) throw new FileError("missing", "There is no such file or folder");
  try {
    // A file that has gone since it was looked for is what was asked for.
    rmSync(target, { recursive: true, force: true });
  } catch (e) {
    throw ioFailure(e, "It could not be deleted", "Nothing more was changed.");
  }
}

/** A name for one entry: no place in it, and not one of the two that mean a place. */
function checkName(name: unknown): string {
  if (typeof name !== "string" || !name.trim()) throw new FileError("invalid", "A name is required");
  const clean = name.trim();
  if (clean === "." || clean === ".." || /[/\\\0]/.test(clean)) throw new FileError("invalid", "A name cannot contain / or \\, or be . or ..");
  if (Buffer.byteLength(clean, "utf8") > 255) throw new FileError("invalid", "That name is too long");
  return clean;
}

/**
 * Gives a file or a folder another name, in the folder it is in. It is a new
 * name, not a new place, and it never replaces something that is already there.
 * A link is renamed as the link it is. Returns the new path, from the folder.
 */
export function renameEntry(base: string, rel: unknown, newName: unknown): string {
  const name = checkName(newName);
  const text = String(rel ?? "");
  if (text.includes("\0")) throw new FileError("invalid", "That is not a valid path");
  const lexical = path.resolve(base, text.replace(/^[/\\]+/, ""));
  if (!isWithin(base, lexical)) throw new FileError("invalid", "That path leads outside the folder");
  if (lexical === base) throw new FileError("invalid", "The folder itself is not renamed from here");
  // The parent is followed and checked; the last name is not, so that a link
  // is renamed and not what it leads to.
  const parent = resolveInside(base, path.relative(base, path.dirname(lexical)));
  const from = path.join(parent, path.basename(lexical));
  if (!lexists(from)) throw new FileError("missing", "There is no such file or folder");
  const to = path.join(parent, name);
  if (to === from) return path.relative(base, to);
  if (lexists(to)) throw new FileError("exists", `There is already something called "${name}" here`);
  try {
    renameSync(from, to);
  } catch (e) {
    throw ioFailure(e, "It could not be renamed", "It keeps its name.");
  }
  return path.relative(base, to);
}

/** The checked path of a folder, for archiving it. */
export function folderPath(base: string, rel: unknown): string {
  const dir = resolveInside(base, rel);
  const st = lstatSync(dir, { throwIfNoEntry: false });
  if (!st) throw new FileError("missing", "There is no such folder");
  if (!st.isDirectory()) throw new FileError("invalid", "That is not a folder");
  return dir;
}

/**
 * Makes a folder inside `dir`. Like a new file, it never takes the place of
 * something already there. Returns its path, from the chat's folder.
 */
export function makeFolder(base: string, dirRel: unknown, name: unknown): string {
  const clean = checkName(name);
  const parent = folderPath(base, dirRel);
  const target = path.join(parent, clean);
  if (lexists(target)) throw new FileError("exists", `There is already something called "${clean}" here`);
  try {
    mkdirSync(target);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new FileError("exists", `There is already something called "${clean}" here`);
    throw ioFailure(e, "The folder could not be made", "Nothing was changed.");
  }
  return path.relative(base, target);
}

/** "report.pdf", then "report (2).pdf", "report (3).pdf"… */
export function numbered(name: string, n: number): string {
  if (n < 2) return name;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
}

/**
 * Where an uploaded file goes: a temporary file beside its place, and the call
 * that puts it there once all of it has arrived.
 *
 * An upload never replaces anything. A name that is taken becomes
 * "name (2).ext", as a download folder does, because the person dropping a
 * file wants it in, not a question. The name is settled only when the file is
 * complete, and put in place by a link, which fails rather than replaces if
 * something took the name in the meantime; then the next number is tried.
 */
export function uploadTarget(
  base: string,
  dirRel: unknown,
  name: unknown,
): { fd: number; finish: () => string; abandon: () => void } {
  const clean = checkName(name);
  const parent = folderPath(base, dirRel);
  const temp = path.join(parent, `.${clean.slice(0, 100)}.${randomBytes(6).toString("hex")}.upload`);
  let fd: number;
  try {
    fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644);
  } catch (e) {
    throw ioFailure(e, "The file could not be uploaded", "Nothing was changed.");
  }
  const abandon = () => rmSync(temp, { force: true });
  const finish = () => {
    for (let n = 1; n < 1000; n++) {
      const target = path.join(parent, numbered(clean, n));
      try {
        linkSync(temp, target);
        unlinkSync(temp);
        return path.relative(base, target);
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === "EEXIST") continue;
        // Where links are not possible: a rename, after looking, is the best there is.
        if (code === "EPERM" || code === "ENOTSUP" || code === "EOPNOTSUPP") {
          if (lexists(target)) continue;
          renameSync(temp, target);
          return path.relative(base, target);
        }
        abandon();
        throw ioFailure(e, "The file could not be uploaded", "Nothing was changed.");
      }
    }
    abandon();
    throw new FileError("exists", `Too many files called "${clean}" here`);
  };
  return { fd, finish, abandon };
}
