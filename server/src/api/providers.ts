import express, { type Router } from "express";
import {
  APIS, PRESETS, ProbeError, checkProviders, configStamp, listProviders, probeModels, removeProvider, saveProvider, storedKey,
  type ProviderKind,
} from "../providers.js";

/**
 * pi's view of every model, outside any conversation — for the defaults in
 * Settings, which have no session to ask. Built once and kept until the files
 * it was built from change: creating it reads pi's whole catalogue.
 */
let runtime: { stamp: string; value: Promise<any> } | undefined;
function modelRuntime(): Promise<any> {
  const stamp = configStamp();
  if (runtime?.stamp !== stamp) {
    const value = import("@earendil-works/pi-coding-agent").then((pi: any) => pi.ModelRuntime.create());
    runtime = { stamp, value };
    value.catch(() => { if (runtime?.value === value) runtime = undefined; });
  }
  return runtime.value;
}

/** pi's names for its hosted services, and which of them it finds a key for outside its files. */
async function services(): Promise<{ names: Record<string, string>; envKeyed: Record<string, string>; hosted: { id: string; name: string }[] }> {
  try {
    const rt = await modelRuntime();
    const names: Record<string, string> = {};
    const envKeyed: Record<string, string> = {};
    const hosted: { id: string; name: string }[] = [];
    for (const p of rt.getProviders() as { id: string; name?: string }[]) {
      names[p.id] = p.name ?? p.id;
      hosted.push({ id: p.id, name: p.name ?? p.id });
      const status = rt.getProviderAuthStatus?.(p.id);
      if (status?.configured && status.source === "environment") envKeyed[p.id] = "environment";
    }
    hosted.sort((a, b) => a.name.localeCompare(b.name));
    return { names, envKeyed, hosted };
  } catch {
    return { names: {}, envKeyed: {}, hosted: [] };
  }
}

const KINDS = new Set(PRESETS.map((p) => p.kind));

export function providersRouter(): Router {
  const router = express.Router();

  router.get("/providers", async (_req, res) => {
    const { names, envKeyed, hosted } = await services();
    res.json({ presets: PRESETS, apis: APIS, providers: listProviders(names, envKeyed), hosted });
  });

  /** Whether each server answers now: for the dot beside it. */
  router.get("/providers/status", async (_req, res) => {
    res.json({ status: await checkProviders() });
  });

  /** Asks a server for its models, before or after it is saved. */
  router.post("/providers/probe", async (req, res) => {
    const { kind, baseUrl, apiKey, id } = req.body ?? {};
    if (!KINDS.has(kind) || typeof baseUrl !== "string" || !baseUrl.trim()) return res.status(400).json({ error: "An address to ask is needed." });
    try {
      const found = await probeModels(kind as ProviderKind, baseUrl, typeof apiKey === "string" ? apiKey : undefined, typeof id === "string" ? storedKey(id) : undefined);
      res.json(found);
    } catch (e) {
      res.status(e instanceof ProbeError ? 502 : 400).json({ error: (e as Error).message });
    }
  });

  router.put("/providers/:id", async (req, res) => {
    const body = req.body ?? {};
    if (!KINDS.has(body.kind)) return res.status(400).json({ error: "Which kind of provider this is was not said." });
    try {
      await saveProvider(req.params.id, {
        kind: body.kind,
        baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : undefined,
        api: typeof body.api === "string" ? body.api : undefined,
        apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
        models: Array.isArray(body.models) ? body.models.filter((m: any) => m && typeof m.id === "string") : undefined,
      });
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  router.delete("/providers/:id", async (req, res) => {
    const found = await removeProvider(req.params.id);
    res.status(found ? 200 : 404).json(found ? { ok: true } : { error: "Nothing is set up under that name." });
  });

  /** Every model pi can use now — the ones with a key — for the defaults. */
  router.get("/models", async (_req, res) => {
    try {
      const rt = await modelRuntime();
      const available = (await rt.getAvailable()) as any[];
      const names: Record<string, string> = {};
      for (const p of rt.getProviders() as { id: string; name?: string }[]) names[p.id] = p.name ?? p.id;
      res.json({
        models: available.map((m) => ({
          provider: m.provider, id: m.id, name: m.name ?? m.id, contextWindow: m.contextWindow,
          input: Array.isArray(m.input) ? m.input : undefined, reasoning: m.reasoning === true,
        })),
        providers: names,
      });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  return router;
}
