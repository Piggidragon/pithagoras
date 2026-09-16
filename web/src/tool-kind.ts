export type ToolKind = "command" | "browser" | "search" | "read" | "edit" | "tool";

/** What a tool call is doing, in the broad strokes a listener cares about. */
export function toolKind(payload: Record<string, any> = {}): ToolKind {
  const input = payload.input ?? payload.args ?? payload.parameters ?? {};
  const name = String(payload.toolName ?? payload.name ?? "tool");
  if (/bash|terminal|shell|exec_command/.test(name)) return "command";
  if (/browser|navigate/.test(name) || /browser/.test(String(input.tool ?? ""))) return "browser";
  if (/search/.test(name)) return "search";
  if (/read/.test(name)) return "read";
  if (/write|edit|patch/.test(name)) return "edit";
  return "tool";
}
