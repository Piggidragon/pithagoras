import { spawn } from "node:child_process";
import path from "node:path";
import express, { type Response, type Router } from "express";
import { getSession } from "../db.js";
import {
  ARCHIVE_EXCLUDES,
  FileError,
  baseDir,
  downloadPath,
  listDir,
  readText,
  removeEntry,
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

const STATUS = { invalid: 400, missing: 404, conflict: 409, too_large: 413 } as const;

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
        const file = downloadPath(base, req.query.path);
        return res.download(file, path.basename(file), (err) => {
          if (err && !res.headersSent) fail(res, err);
        });
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
   * The whole folder as a .tar.gz, streamed out of `tar` rather than staged on
   * disk first: a big project would need the space twice, and a clean-up.
   */
  router.get("/sessions/:id/archive", (req, res) => {
    const base = folderOf(req.params.id, res);
    if (!base) return;
    const name = path.basename(base).replace(/[^a-zA-Z0-9_.-]/g, "_") || "workspace";
    res.setHeader("Content-Type", "application/gzip");
    res.setHeader("Content-Disposition", `attachment; filename="${name}.tar.gz"`);
    const tar = spawn("tar", ["-czf", "-", ...ARCHIVE_EXCLUDES.map((d) => `--exclude=${d}`), "-C", base, "."]);
    tar.stdout.pipe(res);
    // A file that vanishes mid-way makes tar exit non-zero, but what it read is
    // already in the stream, so there is nothing to add to it.
    tar.stderr.resume();
    tar.on("error", () => res.end());
    // Nobody is waiting any more.
    res.on("close", () => tar.kill());
  });

  return router;
}
