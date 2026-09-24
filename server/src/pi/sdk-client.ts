import { CanvasTools } from "./canvas-tools.js";
import { showImageTool } from "./show-image-tool.js";
import { acceptPrompt } from "./accept-prompt.js";
import { VoiceFirstTurn, audioSystemRules, audioMessage } from "./voice-first.js";
import { BROWSER_READING_RULE, BROWSER_SCREENSHOT_RULE } from "./browser-snapshot.js";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { PiClient, PiCommand, PiState, PiStats, PiTool, PromptTaken } from "./types.js";
import type { ImageContent } from "../prompt-images.js";
import { routineTools } from "./routine-tools.js";
import { reportTool, reportToFor } from "./report-tool.js";
import { guardExtension } from "./guard.js";
import { askPrimaryTool } from "./ask-primary.js";
import { proxyBaseUrl } from "../llama-progress.js";
import { bridgeSubagents, SUBAGENT_INPUT, SUBAGENT_STOP } from "../subagent-protocol.js";
import { contextWindowFor } from "../db.js";

/** A message on its way into pi: see SdkPiClient.prompt(). */
interface Handoff {
  /** Its words as handed to pi. */
  text: string;
  /** The queue it goes into if a run is going. */
  lane: "steering" | "followUp";
  /** Its words as pi queued them, once it has. */
  queued?: string;
}

function asArray(v: any): any[] {
  const resolved = typeof v === "function" ? v() : v;
  return Array.isArray(resolved) ? resolved : [];
}

/**
 * Files pi should treat as context on top of the ones it finds itself.
 *
 * Only picked up where they exist, so a task workspace is unaffected and the
 * agent's home directory gets its character, its user and its memory without
 * anything being generated.
 */
/**
 * The agent's own files, and who is allowed to see them.
 *
 * SOUL.md is who the agent is and travels everywhere. PrimaryUser.md and
 * MEMORY.md are one person's notes about themselves and their work, so a
 * conversation with anyone else must not load them — otherwise a teammate
 * messaging the bot gets an agent carrying your private context.
 *
 * TEAM.md is the shared half: what everyone may be told.
 */
const CONTEXT_FILES = ["SOUL.md", "PrimaryUser.md", "MEMORY.md"];
const SHARED_FILES = ["SOUL.md", "TEAM.md"];

const filesFor = (role?: string) => (!role || role === "primary" ? CONTEXT_FILES : SHARED_FILES);

export function extraContextFiles(cwd: string, role?: string): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = [];
  for (const name of filesFor(role)) {
    const file = path.join(cwd, name);
    try {
      if (existsSync(file)) out.push({ path: file, content: readFileSync(file, "utf8") });
    } catch {
      // Unreadable is the same as absent here; the session should still start.
    }
  }
  return out;
}

/**
 * A short anchor saying the files are the agent's own.
 *
 * Each file opens with its own instruction block, so this does not repeat them
 * — it exists because a context file is otherwise presented as reference
 * material, and the model read its own identity as notes about a third party.
 * One line at system level is enough to change what they are.
 */
function framing(cwd: string, role?: string): string[] {
  const present = filesFor(role).filter((name) => {
    try {
      return existsSync(path.join(cwd, name));
    } catch {
      return false;
    }
  });
  const lines: string[] = [...audioSystemRules(), BROWSER_READING_RULE, BROWSER_SCREENSHOT_RULE];
  if (present.length) {
    lines.push(
      `${present.join(", ")} in your working directory are yours, not reference material about someone else. Each opens with a block saying what it is for; follow it.`,
    );
  }
  // The bracketed-ref trap that used to need a line here is handled in the
  // guard now, which normalises the argument for every session whether it
  // reads this or not. Nothing to say, so nothing spent saying it.
  return lines;
}

/**
 * Skills shipped with the portal, loaded from the image rather than installed.
 *
 * Resolved relative to the compiled file so it works from dist and from source,
 * the same way the builtin channels are found.
 */
export function builtinSkillsDir(): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    path.resolve(here, "../../../skills"),
    path.resolve(here, "../../skills"),
    path.resolve(process.cwd(), "skills"),
    path.resolve(process.cwd(), "../skills"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Route a llama.cpp model through the portal's progress proxy.
 *
 * Only llama.cpp: it is the one provider that reports how far along a prompt
 * is, and the one where prefill is slow enough to be worth showing. Everything
 * else is returned untouched, and so is a llama model when there is no proxy —
 * a missed indicator is not a reason to fail to start.
 */
function viaProgressProxy<T extends { provider?: string; baseUrl?: string }>(
  model: T | undefined,
  sessionId: string | undefined,
): T | undefined {
  if (!model || !sessionId || !model.baseUrl || !isLlama(model.provider)) return model;
  // Already routed. Wrapping it again would nest one proxy path inside another.
  if (model.baseUrl.includes("/s/" + sessionId)) return model;
  const rerouted = proxyBaseUrl(sessionId, model.baseUrl);
  if (!rerouted) return model;
  console.log(`[portal] prefill progress for ${sessionId}: ${model.baseUrl} -> ${rerouted}`);
  return { ...model, baseUrl: rerouted };
}

/**
 * The ways a llama.cpp server shows up.
 *
 * pi has a built-in provider called `llama.cpp`, and the `pi-llama-cpp` package
 * registers one per server as `llama-server=<url>`. Behind a llama-swap gateway
 * neither fits — pi-llama-cpp probes `/props?model=<id>` for every model, which
 * llama-swap answers by loading it — so the gateway is a plain provider in
 * models.json named `llama-swap`. It is still llama-server underneath.
 */
function isLlama(provider: string | undefined): boolean {
  return provider === "llama.cpp" || provider === "llama-swap" || (provider?.startsWith("llama-server") ?? false);
}

/**
 * Who a tool belongs to, said the way a person would.
 *
 * pi's own `source` is the kind of place it came from — "builtin", "auto",
 * "inline" — which groups four unrelated packages under one word. The name is
 * in the path: the package for anything installed, the file for a loose
 * extension, and pi's own angle-bracketed markers for the rest.
 */
function sourceLabel(info: any): string {
  const path = typeof info?.path === "string" ? info.path : "";

  // pi writes its own as <builtin:read> and the portal's inline ones as
  // <inline:canvases>. The second is worth naming; the first is the agent.
  const marker = /^<(builtin|inline):([^>]+)>$/.exec(path);
  if (marker) return marker[1] === "inline" ? marker[2] : "built in";

  const pkg = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(path);
  if (pkg) return pkg[1];

  if (path) {
    const parts = path.split("/").filter(Boolean);
    const file = parts.pop() ?? "";
    const name = file.replace(/\.[cm]?[jt]sx?$/, "");
    // An extension in a directory of its own is named by the directory, which
    // is what its author called it — "index" is not a name.
    return name === "index" ? (parts.pop() ?? name) : name || "built in";
  }

  const source = typeof info?.source === "string" ? info.source.trim() : "";
  return source || "built in";
}

/** Read a member that may be a getter or a method, without assuming which. */
function callable(obj: any, key: string): any {
  const v = obj?.[key];
  return typeof v === "function" ? v.call(obj) : v;
}

/**
 * pi driven through its SDK, in this process.
 *
 * Preferred over the RPC subprocess for host sessions: pi's own docs recommend
 * it for Node, the config surface is typed instead of stringly-typed commands,
 * and — the reason this migration happened — `session.prompt()` runs registered
 * slash commands, which RPC accepted and then silently dropped.
 *
 * The trade is isolation: a crash here takes the portal with it, where a
 * subprocess crash only took its own session. Container sessions keep using RPC
 * and are unaffected.
 */
export class SdkPiClient extends EventEmitter implements PiClient {
  private disposed = false;
  private canvases?: CanvasTools;
  private voiceFirst?: VoiceFirstTurn;
  /** Dialogs an extension is waiting on, keyed by request id. */
  private pendingUi = new Map<string, (r: { cancelled?: boolean; value?: unknown }) => void>();
  /** The portal's own id for this conversation — what prefill progress is reported against. */
  portalSessionId?: string;
  /** The extensions' event bus, when this client made one. */
  bus?: { emit(channel: string, data: unknown): void };
  unbridge?: () => void;

  subagentInput(id: string, text: string): boolean {
    if (!this.bus) return false;
    this.bus.emit(SUBAGENT_INPUT, { id, text });
    return true;
  }

  subagentStop(id: string): boolean {
    if (!this.bus) return false;
    this.bus.emit(SUBAGENT_STOP, { id });
    return true;
  }
  /** The model object applyContextLimit last put on the session, to tell it from one pi put there. */
  private appliedModel?: object;
  /** What each model's own definition says its window is, as last seen on a model that was pi's. */
  private definitionWindows = new Map<string, number | undefined>();

  private constructor(
    private readonly session: any,
    private readonly modelRuntime: any,
    private readonly unsubscribe: () => void
  ) {
    super();
    this.setMaxListeners(0);
    this.guardActiveTools();
  }

  static async create(opts: {
    cwd: string;
    sessionDir: string;
    /** A previous run's session file. Reopened exactly, when it still exists. */
    sessionFile?: string;
    provider?: string;
    modelId?: string;
    thinkingLevel?: string;
    /**
     * Register the routine tools. Off unless asked: only a session reached
     * through a channel should be able to touch the schedule.
     */
    routineTools?: boolean;
    /**
     * The routine this session runs, when it is one. Gives the agent the report
     * tool, so a run with nobody watching can still reach someone.
     */
    routineSlug?: string | null;
    /** Whoever is speaking right now — read at each tool call. */
    whoNow?: () => { role: string; key?: string };
    /** Lowest role this conversation serves, deciding which context files load. */
    role?: string;
    /** Tools this conversation has switched off, by name. */
    toolsOff?: string[];
    /** The portal's session id, for tools that record against it. */
    sessionId?: string;
    /** False lets a run act on what it read — see guardExtension. */
    enforceTaint?: boolean;
    /** Read at each tool call, so a change takes effect without a restart. */
    browserNow?: () => { allowed: boolean; allowlist: string[] };
  }): Promise<SdkPiClient> {
    // Imported lazily so the server still boots (and the container executor
    // still works) if the SDK cannot initialise in this environment.
    const pi: any = await import("@earendil-works/pi-coding-agent");

    const modelRuntime = await pi.ModelRuntime.create();
    // Shared with the extensions, so one that runs a subagent can tell the
    // portal about it, and be told what the person wants of it.
    const eventBus = typeof pi.createEventBus === "function" ? pi.createEventBus() : undefined;

    // Without an explicit loader the SDK starts with no extensions, skills or
    // prompt templates — so installed packages contribute no commands at all.
    // The CLI wires this up for you; here it has to be asked for.
    const voiceFirst = new VoiceFirstTurn();
    const canvases = opts.sessionId ? new CanvasTools(opts.sessionId) : undefined;
    let resourceLoader: any;
    try {
      // Both are required: the constructor resolves each and throws on
      // undefined, which previously left every session with no extensions.
      const builtinSkills = builtinSkillsDir();
      // Every session, unconditionally: the point is to limit what a turn can do
      // after it reads something untrusted, and any session can read something.
      const factories: { name: string; factory: (pi: any) => void }[] = [
        { name: "voice-first", factory: voiceFirst.extension },
        { name: "guard", factory: guardExtension(
            opts.sessionDir,
            opts.whoNow ?? (() => ({ role: "primary" })),
            opts.sessionId,
            opts.enforceTaint !== false,
            opts.browserNow ?? (() => ({ allowed: false, allowlist: [] })),
          ) },
      ];
      if (canvases) factories.push({ name: "canvases", factory: canvases.extension });
      // Beside the canvases: both are how the agent puts something on the screen.
      if (opts.sessionId) factories.push({ name: "pictures", factory: showImageTool(opts.cwd) });
      if (opts.routineTools)
        factories.push({ name: "routines", factory: routineTools(opts.sessionId) });
      // Only where it means something: a conversation with the primary user has
      // nobody to escalate to, and the tool would just be noise.
      if (opts.sessionId && opts.role && opts.role !== "primary") {
        factories.push({ name: "ask-primary", factory: askPrimaryTool(opts.sessionId) });
      }
      // Only when there is somewhere for it to go — a tool that always fails is
      // worse than no tool, and the model will keep trying it.
      if (opts.routineSlug !== undefined && reportToFor(opts.routineSlug)) {
        factories.push({ name: "report", factory: reportTool(opts.routineSlug ?? null) });
      }
      resourceLoader = new pi.DefaultResourceLoader({
        cwd: opts.cwd,
        ...(eventBus ? { eventBus } : {}),
        agentDir: pi.getAgentDir(),
        // Available everywhere without being installed, and not editable in
        // place: they belong to the image, so an edit would be lost on the next
        // deploy without saying so.
        ...(builtinSkills ? { additionalSkillPaths: [builtinSkills] } : {}),
        // Inline rather than an installed package: the portal owns routines, so
        // a package would have to call back over HTTP to reach the database it
        // sits beside. Absent unless asked, so a task session never sees them.
        // Registered only where each belongs: routine management for sessions
        // reached through a channel, reporting for routine runs.
        ...(factories.length ? { extensionFactories: factories } : {}),
        // pi discovers one context file per directory — AGENTS.md or CLAUDE.md
        // — so the agent's own files would be invisible to it. Rather than
        // generating an AGENTS.md from them and keeping it in sync, they are
        // handed to pi as context files directly. Nothing to regenerate, and an
        // edit is live for the next session that starts.
        agentsFilesOverride: (base: { agentsFiles: any[] }) => ({
          agentsFiles: [...base.agentsFiles, ...extraContextFiles(opts.cwd, opts.role)],
        }),
        // Content alone is not enough. Handed over as plain context files, pi
        // presents them as reference material and the model answers "who are
        // you" from its own base identity — verified: it read a fact out of
        // MEMORY.md correctly while insisting it was Pi, made by Baidu. This
        // says what the files are for.
        appendSystemPrompt: framing(opts.cwd, opts.role),
      });
      await resourceLoader.reload();
    } catch (e) {
      console.error(`[portal] resource loader unavailable: ${(e as Error).message}`);
      resourceLoader = undefined;
    }

    // Resolved twice on purpose. Extensions register their own providers, and
    // they are not bound yet — so a llama-server model is invisible here and
    // only becomes findable further down, after bindExtensions.
    const wanted =
      opts.provider && opts.modelId ? { provider: opts.provider, modelId: opts.modelId } : undefined;
    const model = viaProgressProxy(
      wanted ? modelRuntime.getModel(wanted.provider, wanted.modelId) : undefined,
      opts.sessionId,
    );

    // Reopen the exact file this portal session owns, rather than creating a
    // new one — `create` started a fresh conversation on every restart, which
    // is why history vanished and context usage read 0%.
    //
    // Not continueRecent: "most recent in the directory" is a guess, and one
    // stray file would silently attach the wrong conversation. The path is
    // recorded in the database, so the mapping is exact.
    //
    // Note the argument order — (cwd, sessionDir). Only one was being passed,
    // so the session directory was taken as the working directory and pi filed
    // everything under an encoded path derived from it.
    const sessionManager =
      opts.sessionFile && existsSync(opts.sessionFile)
        ? pi.SessionManager.open(opts.sessionFile, opts.sessionDir, opts.cwd)
        : pi.SessionManager.create(opts.cwd, opts.sessionDir);

    const { session } = await pi.createAgentSession({
      cwd: opts.cwd,
      sessionManager,
      modelRuntime,
      ...(resourceLoader ? { resourceLoader } : {}),
      ...(model ? { model } : {}),
      ...(opts.thinkingLevel ? { thinkingLevel: opts.thinkingLevel } : {}),
    });

    const client = new SdkPiClient(session, modelRuntime, () => {});
    client.portalSessionId = opts.sessionId;
    client.canvases = canvases;
    if (eventBus && resourceLoader) {
      client.bus = eventBus;
      client.unbridge = bridgeSubagents(eventBus, (event) => client.emit("event", event));
    }
    if (resourceLoader) {
      client.voiceFirst = voiceFirst;
    }
    const unsub = session.subscribe((event: any) => {
      // Before anything is measured against the window: pi swaps the model for the
      // registry's whenever an extension registers a provider, and that undoes it.
      if (event?.type === "agent_start") client.applyLimitQuietly();
      canvases?.observe(event);
      // As pi emits it, not as forward() passes it on: a queue_update held
      // behind a settle would be too late for the prompt() that caused it.
      client.noteQueue(event);
      client.forward(event);
    });
    // Replace the placeholder now that we have the real unsubscribe.
    (client as any).unsubscribe = typeof unsub === "function" ? unsub : () => {};

    // Extensions are loaded by the resource loader but stay inert until they
    // are bound. Every pi mode does this; the SDK leaves it to the host, which
    // is why commands were missing and hasExtensionHandlers was false.
    //
    // Binding a uiContext is what makes interactive commands work at all: an
    // unbound host makes ctx.ui.select() return a default immediately, so a
    // command that asks the user something silently does nothing.

    client.switchedOff = new Set(opts.toolsOff ?? []);
    try {
      await session.bindExtensions({
        uiContext: client.buildUiContext(),
        mode: "rpc",
        commandContextActions: {
          waitForIdle: () => session.waitForIdle(),
          // Through the client, not the session: a reload has to put the tool
          // switches back, and only the client knows them.
          reload: () => client.reload(),
        },
        onError: (err: any) =>
          client.emit("event", {
            type: "extension_error",
            extensionPath: err?.extensionPath,
            error: String(err?.error ?? err),
          }),
      });
    } catch (e) {
      console.error(`[portal] binding extensions failed: ${(e as Error).message}`);
    }

    // Second attempt: the provider may only exist now that extensions are
    // bound. Without this the session silently ran on pi's fallback model.
    if (wanted && !model) {
      const late = viaProgressProxy(
        modelRuntime.getModel(wanted.provider, wanted.modelId),
        opts.sessionId,
      );
      if (late) {
        try {
          await session.setModel(late);
        } catch (e) {
          console.error(`[portal] could not apply ${wanted.modelId}: ${(e as Error).message}`);
        }
      } else {
        console.error(
          `[portal] model ${wanted.provider}/${wanted.modelId} not found; using pi's default`
        );
      }
    }

    // The portal only ever names a model when somebody picked one; most
    // sessions run on pi's own default, which is chosen in here and never
    // passes through the code above. Route whatever it settled on, or prefill
    // progress only ever appears for a session whose model was set by hand.
    try {
      const settled = session.model;
      const routed = viaProgressProxy(settled, opts.sessionId);
      if (routed && routed !== settled) await session.setModel(routed);
    } catch (e) {
      console.error(`[portal] could not route llama progress: ${(e as Error).message}`);
    }

    client.applyLimitQuietly();
    // After binding, not before: a tool an extension registers does not exist
    // until then, and switching it off ahead of time switches off nothing.
    if (client.switchedOff.size) client.applyToolsOff();
    return client;
  }

  get running(): boolean {
    return !this.disposed;
  }

  /** Undefined until pi has actually written the file. */
  get sessionFile(): string | undefined {
    return this.session.sessionFile ?? undefined;
  }

  /**
   * Bridges pi's extension dialogs to the browser: each call emits a request
   * event and parks a promise until the UI answers, mirroring what the TUI does
   * by drawing a menu.
   */
  private buildUiContext() {
    const ask = (payload: Record<string, unknown>, opts: any, fallback: unknown) =>
      new Promise((resolve) => {
        const id = randomUUID();
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const abort = () => finish(fallback);
        const finish = (value: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          opts?.signal?.removeEventListener?.("abort", abort);
          this.pendingUi.delete(id);
          resolve(value);
        };
        this.pendingUi.set(id, (r) => finish(r.cancelled ? fallback : r.value));

        // Never park forever — an unanswered dialog would wedge the session.
        const ms = typeof opts?.timeout === "number" ? opts.timeout : 300_000;
        timer = setTimeout(() => {
          if (settled) return;
          this.emit("event", { type: "extension_ui_cancel", id });
          finish(fallback);
        }, ms);
        if (typeof timer.unref === "function") timer.unref();
        opts?.signal?.addEventListener?.("abort", abort, { once: true });
        if (opts?.signal?.aborted) { abort(); return; }

        this.emit("event", { type: "extension_ui_request", id, ...payload });
      });

    const fireAndForget = (payload: Record<string, unknown>) =>
      this.emit("event", { type: "extension_ui_request", id: randomUUID(), ...payload });

    return {
      select: (title: string, options: string[], opts?: any) =>
        ask({ method: "select", title, options }, opts, undefined),
      confirm: (title: string, message: string, opts?: any) =>
        ask({ method: "confirm", title, message }, opts, false),
      input: (title: string, placeholder: string, opts?: any) =>
        ask({ method: "input", title, placeholder }, opts, undefined),
      editor: (title: string, content: string, opts?: any) =>
        ask({ method: "editor", title, defaultValue: content }, opts, undefined),
      notify: (message: string, type?: string) =>
        fireAndForget({ method: "notify", message, notifyType: type }),
      setStatus: (key: string, text: string) =>
        fireAndForget({ method: "setStatus", statusKey: key, statusText: text }),
      setWidget: (key: string, content: unknown) => {
        if (content === undefined || Array.isArray(content)) {
          fireAndForget({ method: "setWidget", widgetKey: key, widgetContent: content });
        }
      },
      onTerminalInput: () => () => {},
      // TUI-only affordances with no meaning in a browser.
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
      setHiddenThinkingLabel: () => {},
    };
  }

  /** Answer a dialog the UI just resolved. */
  respondUi(id: string, response: { cancelled?: boolean; value?: unknown }): boolean {
    const pending = this.pendingUi.get(id);
    if (!pending) return false;
    pending(response);
    return true;
  }

  async prompt(
    message: string,
    options?: { voice?: boolean; images?: ImageContent[]; steer?: boolean },
  ): Promise<PromptTaken> {
    if (options?.voice) {
      this.voiceFirst?.arm(this.isIdle());
    } else {
      this.voiceFirst?.reset();
    }
    const promptOptions = {
      expandPromptTemplates: true,
      // Mid-run, a message waits for the run to end — unless it was said to
      // steer it, when it is taken in after the tools that are running now.
      streamingBehavior: options?.steer ? "steer" : "followUp",
      ...(options?.images?.length ? { images: options.images } : {}),
    };
    // Answered once pi has taken it, typed or spoken, not once the run it
    // starts is over — as the RPC client does. `session.prompt()` holds on to
    // the whole run, and so did the request that sent it: the browser was
    // still "sending" for as long as the agent worked, and its Send stayed
    // greyed out, with no way to steer. What fails after that is reported as
    // portal_failed, ahead of the run's agent_settled: see forward().
    const text = options?.voice ? audioMessage(message) : message;
    const handoff: Handoff = { text, lane: options?.steer ? "steering" : "followUp" };
    this.handoffs.push(handoff);
    // pi says it has the message just before it either returns — queued, or
    // handled by an extension — or starts the run: idle then and running a
    // moment later is a run this message started.
    let idleWhenTaken = false;
    try {
      await acceptPrompt(
        preflightResult =>
          this.session.prompt(text, {
            ...promptOptions,
            preflightResult: (success: boolean) => {
              idleWhenTaken = this.session.isIdle;
              preflightResult(success);
            },
          }),
        error => {
          if (options?.voice) this.voiceFirst?.reset();
          const reason = error instanceof Error ? error.message : String(error);
          this.emit("event", { type: "portal_failed", error: `${options?.voice ? "Voice turn" : "The run"} failed: ${reason}` });
        },
      );
    } catch (error) { if (options?.voice) this.voiceFirst?.reset(); throw error; }
    finally {
      this.handoffs.splice(this.handoffs.indexOf(handoff), 1);
    }
    if (handoff.queued !== undefined) return { outcome: "queued", lane: handoff.lane, text: handoff.queued };
    return idleWhenTaken && !this.session.isIdle ? { outcome: "started" } : { outcome: "handled" };
  }

  /** Messages being handed to pi right now, oldest first: see noteQueue(). */
  private handoffs: Handoff[] = [];

  /** pi's queue as its last queue_update had it. */
  private queue: Record<Handoff["lane"], string[]> = { steering: [], followUp: [] };

  /**
   * Which message pi just queued, and as what.
   *
   * pi queues the words it ends up with — a template or skill expanded, an
   * input handler's rewrite applied — and says so in a queue_update with the
   * one entry added at the end. That is the message it hands the agent later,
   * word for word, so it is what the portal knows the message by. Given to the
   * message being handed over into that lane that says the same, or else the
   * oldest one: pi queues them in the order it is given them.
   */
  noteQueue(event: any): void {
    if (event?.type !== "queue_update") return;
    for (const lane of ["steering", "followUp"] as const) {
      const now = (Array.isArray(event[lane]) ? event[lane] : []).map(String);
      const was = this.queue[lane];
      if (now.length === was.length + 1 && was.every((text, i) => now[i] === text)) {
        const added = now[now.length - 1];
        const open = this.handoffs.filter((h) => h.lane === lane && h.queued === undefined);
        const handoff = open.find((h) => h.text === added) ?? open[0];
        if (handoff) handoff.queued = added;
      }
      this.queue[lane] = now;
    }
  }

  /** Events held back behind an agent_settled, in order: see forward(). */
  private held?: any[];

  /**
   * Hands pi's events on, keeping one order the portal depends on.
   *
   * pi settles a run in the finally of its prompt(), and only after that does
   * the prompt() throw for a run that failed. Passed on as they come, the
   * portal saw the run settle cleanly — idle, and an ask() answered with
   * whatever had been said — and heard about the failure afterwards, when
   * nothing was listening. So a settle waits for the turn of the event loop
   * after it, with anything behind it: nothing but promises stand between it
   * and that throw, and all of them are through by then.
   *
   * Held for that one turn and no longer, with whatever pi emits in it: a
   * prompt can start the next run in the moment pi has marked itself idle but
   * not yet settled the last one, and events of that run are passed on after
   * the settle rather than before it.
   */
  forward(event: any): void {
    if (this.held) {
      this.held.push(event);
      return;
    }
    if (event?.type === "agent_settled") {
      const held = (this.held = [event]);
      setImmediate(() => {
        this.held = undefined;
        const [settled, ...after] = held;
        this.emit("event", settled);
        for (const e of after) this.forward(e);
      });
      return;
    }
    this.emit("event", event);
  }

  async abort(): Promise<void> {
    // Compaction runs on a controller of its own, so session.abort() stops an
    // agent run and leaves a summarisation going — the one case where Stop
    // looks like it did nothing at all.
    if (this.session.isCompacting) this.session.abortCompaction();
    try { await this.session.abort(); } finally { this.canvases?.interrupt(); }
  }

  /**
   * True when nothing is streaming — a command that ran no agent turn is idle.
   *
   * `isIdle` and `isStreaming` are getters, not methods. Calling them threw
   * every time, the throw was swallowed, and this answered "idle" for a session
   * that was mid-run — which is why the Stop button kept vanishing while the
   * model was still working. It also covers a queued follow-up and a retry,
   * neither of which ends at agent_end.
   */
  isIdle(): boolean {
    return this.session.isIdle;
  }

  clearQueue(): string[] {
    const { steering, followUp } = this.session.clearQueue();
    return [...steering, ...followUp].map(String);
  }

  dispose(): void {
    this.unbridge?.();
    if (this.disposed) return;
    this.disposed = true;
    this.canvases?.interrupt();
    try {
      this.unsubscribe();
    } catch {
      // best effort
    }
    try {
      this.session.dispose?.();
    } catch {
      // best effort
    }
    this.emit("exit", { code: 0, signal: null });
  }

  async getState(): Promise<PiState> {
    const model = this.session.model;
    return {
      model: {
        id: model?.id ?? "unknown",
        name: model?.name ?? "unknown",
        provider: model?.provider ?? "unknown",
        contextWindow: model?.contextWindow,
        input: Array.isArray(model?.input) ? model.input : undefined,
      },
      thinkingLevel: this.session.thinkingLevel ?? "medium",
      autoCompactionEnabled: callable(this.session, "autoCompactionEnabled") ?? true,
      messageCount: callable(this.session, "messages")?.length,
    };
  }

  async getStats(): Promise<PiStats> {
    // Read here as well as on run start: the figure shown is worked out against
    // whatever model the session has now.
    this.applyLimitQuietly();
    const stats = (await this.session.getSessionStats?.()) ?? {};
    const usage = (await this.session.getContextUsage?.()) ?? {};
    const contextWindow = usage.contextWindow ?? this.session.model?.contextWindow ?? 0;
    const used = usage.tokens ?? 0;
    return {
      tokens: stats.tokens ?? { input: 0, output: 0, total: 0 },
      cost: stats.cost ?? 0,
      contextUsage: {
        tokens: used,
        contextWindow,
        percent: usage.percent ?? (contextWindow ? (used / contextWindow) * 100 : 0),
      },
      toolCalls: stats.toolCalls ?? 0,
      totalMessages: stats.totalMessages ?? 0,
    };
  }

  async getThinkingLevels(): Promise<string[]> {
    const levels = callable(this.session, "getAvailableThinkingLevels");
    return Array.isArray(levels) && levels.length
      ? levels
      : ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
  }

  /** Only models with working auth, unlike RPC which listed the whole catalogue. */
  async getModels(): Promise<PiState["model"][]> {
    const available = (await this.modelRuntime.getAvailable?.()) ?? [];
    return available.map((m: any) => ({
      id: m.id,
      name: m.name ?? m.id,
      provider: m.provider,
      contextWindow: m.contextWindow,
      input: Array.isArray(m.input) ? m.input : undefined,
    }));
  }

  /** Names this session has switched off. Applied at every start and on change. */
  /** Not private: create() fills it before the session is handed over. */
  switchedOff = new Set<string>();

  /**
   * What pi wants active, before the switches take anything out of it.
   *
   * The registry is not that: `getAllTools()` is every definition pi knows,
   * including `grep`, `find` and `ls`, which it registers and leaves inactive.
   * Subtracting the switches from the registry switched those on the first
   * time anyone turned anything off. The baseline is pi's own choice, in
   * whatever way it makes it — at start, when an extension registers a tool
   * later, on a reload — and the switches only ever take names out of it.
   */
  private wanted = new Set<string>();
  private activate?: (names: string[]) => void;

  /**
   * Put the switches in the one place every activation goes through.
   *
   * pi activates tools from several directions and none of them asks us: an
   * extension that registers a tool later (`lifecycle: "lazy"` is the whole
   * point of an MCP server that connects on first use) has it activated by
   * `refreshTools()`, and a reload activates every extension tool again. Each
   * ends in `setActiveToolsByName`, so that is where the names come out.
   */
  private guardActiveTools(): void {
    const session = this.session;
    if (typeof session?.setActiveToolsByName !== "function") return;
    const original = session.setActiveToolsByName.bind(session) as (names: string[]) => void;
    this.activate = original;
    try {
      this.wanted = new Set<string>(session.getActiveToolNames?.() ?? []);
    } catch {
      this.wanted = new Set();
    }
    session.setActiveToolsByName = (names: string[]) => {
      this.wanted = new Set([...names, ...this.heldBack(session, names)]);
      original(names.filter((name) => !this.switchedOff.has(name)));
    };
  }

  /**
   * What is switched off and still wanted, though `names` leaves it out.
   *
   * pi refreshes — an extension registering a tool, an MCP server connecting, a
   * reload — by adding to `getActiveToolNames()`, which the switches have
   * already thinned. Taken as it came, every refresh dropped whatever was off
   * from what pi wants: gone from the chat's list, with no way to switch it
   * back on. Such a list keeps everything that is active; one that leaves an
   * active tool out is a choice — an extension narrowing the tools — and means
   * what it says. Either way a tool pi no longer has, its extension unloaded,
   * is not wanted any more.
   */
  private heldBack(session: any, names: string[]): string[] {
    let active: string[];
    let known: Set<string>;
    try {
      active = session.getActiveToolNames?.() ?? [];
      known = new Set((session.getAllTools?.() ?? []).map((tool: any) => String(tool.name)));
    } catch {
      return [];
    }
    if (!active.every((name) => names.includes(name))) return [];
    return [...this.wanted].filter((name) => this.switchedOff.has(name) && !names.includes(name) && known.has(name));
  }

  /**
   * Every tool the session could be offered, with where it came from.
   *
   * The source is what a person recognises: a package name rather than the
   * path pi tracks it by, so the list groups the way somebody thinks about it
   * — "the web search one", not four unrelated rows. A tool pi leaves inactive
   * is not listed: a tick beside something the model cannot call is a state
   * the session is not in.
   */
  async getTools(): Promise<PiTool[]> {
    const all: any[] = this.session.getAllTools?.() ?? [];
    const offered = this.wanted.size ? all.filter((tool) => this.wanted.has(String(tool.name))) : all;
    return offered.map((tool) => ({
      name: String(tool.name),
      description: typeof tool.description === "string" ? tool.description : undefined,
      source: sourceLabel(tool.sourceInfo),
      enabled: !this.switchedOff.has(String(tool.name)),
    }));
  }

  /**
   * Switch tools off by name.
   *
   * Named rather than listing what stays: pi wants the active set, but that is
   * a snapshot, and a tool registered later would silently never be on. The
   * active set is computed from what pi wants right now, every time.
   */
  async setToolsOff(names: string[]): Promise<void> {
    this.switchedOff = new Set(names);
    this.applyToolsOff();
  }

  applyToolsOff(): void {
    try {
      if (!this.activate || !this.wanted.size) return;
      this.activate([...this.wanted].filter((name) => !this.switchedOff.has(name)));
    } catch (e) {
      console.error(`[portal] could not apply the tool switches: ${(e as Error).message}`);
    }
  }

  /**
   * Commands come from three places, matching how pi builds this list.
   * Extension commands live on the runner — promptTemplates alone is only the
   * templates, which is why an installed extension contributed nothing here.
   */
  async getCommands(): Promise<PiCommand[]> {
    const commands: PiCommand[] = [];

    for (const c of this.session.extensionRunner?.getRegisteredCommands?.() ?? []) {
      commands.push({
        name: c.invocationName ?? c.name,
        description: c.description,
        source: "extension",
      });
    }
    for (const t of asArray(this.session.promptTemplates)) {
      commands.push({ name: t.name, description: t.description, source: "prompt" });
    }
    for (const skill of asArray(this.session.resourceLoader?.getSkills?.()?.skills)) {
      commands.push({
        name: `skill:${skill.name}`,
        description: skill.description,
        source: "skill",
      });
    }
    return commands;
  }

  async setModel(provider: string, modelId: string): Promise<void> {
    const model = this.modelRuntime.getModel(provider, modelId);
    if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);
    await this.session.setModel(viaProgressProxy(model, this.portalSessionId) ?? model);
    this.applyLimitQuietly();
  }

  /**
   * Give the session the context window this portal holds the model to.
   *
   * pi reads the window off the model it is running, so the number is put there
   * rather than beside it — the percentage and the moment of compaction then
   * agree with it. Assigned to the agent's state instead of going through
   * setModel, which writes a model change into the conversation and into pi's
   * default model. With nothing set the definition's own number is put back, so
   * removing a limit takes effect too.
   */
  /**
   * For the places that have another job first: reading a stored number and
   * looking at the session's model can both fail (a database closing at
   * shutdown, a pi release that stops exposing `agent`), and a run that never
   * gets to say it started, or a config that answers 500 and takes every pill
   * with it, is a poor price for a window that could not be read.
   */
  applyLimitQuietly(): void {
    try {
      this.applyContextLimit();
    } catch (e) {
      console.error(`[portal] could not apply the context window: ${(e as Error).message}`);
    }
  }

  applyContextLimit(): void {
    const current = this.session.model;
    if (!current) return;
    const key = `${current.provider}/${current.id}`;
    // A model that is not the one put here last is pi's own — the registry's, put
    // back after a reload or a provider registering — and its window is what the
    // definition says. Kept, because the registry cannot always say it later: a
    // provider that has gone leaves nothing to look it up in, and the window
    // would then stay wherever it was last set.
    if (current !== this.appliedModel) this.definitionWindows.set(key, current.contextWindow);
    const declared = this.modelRuntime.getModel(current.provider, current.id)?.contextWindow ?? this.definitionWindows.get(key);
    const wanted = contextWindowFor(current.provider, current.id, declared);
    if (wanted === current.contextWindow) return;
    const next = { ...current, contextWindow: wanted };
    this.appliedModel = next;
    this.session.agent.state.model = next;
  }

  async setThinkingLevel(level: string): Promise<void> {
    this.session.setThinkingLevel(level);
  }

  /**
   * Re-read pi's settings file into this session.
   *
   * A session takes a copy of the settings when it starts, so a compaction
   * tuned in the UI would otherwise not reach anything already open — and the
   * session you are looking at when you change it is exactly the one you meant.
   * Only the file is re-read; anything set on this session was written there
   * too, so nothing is lost.
   */
  async refreshSettings(): Promise<void> {
    await this.session.settingsManager?.reload?.();
  }

  async setAutoCompaction(enabled: boolean): Promise<void> {
    this.session.setAutoCompactionEnabled(enabled);
  }

  async setAutoRetry(enabled: boolean): Promise<void> {
    this.session.setAutoRetryEnabled(enabled);
  }

  async compact(): Promise<void> {
    await this.session.compact();
  }

  async reload(): Promise<void> {
    await this.session.reload();
    // Reloading has extensions register their providers again, which puts the
    // registry's model, with its own window, back on the session.
    this.applyLimitQuietly();
    // And has pi switch every extension tool back on — which is every MCP tool,
    // the browser's among them. The switches are the portal's to keep.
    if (this.switchedOff.size) this.applyToolsOff();
  }

  /** HTML unless a .jsonl path is given, matching pi's own /export. */
  async exportSession(target?: string): Promise<string> {
    if (target && target.endsWith(".jsonl")) return this.session.exportToJsonl(target);
    return await this.session.exportToHtml(target);
  }
}
