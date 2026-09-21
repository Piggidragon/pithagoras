import { spawn } from "node:child_process";
import { closeSync, createReadStream } from "node:fs";
import path from "node:path";
import express, { type Response, type Router } from "express";
import { getSession } from "../db.js";
import {
  ARCHIVE_EXCLUDES,
  FileError,
  baseDir,
  listDir,
  folderPath,
  openDownload,
  readText,
  removeEntry,
  renameEntry,
  writeText,
} from "../workspace-files.js";

/**
 * The files in a chat's folder, for the Files panel.
 *
 * Keyed by chat, not by folder name: a chat can be in a project, in the
 * workspace root, or in Home, which is outside it, and "the folder this chat
 * works in" is the one thing that is the same for all of them. Everything that
 * decides what may be reached is in workspace-files.ts; this only turns a chat
 * into its folder and a refusal into a status.
 */

const STATUS = { invalid: 400, missing: 404, conflict: 409, exists: 409, too_large: 413, failed: 500 } as const;

function fail(res: Response, e: unknown) {
  if (e instanceof FileError) return res.status(STATUS[e.code]).json({ error: e.message });
  console.error("[portal] files:", e);
  res.status(500).json({ error: "Could not read or change the files" });
}

export function filesRouter(): Router {
  const router = express.Router();

  /** The chat's folder, or the answer that it has none. */
  const folderOf = (id: string, res: Response): string | undefined => {
    const session = getSession(id);
    if (!session) {
      res.status(404).json({ error: "Not found" });
      return undefined;
    }
    try {
      return baseDir(session.workspace);
    } catch (e) {
      fail(res, e);
      return undefined;
    }
  };

  router.get("/sessions/:id/files", (req, res) => {
    const base = folderOf(req.params.id, res);
    if (!base) return;
    try {
      res.json(listDir(base, req.query.path));
    } catch (e) {
      fail(res, e);
    }
  });

  router.get("/sessions/:id/file", (req, res) => {
    const base = folderOf(req.params.id, res);
    if (!base) return;
    try {
      if (req.query.download === "1") {
        // Sent from the descriptor that was checked, not from the path again: see openDownload.
        const { fd, size, name } = openDownload(base, req.query.path);
        res.attachment(name);
        res.setHeader("Content-Length", size);
        if (size === 0) {
          closeSync(fd);
          return void res.end();
        }
        // Up to the size that was announced, even if the file has grown since.
        const stream = createReadStream("", { fd, start: 0, end: size - 1 });
        stream.on("error", (e) => {
          console.error("[portal] files: download failed:", e.message);
          res.destroy();
        });
        res.on("close", () => stream.destroy());
        return void stream.pipe(res);
      }
      res.json(readText(base, req.query.path));
    } catch (e) {
      fail(res, e);
    }
  });

  router.put("/sessions/:id/file", (req, res) => {
    const base = folderOf(req.params.id, res);
    if (!base) return;
    const { content, mtime } = req.body ?? {};
    if (typeof content !== "string") return res.status(400).json({ error: "content is required" });
    if (mtime !== undefined && typeof mtime !== "number") return res.status(400).json({ error: "mtime must be a number" });
    try {
      res.json({ ok: true, ...writeText(base, req.query.path, content, mtime) });
    } catch (e) {
      fail(res, e);
    }
  });

  router.patch("/sessions/:id/file", (req, res) => {
    const base = folderOf(req.params.id, res);
    if (!base) return;
    try {
      res.json({ ok: true, path: renameEntry(base, req.query.path, req.body?.name) });
    } catch (e) {
      fail(res, e);
    }
  });

  router.delete("/sessions/:id/file", (req, res) => {
    const base = folderOf(req.params.id, res);
    if (!base) return;
    try {
      removeEntry(base, req.query.path);
      res.json({ ok: true });
    } catch (e) {
      fail(res, e);
    }
  });

  /**
   * The folder — the chat's, or one inside it with `path` — as a .tar.gz,
   * streamed out of `tar` rather than staged on disk first: a big project would
   * need the space twice, and a clean-up.
   */
  router.get("/sessions/:id/archive", (req, res) => {
    const chat = folderOf(req.params.id, res);
    if (!chat) return;
    let base: string;
    try {
      base = folderPath(chat, req.query.path);
    } catch (e) {
      return fail(res, e);
    }
    const name = path.basename(base).replace(/[^a-zA-Z0-9_.-]/g, "_") || "workspace";
    const tar = spawn("tar", ["-czf", "-", ...ARCHIVE_EXCLUDES.map((d) => `--exclude=${d}`), "-C", base, "."]);
    // The download is not announced until tar has produced something: a tar that
    // cannot start, or dies at once, is then an error the person is told about,
    // not a file of zero bytes that the browser calls finished.
    let started = false;
    // Answered already, by an error: whatever tar does after that is not heard.
    let answered = false;
    let complaints = "";
    tar.stderr.on("data", (chunk) => {
      if (complaints.length < 2_000) complaints += chunk;
    });
    const begin = () => {
      started = true;
      res.setHeader("Content-Type", "application/gzip");
      res.setHeader("Content-Disposition", `attachment; filename="${name}.tar.gz"`);
    };
    tar.stdout.once("data", (first: Buffer) => {
      begin();
      res.write(first);
      // Not ended by the pipe: how tar ended decides how this one does, below.
      tar.stdout.pipe(res, { end: false });
    });
    tar.on("error", (e) => {
      console.error("[portal] archive: could not run tar:", e.message);
      answered = true;
      if (started) res.destroy();
      else res.status(500).json({ error: "Could not make the archive: tar is not available" });
    });
    tar.on("close", (code) => {
      // Already answered, or killed because nobody was waiting any more.
      if (answered || code === null || res.destroyed) return;
      answered = true;
      // 1 is "a file changed or vanished while it was read": what was read is in
      // the archive, and that is the ordinary way a busy folder ends. Anything
      // else means the archive is not the folder, so the download is cut off and
      // fails, rather than ending as if it were whole.
      if (code > 1) {
        console.error(`[portal] archive: tar exited ${code}: ${complaints.trim()}`);
        if (started) return void res.destroy();
        return void res.status(500).json({ error: "Could not make the archive" });
      }
      if (!started) begin();
      res.end();
    });
    // Nobody is waiting any more.
    res.on("close", () => tar.kill());
  });

  return router;
}
