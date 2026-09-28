import express, { type Router } from "express";
import { UNDERSTORY, understoryIn, understoryTokenOf } from "../features.js";
import { readMcpFile } from "./mcp.js";

/**
 * The agent's memory, to look through: Understory's own read API, handed on.
 *
 * Understory's web UI reads a small JSON API at its root — the tree of the
 * bundle, one concept, a search, the log of changes, the graph of links, the
 * paths its queries took, whether the bundle is well-formed. Asked from here rather
 * than from the page: the address in mcp.json is where the portal reaches it,
 * which the browser may not (localhost, a Docker network, plain HTTP behind
 * an HTTPS portal), and the token stays on the server. Only these, and
 * only reading: nothing here changes the memory.
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

export function memoryRouter(): Router {
  const router = express.Router();

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
