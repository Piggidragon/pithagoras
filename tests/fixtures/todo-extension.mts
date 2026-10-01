/**
 * A todo-list extension as pi loads one, made up for the tests of the screen
 * protocol: a `todo` tool that keeps its list in the tool results' `details`
 * (which is how a list follows a conversation that branches), and the glue that
 * puts that list on a screen — what the skill `extension-screens` has the agent
 * write for a real one.
 *
 * The extension knows nothing of the portal. The glue knows nothing of the page:
 * it says its data in blocks over the event bus, as any other would.
 */

export interface Todo {
  id: number;
  text: string;
  status: "pending" | "in_progress" | "completed";
  /** Another todo's id that has to be completed first. */
  after?: number;
}

type Handler = (event: any, ctx: any) => unknown;

/** Just enough of pi's ExtensionAPI, and of a conversation, for the two to run in. */
export function fakePi(events: { on(c: string, f: (d: any) => void): () => void; emit(c: string, d: unknown): void }) {
  const handlers = new Map<string, Handler[]>();
  const tools = new Map<string, { execute(id: string, params: any): Promise<any> }>();
  const branch: unknown[] = [];
  const ctx = { sessionManager: { getBranch: () => branch } };
  const fire = async (name: string, event: unknown) => {
    for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
  };
  return {
    api: {
      events,
      on: (name: string, handler: Handler) => void handlers.set(name, [...(handlers.get(name) ?? []), handler]),
      registerTool: (tool: { name: string; execute(id: string, params: any): Promise<any> }) => void tools.set(tool.name, tool),
    },
    /** The chat starts, or is opened again: what the conversation holds is there to read. */
    start: (reason = "startup") => fire("session_start", { reason }),
    /** The agent calls a tool: its result is in the conversation from then on, and extensions hear of it. */
    async call(name: string, params: unknown) {
      const result = await tools.get(name)!.execute("call", params);
      branch.push({ type: "message", message: { role: "toolResult", toolName: name, details: result.details } });
      await fire("tool_result", { toolName: name, details: result.details });
      return result;
    },
    shutdown: () => fire("session_shutdown", {}),
  };
}

/** The extension: one tool, the list kept in its results. */
export function todoExtension(pi: ReturnType<typeof fakePi>["api"]) {
  let todos: Todo[] = [];
  let nextId = 1;
  const rebuild = (_event: unknown, ctx: any) => {
    todos = [];
    nextId = 1;
    for (const entry of ctx.sessionManager.getBranch()) {
      const message = entry.message;
      if (entry.type !== "message" || message?.role !== "toolResult" || message.toolName !== "todo") continue;
      todos = message.details.todos;
      nextId = message.details.nextId;
    }
  };
  pi.on("session_start", rebuild);
  pi.registerTool({
    name: "todo",
    async execute(_id, params: { action: "add" | "start" | "complete" | "clear"; text?: string; id?: number; after?: number }) {
      if (params.action === "add") todos.push({ id: nextId++, text: params.text ?? "", status: "pending", ...(params.after ? { after: params.after } : {}) });
      if (params.action === "start" || params.action === "complete") {
        const todo = todos.find((t) => t.id === params.id);
        if (todo) todo.status = params.action === "start" ? "in_progress" : "completed";
      }
      if (params.action === "clear") todos = [];
      return { content: [{ type: "text", text: `${todos.length} todos` }], details: { todos: todos.map((t) => ({ ...t })), nextId } };
    },
  });
}

/**
 * The glue: reads the extension's data — its results' details, as it does
 * itself — and says it in blocks. Written against what the extension keeps and
 * nothing else; one that does not find it says no screen rather than a wrong one.
 */
export function todoGlue(pi: ReturnType<typeof fakePi>["api"]) {
  const show = (todos: Todo[] | undefined) => {
    if (!todos) return pi.events.emit("screen:v1:clear", { id: "todo" });
    const done = todos.filter((t) => t.status === "completed").length;
    const open = (t: Todo) => t.status !== "completed";
    pi.events.emit("screen:v1:set", {
      id: "todo",
      title: "Todos",
      blocks: [
        { type: "status", label: "Done", text: `${done} of ${todos.length}`, tone: todos.length > 0 && done === todos.length ? "ok" : undefined },
        {
          type: "checklist",
          empty: "Nothing to do yet.",
          items: todos.map((t) => ({
            text: t.text,
            state: t.status === "completed" ? "done" : t.status === "in_progress" ? "doing" : t.after && open(todos.find((o) => o.id === t.after) ?? t) ? "blocked" : "todo",
            ...(t.after ? { detail: `after #${t.after}` } : {}),
          })),
        },
      ],
    });
  };
  pi.on("tool_result", (event) => {
    if (event.toolName === "todo") show(event.details?.todos);
  });
  pi.on("session_start", (_event, ctx) => {
    let latest: Todo[] | undefined;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "message" && entry.message?.role === "toolResult" && entry.message.toolName === "todo") latest = entry.message.details?.todos;
    }
    show(latest);
  });
  pi.on("session_shutdown", () => pi.events.emit("screen:v1:clear", { id: "todo" }));
}
