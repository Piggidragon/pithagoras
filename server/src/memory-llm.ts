import { timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import express, { type Router } from "express";
import { chatModel, getSession } from "./db.js";
import { modelRuntime } from "./api/providers.js";
import { UNDERSTORY } from "./features.js";
import { existingLlmToken } from "./extensions/understory-service.js";

/**
 * The model Understory thinks with, when it is "the chat's": the one the
 * chat asking it is on, already loaded, rather than a second one kept in
 * memory beside it.
 *
 * Understory is given the portal as its model server (see
 * understory-service.ts); what it sends is passed on to the model of the chat
 * whose memory tool is running — which the portal knows, since it watches
 * every tool call. With none running — a tidy-up at night — to the chat that
 * asked last, and before any has, to the model new chats start on.
 *
 * Only models that speak OpenAI's chat completions: that is what Understory
 * speaks to its server, and nothing here translates.
 */

/** Chats with a memory tool running, and in which order they started one: the newest is the one asking. */
const asking = new Map<string, { calls: number; since: number }>();
let lastAsked: string | undefined;
// A count, not a clock: two calls in the same millisecond are still one after the other.
let order = 0;

const isMemoryTool = (name: unknown) => typeof name === "string" && name.startsWith(`${UNDERSTORY}_`);

/** A tool call in a chat, starting or ending — its subagents' included, which are on its behalf. */
export function noteToolCall(sessionId: string, toolName: unknown, phase: "start" | "end"): void {
  if (!isMemoryTool(toolName)) return;
  const had = asking.get(sessionId);
  if (phase === "start") {
    asking.set(sessionId, { calls: (had?.calls ?? 0) + 1, since: ++order });
    lastAsked = sessionId;
  } else if (had) {
    if (had.calls <= 1) asking.delete(sessionId);
    else had.calls--;
  }
}

/** The chat a request from Understory is for. */
export function askingChat(): string | undefined {
  let newest: [string, number] | undefined;
  for (const [id, { since }] of asking) if (!newest || since > newest[1]) newest = [id, since];
  return newest?.[0] ?? lastAsked;
}

/**
 * A chat whose pi is gone — stopped, crashed, deleted — asks nothing any
 * more: a memory tool it was running never says it ended, and left there it
 * would stay "the chat asking" for good.
 */
export function forgetChat(sessionId: string): void {
  asking.delete(sessionId);
  if (lastAsked === sessionId) lastAsked = undefined;
}

/** For the tests: nobody has asked. */
export function forgetAsking(): void {
  asking.clear();
  lastAsked = undefined;
}

type ModelOf = (sessionId: string) => Promise<{ provider: string; id: string } | undefined>;

/** The provider and model a request goes to. */
export async function chosenModel(modelOf: ModelOf): Promise<{ provider: string; id: string; chat?: string }> {
  const chat = askingChat();
  if (chat) {
    const live = await modelOf(chat).catch(() => undefined);
    if (live) return { ...live, chat };
    const row = getSession(chat);
    if (row) {
      const { provider, model } = chatModel(row);
      if (model) return { provider, id: model, chat };
    }
  }
  const { provider, model } = chatModel({});
  return { provider, id: model };
}

class Refused extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

/** Where a model's chat completions go, and how to sign in there. */
async function endpointOf(provider: string, id: string): Promise<{ url: string; headers: Record<string, string> }> {
  const rt = await modelRuntime();
  const model = rt.getModel(provider, id);
  if (!model) throw new Refused(`The chat's model ${provider}/${id} is not one pi knows`);
  if (model.api !== "openai-completions") {
    throw new Refused(
      `The chat's model ${provider}/${id} speaks ${model.api}, not OpenAI chat completions, which is what Understory sends. Give Understory a model of its own in Settings → Add-ons → Memory.`,
    );
  }
  const auth = (await rt.getAuth(model).catch(() => undefined))?.auth ?? {};
  const base = String(auth.baseUrl ?? model.baseUrl ?? "").replace(/\/+$/, "");
  if (!base) throw new Refused(`The chat's model ${provider}/${id} has no address`);
  return {
    url: `${base}/chat/completions`,
    headers: {
      "content-type": "application/json",
      ...(model.headers ?? {}),
      ...(auth.headers ?? {}),
      ...(auth.apiKey ? { authorization: `Bearer ${auth.apiKey}` } : {}),
    },
  };
}

/** Mounted outside /api: Understory signs in with its own token, not a portal session. */
export function memoryLlmRouter(modelOf: ModelOf): Router {
  const router = express.Router();
  // Compared in constant time, and never against a key made for the asking:
  // none is there until Understory is set up to think with the chat's model.
  const signedIn = (req: express.Request) => {
    const key = existingLlmToken();
    const said = req.headers.authorization;
    if (!key || typeof said !== "string") return false;
    const want = Buffer.from(`Bearer ${key}`);
    const got = Buffer.from(said);
    return got.length === want.length && timingSafeEqual(got, want);
  };

  router.get("/understory-llm/v1/models", (req, res) => {
    if (!signedIn(req)) return res.status(401).json({ error: { message: "Not signed in" } });
    res.json({ object: "list", data: [{ id: "auto", object: "model", owned_by: "pithagoras" }] });
  });

  // Signed in first: a conversation-sized body is read only for Understory,
  // never for whoever can reach the port.
  const onlyUnderstory: express.RequestHandler = (req, res, next) =>
    signedIn(req) ? next() : res.status(401).json({ error: { message: "Not signed in" } });

  router.post("/understory-llm/v1/chat/completions", onlyUnderstory, express.json({ limit: "50mb" }), async (req, res) => {
    try {
      const { provider, id, chat } = await chosenModel(modelOf);
      const { url, headers } = await endpointOf(provider, id);
      console.log(`[portal] understory thinks with ${provider}/${id}${chat ? ` for ${chat}` : " (no chat asking)"}`);
      // Stopped with the request: Understory giving up is the model's cue to stop too.
      const stop = new AbortController();
      res.on("close", () => !res.writableEnded && stop.abort());
      const answer = await fetch(url, { method: "POST", headers, body: JSON.stringify({ ...req.body, model: id }), signal: stop.signal });
      res.status(answer.status);
      const type = answer.headers.get("content-type");
      if (type) res.setHeader("content-type", type);
      if (!answer.body) return res.end();
      // Through pipeline, which hears the error either side raises: Understory
      // hanging up aborts the model's answer, and that must end here, quietly.
      await pipeline(Readable.fromWeb(answer.body as any), res).catch(() => {});
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      const status = e instanceof Refused ? e.status : 502;
      if (!res.headersSent) res.status(status).json({ error: { message: (e as Error).message } });
      else res.end();
    }
  });

  return router;
}
