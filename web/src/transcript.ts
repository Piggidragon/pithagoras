import type { PortalEvent } from "./api";
import { extractLinks, omitDrawn, type ToolLink } from "./tool-links";

export type Item =
  | { kind: "user"; id: string; seq: number; text: string; audio?: boolean }
  | { kind: "assistant"; id: string; text: string; thinking: string; done: boolean; audio?: boolean }
  | {
      kind: "tool";
      id: string;
      name: string;
      status: "running" | "done" | "error";
      detail?: string;
      /** What the tool drew for itself, when it draws — see ToolRender. */
      render?: { collapsed: string[]; expanded?: string[] };
      /** What the tool actually returned, which is what the model was given. */
      output?: string;
      /** Where it says that came from — see tool-links. */
      links?: ToolLink[];
    }
  | { kind: "notice"; id: string; text: string; tone: "info" | "error" };

/**
 * How much of a tool's output is worth putting on a page.
 *
 * A read of a large file comes back whole, and the whole of it in the DOM is a
 * scroll bar nobody asked for. The model got all of it either way; this is only
 * what a person is shown.
 */
const MAX_OUTPUT = 20_000;

/**
 * The sources a tool's output names, worked out once per tool call.
 *
 * The transcript is rebuilt from the whole event list on every streamed
 * delta — tens of times a second while a reply is coming in. Reading the links
 * out of every tool result each time means a regex pass over every output in
 * the conversation per frame, on the thread that has to draw it. Nothing about
 * the answer can change once the tool has ended, so it is kept against the
 * event that produced it. Held weakly: the entry goes when the event does.
 */
const linkCache = new WeakMap<object, ToolLink[]>();

function toolLinks(
  event: object,
  output: string | undefined,
  render: { collapsed: string[]; expanded?: string[] } | undefined
): ToolLink[] {
  const seen = linkCache.get(event);
  if (seen) return seen;
  // Only the ones the tool did not already list itself: it knows which of them
  // it used, and saying it twice is saying it twice.
  const links = omitDrawn(
    extractLinks(output),
    [...(render?.collapsed ?? []), ...(render?.expanded ?? [])],
    output
  );
  linkCache.set(event, links);
  return links;
}

/**
 * What the tool handed back, as text.
 *
 * Two shapes, because pi has two: a content array like a message, and the
 * plain `output` string a tool may return instead. Anything that is not text —
 * an image — has nothing to put here.
 */
function toolOutput(p: any): string | undefined {
  const result = p?.result;
  if (!result) return undefined;
  const parts = Array.isArray(result.content)
    ? result.content
        .filter((c: any) => c?.type === "text" && typeof c.text === "string")
        .map((c: any) => c.text)
    : [];
  const text = (parts.length ? parts.join("\n") : String(result.output ?? "")).trim();
  if (!text) return undefined;
  return text.length > MAX_OUTPUT ? text.slice(0, MAX_OUTPUT) + "\n…" : text;
}

/**
 * A tool's own drawing of this step, when it ships one.
 *
 * Checked rather than trusted: it comes off the event stream, may have been
 * stored by an older build, and a malformed one must not take the transcript
 * with it.
 */
function toolRender(p: any): { collapsed: string[]; expanded?: string[] } | undefined {
  const render = p?.render;
  const strings = (v: unknown) =>
    Array.isArray(v) && v.every((line) => typeof line === "string") ? (v as string[]) : undefined;
  const collapsed = strings(render?.collapsed);
  if (!collapsed?.length) return undefined;
  const expanded = strings(render?.expanded);
  return expanded ? { collapsed, expanded } : { collapsed };
}

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
        closeCurrent();
        const raw = String(p.message ?? "");
        const tagged = raw.startsWith("[Audio mode]\n");
        audioReply = p.voice === true || tagged;
        items.push({ kind: "user", id: `u${ev.seq}`, seq: ev.seq, text: tagged ? raw.slice("[Audio mode]\n".length) : raw, audio: p.voice === true || tagged });
        break;
      }

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
          name: String(p.toolName ?? p.name ?? "tool"),
          status: "running",
          detail: summarizeToolInput(p),
          render: toolRender(p),
        });
        break;

      case "tool_execution_end": {
        // Close the most recent still-running tool of the same name.
        const name = String(p.toolName ?? p.name ?? "tool");
        for (let i = items.length - 1; i >= 0; i--) {
          const it = items[i];
          if (it.kind === "tool" && it.status === "running" && it.name === name) {
            it.status = p.isError || p.error ? "error" : "done";
            // What the tool drew for its result replaces what it drew for the
            // call: the call was a guess at what would happen, and this is it.
            const drawn = toolRender(p);
            if (drawn) it.render = drawn;
            it.output = toolOutput(p);
            const links = toolLinks(ev, it.output, it.render);
            if (links.length) it.links = links;
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

  // Anything still open belongs to a run in flight.
  return items;
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
      case "portal_prompt":
        return { label: "processing the prompt", since: ev.at, prefill };
    }
  }
  return { label: "working" };
}
