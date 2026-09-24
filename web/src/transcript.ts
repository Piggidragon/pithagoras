import type { PortalEvent } from "./api";

/** A picture that went with a message, by the name the server keeps it under. */
export interface SentImage {
  name: string;
  mimeType: string;
}

const sentImages = (raw: unknown): SentImage[] | undefined => {
  if (!Array.isArray(raw)) return undefined;
  const list = raw.filter((i): i is SentImage => typeof i?.name === "string" && typeof i?.mimeType === "string");
  return list.length ? list : undefined;
};

/** A picture the agent put in front of the person with show_image: its path in the chat's folder. */
export interface ShownPicture {
  path: string;
  title?: string;
}

/** The picture a show_image call ended with, when it succeeded. */
export function shownPicture(payload: any): ShownPicture | undefined {
  if (String(payload?.toolName ?? payload?.name ?? "") !== "show_image" || payload?.isError) return undefined;
  const details = payload?.result?.details;
  if (typeof details?.path !== "string" || !details.path) return undefined;
  return { path: details.path, ...(typeof details.title === "string" && details.title ? { title: details.title } : {}) };
}

export type Item =
  /**
   * `queued`: sent into a run, and not taken in by pi yet — after the current
   * step when `steer`, at the end of the run otherwise. `unsent`: the run was
   * stopped first, or the portal restarted, so it never reached pi — or, for
   * `unsure`, the portal restarted and could not tell whether it had.
   */
  | {
      kind: "user";
      id: string;
      seq: number;
      text: string;
      audio?: boolean;
      images?: SentImage[];
      queued?: boolean;
      steer?: boolean;
      unsent?: "stopped" | "restarted" | "unsure";
    }
  /** `thinkingSince`/`thinkingUntil`: when the reasoning started and last grew, for "Thought for 12s". */
  | { kind: "assistant"; id: string; text: string; thinking: string; done: boolean; audio?: boolean; thinkingSince?: number; thinkingUntil?: number }
  /**
   * `args`: what the tool was called with, whole. `output`: the text it gave
   * back — as it streams, then as it ended — kept to the last TOOL_OUTPUT_MAX.
   */
  | {
      kind: "tool";
      id: string;
      name: string;
      callId?: string;
      status: "running" | "done" | "error";
      detail?: string;
      picture?: ShownPicture;
      args?: unknown;
      output?: string;
      /** What the tool reported about itself beside its text — an extension's progress, its subagent's steps. */
      details?: unknown;
      /** How many updates it streamed while it ran: a tool that reports as it goes is doing something worth watching. */
      updates?: number;
      /** The run ended with this call still open: it never said how it came out. */
      interrupted?: boolean;
      since?: number;
      until?: number;
    }
  /** The conversation summarized to make room, while that runs and after. */
  | { kind: "compaction"; id: string; status: "running" | "done" | "failed"; tokensBefore?: number; summary?: string; since?: number; until?: number }
  | { kind: "notice"; id: string; text: string; tone: "info" | "warn" | "error" }
  /**
   * A slash command sent, and how it went: `done` when it showed something of
   * its own, `quiet` when it ran and showed nothing, `started`/`queued` when it
   * became a run, `failed` with why.
   */
  | { kind: "command"; id: string; seq: number; text: string; state: CommandState; error?: string };

export type CommandState = "running" | "done" | "quiet" | "started" | "queued" | "failed";

/** Enough of a tool's output to read in the transcript; the whole of it is in the agent terminal. */
const TOOL_OUTPUT_MAX = 60_000;

/** The text of a tool result, however pi shaped it. */
export function toolOutputText(result: any): string | undefined {
  if (typeof result === "string") return result;
  const content = result?.content;
  if (!Array.isArray(content)) return undefined;
  const text = content.filter((c: any) => c?.type === "text" && typeof c.text === "string").map((c: any) => c.text).join("\n");
  return text;
}

type UserItem = Extract<Item, { kind: "user" }>;

/** A message as its portal_prompt payload describes it. */
function userItem(seq: number, p: any): UserItem {
  const raw = String(p?.message ?? "");
  const tagged = raw.startsWith("[Audio mode]\n");
  const images = sentImages(p?.images);
  return {
    kind: "user",
    id: `u${seq}`,
    seq,
    text: tagged ? raw.slice("[Audio mode]\n".length) : raw,
    audio: p?.voice === true || tagged,
    ...(images ? { images } : {}),
    ...(p?.steer === true ? { steer: true } : {}),
  };
}

/**
 * Fold pi's event stream into renderable turns.
 *
 * Deliberately tolerant: pi emits more event types than we render, and shapes
 * vary by version. Anything unrecognised is skipped rather than breaking the
 * transcript — a task that ran fine shouldn't look broken because of one
 * unexpected field.
 */
export function buildTranscript(events: PortalEvent[], options: { ended?: boolean } = {}): Item[] {
  const items: Item[] = [];
  let audioReply = false;
  let current: Extract<Item, { kind: "assistant" }> | null = null;
  // Sent mid-run and not yet taken in. Put where pi took it in — where the
  // agent read it — rather than where it was sent, which is the middle of a
  // reply it had nothing to do with.
  const waiting = new Map<number, UserItem>();
  // Where a message sent into a run was placed. The prompt it was sent as can
  // be older than the events loaded — a long run, and a page that loads only
  // the end — so the placing event carries it too, and it stands in.
  //
  // One sent as starting a run of its own, that pi queued into a run begun in
  // the same moment, is already in the list where it was sent, and moves.
  const placed = (seq: number, prompt: unknown): UserItem | undefined => {
    const item = waiting.get(seq);
    if (item) {
      waiting.delete(seq);
      return item;
    }
    const shown = items.findIndex((it) => it.kind === "user" && it.seq === seq);
    if (shown >= 0) return items.splice(shown, 1)[0] as UserItem;
    return prompt && typeof prompt === "object" ? userItem(seq, prompt) : undefined;
  };

  const closeCurrent = () => {
    if (current) {
      current.done = true;
      current = null;
    }
  };

  // The run is over, so nothing in it is still going. A call whose end never
  // came — the process died, the portal restarted, a stop cut it short — would
  // otherwise spin for good; it says it was cut off instead.
  const settle = () => {
    closeCurrent();
    for (const it of items) {
      if (it.kind === "tool" && it.status === "running") {
        it.status = "error";
        it.interrupted = true;
      } else if (it.kind === "compaction" && it.status === "running") it.status = "failed";
      // Its end was never written — the portal restarted. It ran, as far as anyone can say.
      else if (it.kind === "command" && it.state === "running") it.state = "done";
    }
  };

  for (const ev of events) {
    const p = ev.payload ?? {};
    switch (ev.type) {
      case "portal_prompt": {
        const item = userItem(ev.seq, p);
        if (p.queued === true) {
          waiting.set(ev.seq, item);
          break;
        }
        closeCurrent();
        audioReply = item.audio === true;
        items.push(item);
        break;
      }

      case "portal_taken": {
        const item = placed(Number(p.seq), p.prompt);
        if (!item) break;
        closeCurrent();
        audioReply = item.audio === true;
        items.push(item);
        break;
      }

      // Stopped before pi took them in: they never reached it. Shown where the
      // run was stopped, as not sent, so the words are not simply gone.
      case "portal_unsent":
        if (!Array.isArray(p.seqs)) break;
        for (const seq of p.seqs) {
          const item = placed(Number(seq), p.prompts?.[seq]);
          if (!item) continue;
          closeCurrent();
          items.push({ ...item, unsent: p.unsure === true ? "unsure" : p.restarted === true ? "restarted" : "stopped" });
        }
        break;

      case "message_update": {
        const inner = p.assistantMessageEvent ?? {};
        const delta = typeof inner.delta === "string" ? inner.delta : "";
        if (!delta) break;
        if (!current) {
          current = { kind: "assistant", id: `a${p.streamId ?? ev.seq}`, text: "", thinking: "", done: false, audio: audioReply };
          items.push(current);
        }
        if (inner.type === "thinking_delta") {
          current.thinking += delta;
          if (ev.at !== undefined) {
            current.thinkingSince ??= ev.at;
            current.thinkingUntil = ev.at;
          }
        }
        else if (inner.type === "text_delta") current.text += delta;
        break;
      }

      case "message_snapshot":
      case "message_end": {
        const message = p.message;
        if (message?.role === "assistant" && Array.isArray(message.content)) {
          const text = message.content.filter((c: any) => c?.type === "text").map((c: any) => c.text ?? "").join("");
          const thinking = message.content.filter((c: any) => c?.type === "thinking").map((c: any) => c.thinking ?? "").join("");
          if (!current) {
            current = { kind: "assistant", id: `a${p.streamId ?? ev.seq}`, text: "", thinking: "", done: false, audio: audioReply };
            items.push(current);
          }
          current.text = text;
          if (ev.at !== undefined && thinking !== current.thinking) {
            current.thinkingSince ??= ev.at;
            current.thinkingUntil = ev.at;
          }
          current.thinking = thinking;
        }
        // What an extension puts in the conversation for people to read —
        // pi.sendMessage with display on. pi's TUI draws it; so does this.
        if (ev.type === "message_end" && message?.role === "custom" && message.display !== false) {
          const text = typeof message.content === "string"
            ? message.content
            : Array.isArray(message.content) ? message.content.filter((c: any) => c?.type === "text").map((c: any) => c.text ?? "").join("\n") : "";
          if (text.trim()) items.push({ kind: "notice", id: `m${ev.seq}`, text: text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trim(), tone: "info" });
          break;
        }
        if (ev.type === "message_end") closeCurrent();
        break;
      }

      case "tool_execution_start": {
        closeCurrent();
        const args = p.input ?? p.args ?? p.parameters;
        items.push({
          kind: "tool",
          id: `t${ev.seq}`,
          callId: typeof p.toolCallId === "string" ? p.toolCallId : undefined,
          name: String(p.toolName ?? p.name ?? "tool"),
          status: "running",
          detail: summarizeToolInput(p),
          ...(args !== undefined ? { args } : {}),
          ...(ev.at !== undefined ? { since: ev.at } : {}),
        });
        break;
      }

      case "tool_execution_update": {
        const tool = findRunningTool(items, p);
        const partial = p.partialResult ?? p.result;
        const text = toolOutputText(partial);
        if (tool && typeof text === "string") tool.output = text.slice(-TOOL_OUTPUT_MAX);
        if (tool) {
          tool.updates = (tool.updates ?? 0) + 1;
          if (partial?.details !== undefined) tool.details = partial.details;
        }
        break;
      }

      case "compaction_start":
        items.push({ kind: "compaction", id: `c${ev.seq}`, status: "running", ...(ev.at !== undefined ? { since: ev.at } : {}) });
        break;

      case "compaction_end": {
        let open: Extract<Item, { kind: "compaction" }> | undefined;
        for (let i = items.length - 1; i >= 0 && !open; i--) {
          const it = items[i];
          if (it.kind === "compaction" && it.status === "running") open = it;
        }
        // The start can be on a page not loaded yet.
        if (!open) items.push((open = { kind: "compaction", id: `c${ev.seq}`, status: "running" }));
        const result = p.result ?? {};
        open.status = p.aborted || p.errorMessage ? "failed" : "done";
        if (ev.at !== undefined) open.until = ev.at;
        if (typeof result.tokensBefore === "number") open.tokensBefore = result.tokensBefore;
        if (typeof result.summary === "string" && result.summary) open.summary = result.summary;
        break;
      }

      case "tool_execution_end": {
        // Close the most recent still-running tool of the same name.
        const name = String(p.toolName ?? p.name ?? "tool");
        for (let i = items.length - 1; i >= 0; i--) {
          const it = items[i];
          if (it.kind === "tool" && it.status === "running" &&
              (p.toolCallId ? it.callId === p.toolCallId : it.name === name)) {
            it.status = p.isError || p.error ? "error" : "done";
            if (ev.at !== undefined) it.until = ev.at;
            const text = toolOutputText(p.result);
            if (typeof text === "string" && text) it.output = text.slice(-TOOL_OUTPUT_MAX);
            if (p.result?.details !== undefined) it.details = p.result.details;
            const picture = shownPicture(p);
            if (picture) it.picture = picture;
            break;
          }
        }
        break;
      }

      // Not closing the answer being written: a command runs beside a run, and
      // the answer goes on after it.
      case "portal_command":
        items.push({ kind: "command", id: `c${ev.seq}`, seq: ev.seq, text: String(p.text ?? ""), state: "running" });
        break;

      case "portal_command_end": {
        const it = items.find((x): x is Extract<Item, { kind: "command" }> => x.kind === "command" && x.seq === p.of);
        if (!it) break;
        if (typeof p.error === "string") {
          it.state = "failed";
          it.error = p.error;
        } else it.state = p.quiet ? "quiet" : p.outcome === "started" ? "started" : p.outcome === "queued" ? "queued" : "done";
        break;
      }

      // Output from a builtin like /session or /compact — pi never saw it.
      case "portal_notice":
        items.push({
          kind: "notice",
          id: `n${ev.seq}`,
          text: String(p.text ?? ""),
          tone: p.error ? "error" : p.warning ? "warn" : "info",
        });
        break;

      case "portal_status":
        if (p.status === "error" && p.error) {
          items.push({ kind: "notice", id: `n${ev.seq}`, text: String(p.error), tone: "error" });
        }
        if (p.status === "idle" && p.aborted) {
          items.push({ kind: "notice", id: `n${ev.seq}`, text: "Aborted", tone: "info" });
        }
        if (typeof p.status === "string" && p.status !== "running") settle();
        break;

      case "agent_end":
        settle();
        break;

      default:
        break;
    }
  }

  // The caller knows the run is over even where no event says so: a portal
  // restarted mid-run records nothing.
  if (options.ended) settle();

  // Anything still open belongs to a run in flight, and what is waiting to go
  // into it comes after.
  for (const item of waiting.values()) items.push({ ...item, queued: true });
  return items;
}

/**
 * The bubble Copy belongs on: the last stretch of the agent's answer that has
 * something to read and is not still changing under it.
 *
 * A turn with tool calls in the middle closes the assistant item before each
 * one and opens a new one after, so a single answer can be several bubbles —
 * one per paragraph around a tool. Offering Copy on all of them is a button
 * under every paragraph; only the last has the whole of what was said.
 *
 * And only when the answer ends there. A paragraph followed by a tool call is
 * the agent saying what it is about to do, not an answer — a Copy under it
 * sat between the words and the call like a stray gap.
 */
export function lastReplyId(items: readonly Item[]): string | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === "tool") return undefined;
    if (it.kind === "assistant" && it.text) return it.done ? it.id : undefined;
  }
  return undefined;
}

/** The call an update belongs to: by its id, or else the newest one of that name still running. */
function findRunningTool(items: Item[], p: any): Extract<Item, { kind: "tool" }> | undefined {
  const name = String(p.toolName ?? p.name ?? "");
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind !== "tool") continue;
    if (p.toolCallId ? it.callId === p.toolCallId : it.status === "running" && (!name || it.name === name)) return it;
  }
  return undefined;
}

function summarizeToolInput(p: any): string | undefined {
  const input = p.input ?? p.args ?? p.parameters;
  if (!input) return undefined;
  if (typeof input === "string") return truncate(input);
  if (typeof input === "object") {
    const first =
      input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.query;
    if (typeof first === "string") return truncate(first);
    return truncate(JSON.stringify(input));
  }
  return undefined;
}

function truncate(s: string, n = 160): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? flat.slice(0, n - 1) + "…" : flat;
}

/** Highest seq seen, so a reconnect resumes exactly where the stream left off. */
export function lastSeq(events: PortalEvent[]): number {
  return events.length ? events[events.length - 1].seq : 0;
}

export interface Activity {
  /** What the agent is doing, in the second person's words rather than pi's. */
  label: string;
  /** When this phase started, for the elapsed counter. */
  since?: number;
  /** Prefill, when llama.cpp is reporting it. */
  prefill?: { total: number; cache: number; processed: number };
  /** The model being loaded, while `label` is "loading the model". */
  model?: string;
}

/**
 * What is happening right now, read backwards from the end of the stream.
 *
 * "Working…" is true and useless: the wait that prompts the question is the one
 * before the first token, where a local server is processing the prompt and
 * nothing at all is emitted. The most recent event that means something is the
 * answer, so this stops at the first one it recognises rather than folding the
 * whole history.
 */
export function activity(events: PortalEvent[]): Activity {
  let prefill: Activity["prefill"];
  // Walking backwards, a `ready` is met before the `loading` it ends.
  let loaded = false;
  // Compaction can emit its own model events; retain its identity until it ends.
  const compact = [...events].reverse().find(ev => ['compaction_start', 'compaction_end', 'agent_end', 'portal_prompt'].includes(ev.type));
  if (compact?.type === 'compaction_start') {
    return { label: 'compacting the conversation', since: compact.at };
  }

  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    const p = (ev.payload ?? {}) as Record<string, any>;
    switch (ev.type) {
      // Kept and carried down: progress arrives interleaved with the empty
      // deltas that llama.cpp sends while it works, and the newest one wins.
      case "portal_prefill":
        if (!prefill) {
          prefill = { total: p.total ?? 0, cache: p.cache ?? 0, processed: p.processed ?? 0 };

        }
        break;

      // Before any prefill: once the prompt is being read, the model is up.
      case "portal_model":
        if (p.state === "ready") loaded = true;
        else if (p.state === "loading" && !loaded && !prefill) {
          return { label: "loading the model", since: ev.at, ...(typeof p.model === "string" && p.model ? { model: p.model } : {}) };
        }
        break;

      case "tool_execution_start":
        return { label: `running ${p.toolName ?? "a tool"}`, since: ev.at };

      case "tool_execution_end":
      case "message_end":
      case "turn_end":
      case "compaction_end":
        return { label: "thinking", since: ev.at };

      case "message_snapshot": {
        const blocks = Array.isArray(p.message?.content) ? p.message.content : [];
        const last = [...blocks].reverse().find((c: any) => c?.type === 'text' && c.text || c?.type === 'thinking' && c.thinking);
        if (last) return { label: last.type === 'thinking' ? 'thinking' : 'writing the reply', since: ev.at };
        break;
      }

      case "message_update":
        if (p.assistantMessageEvent?.delta) {
          return { label: p.assistantMessageEvent.type === 'thinking_delta' ? 'thinking' : 'writing the reply', since: ev.at };
        }
        break;
      case "message_start":
        if (p.message?.role === 'assistant') return { label: 'processing the prompt', since: ev.at, prefill };
        break;

      case "compaction_start":
        return { label: "compacting the conversation", since: ev.at };

      case "auto_retry_start":
        return { label: "retrying after an error", since: ev.at };

      // Nothing has come back yet, so the model is still reading the prompt.
      case "turn_start":
      case "agent_start":
        return { label: "processing the prompt", since: ev.at, prefill };
      // One sent into the run has not been read yet; the run goes on as it was.
      case "portal_prompt":
        if (p.queued === true) break;
        return { label: "processing the prompt", since: ev.at, prefill };
    }
  }
  return { label: "working" };
}
