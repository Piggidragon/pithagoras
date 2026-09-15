import { LlamaSessionCache } from "./llama-session-cache.js";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";

/**
 * What llama.cpp is doing before the first token arrives.
 *
 * A long prompt on a local server spends most of a turn in prefill, and until
 * the first token there is nothing to show for it — the portal said "working"
 * for two minutes and left you guessing whether it had hung. llama-server knows
 * exactly where it is: ask for `return_progress` and the stream carries a
 * `prompt_progress` object every batch, which is what its own web UI draws.
 *
 * pi has no hook for that, so the portal sits in the middle: each session's
 * model is pointed at a loopback proxy that adds the flag on the way out and
 * reads the progress on the way back. The chunks are forwarded untouched — they
 * are ordinary empty deltas with one extra field, and pi ignores what it does
 * not recognise.
 */

export interface Prefill {
  /** Prompt tokens in total. */
  total: number;
  /** Already in the KV cache — the part that does not have to be processed again. */
  cache: number;
  processed: number;
  timeMs: number;
}

type OnProgress = (sessionId: string, prefill: Prefill) => void;

/** Upstream origin per session, captured when the model is rewritten. */
const upstreams = new Map<string, string>();

let server: http.Server | undefined;
let port = 0;
let notify: OnProgress = () => {};

const PREFIX = "/s/";
const diskCache = new LlamaSessionCache();

function readProgress(text: string, sessionId: string): void {
  // SSE frames, one JSON object per `data:` line. Anything unparseable is not
  // ours to worry about — this is an observer, not the client.
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const body = line.slice(5).trim();
    if (!body || body === "[DONE]") continue;
    if (!body.includes("prompt_progress")) continue;
    try {
      const chunk = JSON.parse(body) as { prompt_progress?: Record<string, number> };
      const p = chunk.prompt_progress;
      if (!p || typeof p.total !== "number") continue;
      notify(sessionId, {
        total: p.total,
        cache: p.cache ?? 0,
        processed: p.processed ?? 0,
        timeMs: p.time_ms ?? 0,
      });
    } catch {
      // A frame split across two packets. The next one carries the same
      // running total, so nothing is lost by skipping it.
    }
  }
}

/** Add `return_progress` to a streaming completion, leaving anything else alone. */
function withProgress(body: Buffer): Buffer {
  try {
    const parsed = JSON.parse(body.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || parsed.stream !== true) return body;
    parsed.return_progress = true;
    return Buffer.from(JSON.stringify(parsed));
  } catch {
    return body;
  }
}

function handle(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = req.url ?? "";
  if (!url.startsWith(PREFIX)) {
    res.writeHead(404).end();
    return;
  }
  const rest = url.slice(PREFIX.length);
  const slash = rest.indexOf("/");
  const sessionId = slash === -1 ? rest : rest.slice(0, slash);
  const path = slash === -1 ? "/" : rest.slice(slash);
  const upstream = upstreams.get(sessionId);
  if (!upstream) {
    res.writeHead(502).end("unknown session");
    return;
  }

  const target = new URL(path, upstream);
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    const raw = Buffer.concat(chunks);
    const body = req.method === "POST" && raw.length ? withProgress(raw) : raw;
    const client = target.protocol === "https:" ? https : http;
    const headers = { ...req.headers, host: target.host };
    if (body.length) headers["content-length"] = String(body.length);

    const controller = new AbortController();
    res.on("close", () => controller.abort());
    const forward = () => new Promise<boolean>((resolve, reject) => {
      const out = client.request(
        { protocol: target.protocol, hostname: target.hostname, port: target.port,
          path: target.pathname + target.search, method: req.method, headers, signal: controller.signal },
        upstreamRes => {
          res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
          const streaming = (upstreamRes.headers["content-type"] ?? "").includes("event-stream");
          let progressBuffer = "";
          upstreamRes.on("data", (c: Buffer) => {
            if (streaming) {
              progressBuffer += c.toString("utf8");
              const end = progressBuffer.lastIndexOf("\n");
              if (end >= 0) { readProgress(progressBuffer.slice(0, end), sessionId); progressBuffer = progressBuffer.slice(end + 1); }
            }
            res.write(c);
          });
          upstreamRes.on("error", reject);
          upstreamRes.on("end", () => { resolve(upstreamRes.statusCode === 200); });
        },
      );
      out.on("error", reject);
      out.end(body);
    });
    let model = "";
    try { model = JSON.parse(body.toString()).model ?? ""; } catch { /* Non-completion route. */ }
    const enabled = (process.env.LLAMA_DISK_CACHE_MODELS ?? "").split(",").includes(model) && !!model && target.pathname.endsWith("/chat/completions");
    void (enabled ? diskCache.run(upstream, model, sessionId, controller.signal, forward) : forward())
      .then(() => res.end())
      .catch(error => {
        if (res.destroyed) return;
        if (!res.headersSent) res.writeHead(502);
        res.end(String(error));
      });
  });
}

/** Loopback only: this exists for the pi process in front of it, nobody else. */
export function startLlamaProxy(onProgress: OnProgress): void {
  if (server) return;
  notify = onProgress;
  server = http.createServer(handle);
  server.listen(0, "127.0.0.1", () => {
    port = (server!.address() as AddressInfo).port;
  });
  server.unref();
}

/**
 * Point one session's model at the proxy.
 *
 * Returns the rewritten base URL, or undefined when there is nothing to do —
 * no proxy yet, or a URL that is not a plain http(s) endpoint.
 */
export function proxyBaseUrl(sessionId: string, modelBaseUrl: string): string | undefined {
  if (!port) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(modelBaseUrl);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
  upstreams.set(sessionId, parsed.origin);
  return `http://127.0.0.1:${port}${PREFIX}${sessionId}${parsed.pathname.replace(/\/$/, "")}`;
}

export function forgetSession(sessionId: string): void {
  upstreams.delete(sessionId);
}
