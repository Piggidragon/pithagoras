import express, { type Router } from "express";
import { UNDERSTORY, understoryIn, understoryTokenOf } from "../features.js";
import { readMcpFile } from "./mcp.js";
import * as service from "../extensions/understory-service.js";

/**
 * The agent's memory, to look through: Understory's own read API, handed on.
 *
 * Understory's web UI reads a small JSON API at its root — the tree of the
 * bundle, one concept, a search, the log of changes, the graph of links, the
 * paths its queries took, whether the bundle is well-formed. Asked from here rather
 * than from the page: the address in mcp.json is where the portal reaches it,
 * which the browser may not (localhost, a Docker network, plain HTTP behind
 * an HTTPS portal), and the token stays on the server. Only these reads are
 * handed on; the few changes below go through Understory's own write path in
 * the container the portal runs, never through its HTTP API, which has none.
 *
 * It is not a documented API, so a failure says what Understory answered
 * rather than pretending the memory is empty.
 */
const READS = {
  tree: { path: "/api/tree", params: [] },
  concept: { path: "/api/concept", params: ["path"] },
  search: { path: "/api/search", params: ["q"] },
  log: { path: "/api/log", params: [] },
  graph: { path: "/api/graph", params: [] },
  traces: { path: "/api/traces", params: [] },
  validate: { path: "/api/validate", params: [] },
} as const;

/** Where Understory answers, and with what token, while it is the agent's memory. */
export function understoryAt(): { origin: string; token?: string } | undefined {
  const { config, error } = readMcpFile();
  if (error || !understoryIn(config)) return undefined;
  const entry = config.mcpServers[UNDERSTORY] as Record<string, unknown>;
  try {
    return typeof entry.url === "string" ? { origin: new URL(entry.url).origin, token: understoryTokenOf(entry) } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether the memory can be changed here: it is the Understory the portal
 * runs, whose container the portal can run Understory's own write path in.
 * One run elsewhere is read, not written.
 */
async function writable(): Promise<boolean> {
  const at = understoryAt();
  if (!at || at.origin !== new URL(service.managedUrl()).origin) return false;
  return (await service.status()).container === "running";
}

/** A note's path as Understory takes one: absolute, markdown, and not its own index or log. */
function notePath(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\/[^\0]*\.md$/.test(value) || value.split("/").includes("..")) return undefined;
  const name = value.split("/").pop();
  return name === "index.md" || name === "log.md" ? undefined : value;
}

export function memoryRouter(): Router {
  const router = express.Router();

  /** Whether notes can be changed here, and what the bundle's links look like. */
  router.get("/memory/health", async (_req, res) => {
    try {
      if (!(await writable())) return res.json({ writable: false });
      res.json({ writable: true, health: await service.noteHealth() });
    } catch (e) {
      res.status(502).json({ error: (e as Error).message });
    }
  });

  const changing =
    (fn: (req: express.Request) => Promise<unknown>): express.RequestHandler =>
    async (req, res) => {
      if (!(await writable().catch(() => false))) {
        return res.status(409).json({ error: "Notes can be changed here only in the Understory the portal runs, while it is running and the agent's memory." });
      }
      try {
        res.json(await fn(req));
      } catch (e) {
        const status = (e as { status?: number }).status ?? 502;
        res.status(status).json({ error: (e as Error).message });
      }
    };
  const refuse = (message: string) => Object.assign(new Error(message), { status: 400 });

  /** A note written by hand: its text and what its frontmatter says. Understory keeps the index and log. */
  router.put(
    "/memory/concept",
    changing(async (req) => {
      const path = notePath(req.body?.path);
      if (!path) throw refuse("A note's path is absolute, ends in .md, and is not an index.md or log.md");
      const fm = req.body?.frontmatter;
      if (!fm || typeof fm !== "object" || Array.isArray(fm)) throw refuse("frontmatter must be an object");
      if (typeof fm.type !== "string" || !fm.type.trim() || typeof fm.title !== "string" || !fm.title.trim()) throw refuse("A note needs a type and a title");
      const body = req.body?.body;
      if (typeof body !== "string") throw refuse("body must be text");
      if (JSON.stringify({ fm, body }).length > service.NOTE_MAX) throw refuse(`A note is at most ${service.NOTE_MAX / 1000} kB here`);
      return service.saveNote(path, fm, body);
    }),
  );

  router.delete(
    "/memory/concept",
    changing(async (req) => {
      const path = notePath(req.query.path);
      if (!path) throw refuse("A note's path is absolute, ends in .md, and is not an index.md or log.md");
      return service.deleteNote(path);
    }),
  );

  /** Every index.md written anew and empty folders removed; no model involved. */
  router.post("/memory/reindex", changing(() => service.reindex()));

  for (const [name, read] of Object.entries(READS)) {
    router.get(`/memory/${name}`, async (req, res) => {
      const at = understoryAt();
      if (!at) return res.status(409).json({ error: "Understory is not the agent's memory. Switch it on in Settings → Add-ons → Memory." });
      const query = new URLSearchParams();
      for (const key of read.params) {
        const value = req.query[key];
        if (typeof value !== "string" || !value.trim()) return res.status(400).json({ error: `${key} is required` });
        query.set(key, value.slice(0, 500));
      }
      const { origin, token } = at;
      try {
        const answer = await fetch(`${origin}${read.path}${read.params.length ? `?${query}` : ""}`, {
          headers: { accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
          signal: AbortSignal.timeout(10_000),
        });
        const text = await answer.text();
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          return res.status(502).json({ error: `Understory answered ${answer.status} with something that is not JSON.` });
        }
        if (!answer.ok) {
          const said = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : `status ${answer.status}`;
          // Its own 404 — a concept that is not there — is the page's to say; anything else is Understory failing.
          return res.status(answer.status === 404 ? 404 : 502).json({ error: said });
        }
        res.json(body);
      } catch (e) {
        const reason = (e as Error).name === "TimeoutError" ? "it did not answer in time" : (e as Error).message;
        res.status(502).json({ error: `Could not reach Understory at ${origin}: ${reason}.` });
      }
    });
  }

  return router;
}
