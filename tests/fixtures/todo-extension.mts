/**
 * A todo-list extension as pi loads one, made up for the tests of the screen
 * protocol: a `todo` tool that keeps its list in the tool results' `details`,
 * which is how a list follows a conversation that branches, and a stand-in for
 * pi to run it in. The glue that puts its list on a screen is the skill's own
 * template (skills/extension-screens/templates/glue.mts), as it is shipped.
 *
 * The extension knows nothing of the portal, and the glue nothing of the page.
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
  async function record(toolName: string, details: unknown) {
    branch.push({ type: "message", message: { role: "toolResult", toolName, details } });
    await fire("tool_result", { toolName, details });
  }
  return {
    api: {
      events,
      on: (name: string, handler: Handler) => void handlers.set(name, [...(handlers.get(name) ?? []), handler]),
      registerTool: (tool: { name: string; execute(id: string, params: any): Promise<any>; [more: string]: unknown }) => void tools.set(tool.name, tool),
    },
    /** The chat starts, or is opened again: what the conversation holds is there to read. */
    start: (reason = "startup") => fire("session_start", { reason }),
    /** The agent calls a tool: its result is in the conversation from then on, and extensions hear of it. */
    async call(name: string, params: unknown) {
      const result = await tools.get(name)!.execute("call", params);
      await record(name, result.details);
      return result;
    },
    /** A tool's result as it was, whichever tool made it. */
    result: record,
    /** The conversation moves to another branch. */
    tree: () => fire("session_tree", {}),
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
      if (entry.type !== "message" || message?.role !== "toolResult" || message.toolName !== "todo" || !Array.isArray(message.details?.todos)) continue;
      todos = message.details.todos;
      nextId = message.details.nextId;
    }
  };
  pi.on("session_start", rebuild);
  pi.on("session_tree", rebuild);
  pi.registerTool({
    name: "todo",
    label: "Todo",
    description: "Keep a todo list: add a task, start it, complete it, or clear the list.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add", "start", "complete", "clear"] },
        text: { type: "string" },
        id: { type: "number" },
        after: { type: "number" },
      },
      required: ["action"],
    },
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
