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
   * `queued`: sent into a run, and not taken in by pi yet. `unsent`: the run was
   * stopped first, so it never reached pi.
   */
  | { kind: "user"; id: string; seq: number; text: string; audio?: boolean; images?: SentImage[]; queued?: boolean; unsent?: boolean }
  | { kind: "assistant"; id: string; text: string; thinking: string; done: boolean; audio?: boolean }
  | { kind: "tool"; id: string; name: string; callId?: string; status: "running" | "done" | "error"; detail?: string; picture?: ShownPicture }
  | { kind: "notice"; id: string; text: string; tone: "info" | "error" };

/**
 * Fold pi's event stream into renderable turns.
 *
 * Deliberately tolerant: pi emits more event types than we render, and shapes
 * vary by version. Anything unrecognised is skipped rather than breaking the
 * transcript — a task that ran fine shouldn't look broken because of one
 * unexpected field.
 */
export function buildTranscript(events: PortalEvent[]): Item[] {
  const items: Item[] = [];
  let audioReply = false;
  let current: Extract<Item, { kind: "assistant" }> | null = null;
  // Sent mid-run and not yet taken in. Put where pi took it in — where the
  // agent read it — rather than where it was sent, which is the middle of a
  // reply it had nothing to do with.
  const waiting = new Map<number, Extract<Item, { kind: "user" }>>();

  const closeCurrent = () => {
    if (current) {
      current.done = true;
      current = null;
    }
  };

  for (const ev of events) {
    const p = ev.payload ?? {};
    switch (ev.type) {
      case "portal_prompt": {
        const raw = String(p.message ?? "");
        const tagged = raw.startsWith("[Audio mode]\n");
        const images = sentImages(p.images);
        const item: Extract<Item, { kind: "user" }> = {
          kind: "user",
          id: `u${ev.seq}`,
          seq: ev.seq,
          text: tagged ? raw.slice("[Audio mode]\n".length) : raw,
          audio: p.voice === true || tagged,
          ...(images ? { images } : {}),
        };
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
        const item = waiting.get(Number(p.seq));
        if (!item) break;
        waiting.delete(item.seq);
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
          const item = waiting.get(Number(seq));
          if (!item) continue;
          waiting.delete(item.seq);
          closeCurrent();
          items.push({ ...item, unsent: true });
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
        if (inner.type === "thinking_delta") current.thinking += delta;
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
          current.thinking = thinking;
        }
        if (ev.type === "message_end") closeCurrent();
        break;
      }

      case "tool_execution_start":
        closeCurrent();
        items.push({
          kind: "tool",
          id: `t${ev.seq}`,
          callId: typeof p.toolCallId === "string" ? p.toolCallId : undefined,
          name: String(p.toolName ?? p.name ?? "tool"),
          status: "running",
          detail: summarizeToolInput(p),
        });
        break;

      case "tool_execution_end": {
        // Close the most recent still-running tool of the same name.
        const name = String(p.toolName ?? p.name ?? "tool");
        for (let i = items.length - 1; i >= 0; i--) {
          const it = items[i];
          if (it.kind === "tool" && it.status === "running" &&
              (p.toolCallId ? it.callId === p.toolCallId : it.name === name)) {
            it.status = p.isError || p.error ? "error" : "done";
            const picture = shownPicture(p);
            if (picture) it.picture = picture;
            break;
          }
        }
        break;
      }

      // Output from a builtin like /session or /compact — pi never saw it.
      case "portal_notice":
        items.push({
          kind: "notice",
          id: `n${ev.seq}`,
          text: String(p.text ?? ""),
          tone: p.error ? "error" : "info",
        });
        break;

      case "portal_status":
        if (p.status === "error" && p.error) {
          items.push({ kind: "notice", id: `n${ev.seq}`, text: String(p.error), tone: "error" });
        }
        if (p.status === "idle" && p.aborted) {
          items.push({ kind: "notice", id: `n${ev.seq}`, text: "Aborted", tone: "info" });
        }
        break;

      case "agent_end":
        closeCurrent();
        break;

      default:
        break;
    }
  }

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
