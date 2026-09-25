/**
 * The subagent protocol: how an extension that runs an agent of its own lets
 * the portal show it, and lets the person talk to it.
 *
 * Open and small on purpose — nothing here knows any extension. It rides on
 * pi's own event bus (`pi.events` inside an extension), so an extension needs
 * no dependency on the portal and does nothing different when it is not there.
 *
 * Extension → portal:
 *
 *   subagent:v1:start  { id, label, toolCallId?, input?: boolean, stop?: boolean, detail? }
 *   subagent:v1:event  { id, event }       one of the child's pi events, as
 *                                          `pi --mode json` or `--mode rpc` print them
 *   subagent:v1:end    { id, status: "done" | "error" | "stopped", error? }
 *
 * Portal → extension, only where `start` said it takes them:
 *
 *   subagent:v1:input  { id, text }        a message for the subagent (e.g. an RPC `steer`)
 *   subagent:v1:stop   { id }
 *
 * The child's events are drawn exactly like the main conversation's: text,
 * thinking, tool calls and their output.
 */
export const SUBAGENT_START = "subagent:v1:start";
export const SUBAGENT_EVENT = "subagent:v1:event";
export const SUBAGENT_END = "subagent:v1:end";
export const SUBAGENT_INPUT = "subagent:v1:input";
export const SUBAGENT_STOP = "subagent:v1:stop";

/** The events of a child worth drawing; anything else is not the portal's business. */
const KNOWN = new Set([
  "agent_start",
  "agent_end",
  "turn_start",
  "turn_end",
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "compaction_start",
  "compaction_end",
]);

/** Streamed a token at a time: delivered to whoever watches, never stored. */
const LIVE = new Set(["message_update", "tool_execution_update"]);

const OUTPUT_MAX = 50_000;

type Bus = { on(channel: string, handler: (data: unknown) => void): () => void };
type Emit = (event: Record<string, unknown>) => void;

const str = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;

/** A tool result's text, cut to its end; pictures and the rest left out. */
function trimResult(result: any): unknown {
  if (!result || typeof result !== "object") return result;
  const content = Array.isArray(result.content)
    ? result.content
        .filter((c: any) => c?.type === "text" && typeof c.text === "string")
        .map((c: any) => ({ type: "text", text: c.text.slice(-OUTPUT_MAX) }))
    : [];
  return { content };
}

/** Only what drawing it needs: a child's message_update carries its whole message each time. */
export function slimEvent(event: any): Record<string, unknown> | undefined {
  if (!event || typeof event !== "object" || !KNOWN.has(event.type)) return undefined;
  switch (event.type) {
    case "message_update": {
      const inner = event.assistantMessageEvent ?? {};
      if (typeof inner.delta !== "string" || !inner.delta) return undefined;
      return { type: event.type, assistantMessageEvent: { type: inner.type, delta: inner.delta } };
    }
    case "message_start":
    case "message_end": {
      const m = event.message ?? {};
      // A tool's result comes again as a message: trimmed as its end is, or a
      // log it read, or a screenshot, is stored and sent whole.
      if (m.role === "toolResult") return { type: event.type, message: { role: m.role, content: (trimResult(m) as { content: unknown[] }).content } };
      return { type: event.type, message: { role: m.role, content: Array.isArray(m.content) ? m.content : m.content ?? "" } };
    }
    case "tool_execution_start":
      return { type: event.type, toolCallId: event.toolCallId, toolName: event.toolName, args: event.args };
    case "tool_execution_update":
      return { type: event.type, toolCallId: event.toolCallId, toolName: event.toolName, partialResult: trimResult(event.partialResult) };
    case "tool_execution_end":
      return { type: event.type, toolCallId: event.toolCallId, toolName: event.toolName, isError: !!event.isError, result: trimResult(event.result) };
    case "compaction_end":
      return { type: event.type, aborted: event.aborted, errorMessage: event.errorMessage, result: { tokensBefore: event.result?.tokensBefore } };
    default:
      return { type: event.type };
  }
}

/**
 * Listens on the bus and hands the portal what an extension says about its
 * subagents, as session events: `portal_subagent` (stored) and
 * `portal_subagent_live` (streamed, not stored). Returns the unsubscribe.
 */
export function bridgeSubagents(bus: Bus, emit: Emit): () => void {
  const known = new Set<string>();
  // When each child's current message began and stopped thinking, epoch ms:
  // its tokens are never stored, so the times ride on its message_end.
  const thinking = new Map<string, { thinkingSince: number; thinkingUntil: number }>();
  const off = [
    bus.on(SUBAGENT_START, (data: any) => {
      const id = str(data?.id, 120);
      if (!id) return;
      known.add(id);
      emit({
        type: "portal_subagent",
        op: "start",
        id,
        label: str(data.label, 200) ?? "Subagent",
        ...(str(data.toolCallId, 200) ? { toolCallId: str(data.toolCallId, 200) } : {}),
        ...(str(data.detail, 500) ? { detail: str(data.detail, 500) } : {}),
        input: data.input === true,
        stop: data.stop === true,
      });
    }),
    bus.on(SUBAGENT_EVENT, (data: any) => {
      const id = str(data?.id, 120);
      if (!id || !known.has(id)) return;
      const event = slimEvent(data.event);
      if (!event) return;
      const inner = (event.assistantMessageEvent ?? {}) as { type?: unknown };
      if (event.type === "message_update" && inner.type === "thinking_delta") {
        const now = Date.now();
        thinking.set(id, { thinkingSince: thinking.get(id)?.thinkingSince ?? now, thinkingUntil: now });
      }
      if (event.type === "message_end") {
        Object.assign(event, thinking.get(id));
        thinking.delete(id);
      }
      emit({ type: LIVE.has(String(event.type)) ? "portal_subagent_live" : "portal_subagent", op: "event", id, event });
    }),
    bus.on(SUBAGENT_END, (data: any) => {
      const id = str(data?.id, 120);
      if (!id || !known.has(id)) return;
      known.delete(id);
      thinking.delete(id);
      const status = ["done", "error", "stopped"].includes(data.status) ? data.status : "done";
      emit({ type: "portal_subagent", op: "end", id, status, ...(str(data.error, 2000) ? { error: str(data.error, 2000) } : {}) });
    }),
  ];
  return () => off.forEach((f) => f());
}
