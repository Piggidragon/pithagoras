/**
 * Glue: puts what a pi extension keeps on a screen, in the portal's Screens
 * panel. This one reads a made-up todo tool, which keeps its list in the
 * `details` of its tool results; yours reads what your extension keeps.
 *
 * Written against: <package and version of the extension>. If an update changes
 * the data this reads, run /screen again.
 *
 * Copy to ${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/extensions/screen-<slug>/index.ts
 * (<slug>: a short name of your own, with no scope or "/" in it) and change the
 * three places marked CHANGE. Nothing else here is specific to an extension.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// CHANGE 1: the extension's tool that carries the data, and what the screen is called.
const TOOL = "todo";
const SCREEN = { id: "todo", title: "Todos" };

// CHANGE 2: the data as the extension keeps it, said as blocks (reference/blocks.md).
// Anything that is not the shape you expect: undefined. No screen is better than a wrong one.
function blocksFrom(details: any) {
  if (!Array.isArray(details?.todos)) return undefined;
  const todos: { id: number; text: string; status: string; after?: number }[] = details.todos;
  const done = todos.filter((t) => t.status === "completed").length;
  return [
    { type: "status", label: "Done", text: `${done} of ${todos.length}`, tone: todos.length > 0 && done === todos.length ? "ok" : undefined },
    {
      type: "checklist",
      empty: "Nothing to do yet.",
      items: todos.map((t) => ({
        text: t.text,
        state: t.status === "completed" ? "done" : t.status === "in_progress" ? "doing" : todos.some((o) => o.id === t.after && o.status !== "completed") ? "blocked" : "todo",
        ...(t.after ? { detail: `after #${t.after}` } : {}),
      })),
    },
  ];
}

export default function (pi: ExtensionAPI) {
  const set = (blocks: unknown[]) => pi.events.emit("screen:v1:set", { ...SCREEN, blocks });
  const clear = () => pi.events.emit("screen:v1:clear", { id: SCREEN.id });
  // A glue that throws would take its handler's place in every turn: whatever goes wrong is no screen.
  const read = (details: unknown) => {
    try {
      return blocksFrom(details);
    } catch {
      return undefined;
    }
  };

  // CHANGE 3: where the data is read back from when a chat starts, is opened again or
  // changes branch. This one takes the newest result of the tool that has the data in
  // it, so a failed call does not take the screen away; an extension that keeps its
  // state in custom entries (`pi.appendEntry`) reads those.
  const rebuild = (_event: unknown, ctx: any) => {
    let latest: unknown[] | undefined;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "message" && entry.message?.role === "toolResult" && entry.message.toolName === TOOL) latest = read(entry.message.details) ?? latest;
    }
    if (latest) set(latest);
    else clear();
  };
  pi.on("session_start", rebuild);
  pi.on("session_tree", rebuild);

  // As it changes. A result that is not the data (a failed call) leaves the screen as it was.
  pi.on("tool_result", (event) => {
    if (event.toolName !== TOOL) return;
    const blocks = read(event.details);
    if (blocks) set(blocks);
  });

  // Not for ever: the screen is of this chat's pi, which is going.
  pi.on("session_shutdown", clear);
}
