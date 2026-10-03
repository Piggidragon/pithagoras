import express from "express";
import { statSync } from "node:fs";
import path from "node:path";
import { pathBelow } from "./within.js";

/** The encodings the build leaves beside a file, best first: `app.js.br`, `app.js.gz`. */
const ENCODINGS = [
  { name: "br", ext: ".br" },
  { name: "gzip", ext: ".gz" },
] as const;

const isFile = (file: string): boolean => {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
};

/** A copy of a file that has not been written over since: one that has is of what it was. */
const isCopyOf = (copy: string, file: string): boolean => {
  try {
    const made = statSync(copy);
    return made.isFile() && made.mtimeMs >= statSync(file).mtimeMs;
  } catch {
    return false;
  }
};

/** The encodings a request accepts, by its header: one given a quality of 0 is refused. */
function accepted(header: unknown): Set<string> {
  const out = new Set<string>();
  for (const part of String(header ?? "").split(",")) {
    const [name, ...params] = part.trim().toLowerCase().split(";");
    const q = params.map((p) => /^\s*q=([\d.]+)/.exec(p)?.[1]).find((v) => v !== undefined);
    if (name && !(q !== undefined && Number(q) === 0)) out.add(name.trim());
  }
  return out;
}

/** Built files are named by their content: asked for again, they are the same. */
const HASHED = "/assets/";

/**
 * Serves the built web app: each file as its `.br` or `.gz` copy where the build left
 * one and the browser takes it, and a long-lived cache for what is named by its
 * content.
 *
 * Served as they were, a portal on plain HTTP — where no service worker keeps a
 * copy — sent about two megabytes of script on every cold load, and the voice
 * models, fourteen more, on the first start of the voice. `max-age=0` made even
 * a file that can never change a question to the server each time.
 */
export function serveWeb(app: express.Application, root: string): void {
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    let asked: string;
    try {
      asked = decodeURIComponent(req.path);
    } catch {
      return next();
    }
    const file = path.join(root, asked.endsWith("/") ? asked + "index.html" : asked);
    if (pathBelow(root, file) === undefined || !isFile(file)) return next();
    const copies = ENCODINGS.filter((e) => isCopyOf(file + e.ext, file));
    if (!copies.length) return next();
    // The same address answers differently by what the browser takes: a cache
    // in between has to know.
    res.setHeader("Vary", "Accept-Encoding");
    const wanted = accepted(req.headers["accept-encoding"]);
    const copy = copies.find((e) => wanted.has(e.name));
    if (!copy) return next();
    res.setHeader("Content-Encoding", copy.name);
    // Of the file, not of its copy.
    res.type(path.extname(file));
    const hashed = asked.startsWith(HASHED);
    res.sendFile(file + copy.ext, {
      maxAge: hashed ? "1y" : 0,
      immutable: hashed,
      // A range of what is sent is a range of the compressed bytes.
      acceptRanges: false,
    }, (err) => {
      if (err && !res.headersSent) {
        res.removeHeader("Content-Encoding");
        next();
      }
    });
  });
  app.use(HASHED.slice(0, -1), express.static(path.join(root, "assets"), { immutable: true, maxAge: "1y", index: false }));
  app.use(express.static(root));
}
