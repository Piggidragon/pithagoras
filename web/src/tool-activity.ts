import { insideFolder } from "./file-activity";

/**
 * What a tool call is, in words, for the cards that fly out of the orb in voice mode.
 *
 * "Using grep" says nothing to somebody who is not reading code; "Searching for
 * ‘retry’ — 12 matches" does. So a call is described from its arguments when it
 * starts, and given its outcome when it ends: how many lines an edit changed,
 * how many files a search found, the first line of what went wrong. And each
 * card knows where the thing it is about can be seen, so that tapping it
 * opens that: the file, the terminal, the browser, the document, the picture.
 *
 * Tolerant like the transcript: pi's payloads vary by tool and version, and
 * anything unrecognised is described by its name rather than not at all.
 */

export type ToolTarget = "terminal" | "files" | "browser" | "canvas" | "pictures";

export interface ToolCall {
  label: string;
  detail: string;
  /** Where tapping the card goes. */
  target?: ToolTarget;
  /** For `files`: the file, inside the chat's folder. */
  path?: string;
}

const text = (v: unknown) => (typeof v === "string" ? v : "");
const flat = (s: string, n = 90) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
};
const base = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const hostOf = (url: string) => {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
};

const nameOf = (p: any) => String(p?.toolName ?? p?.name ?? "tool");
const inputOf = (p: any): Record<string, any> => {
  const input = p?.input ?? p?.args ?? p?.parameters;
  return input && typeof input === "object" ? input : {};
};

/** The call as the agent made it, unwrapped from the MCP adapter's single `mcp` tool when it came through that. */
function unwrap(p: any): { name: string; input: Record<string, any> } {
  const name = nameOf(p), input = inputOf(p);
  if (name === "mcp" && typeof input.tool === "string") return { name: input.tool, input: input.args && typeof input.args === "object" ? input.args : {} };
  return { name, input };
}

function browser(action: string, input: Record<string, any>): ToolCall {
  const url = text(input.url);
  if (/navigate|open|goto/.test(action)) return { label: "Opening a page", detail: url ? hostOf(url) : "", target: "browser" };
  if (/screenshot/.test(action)) return { label: "Taking a screenshot", detail: "", target: "browser" };
  if (/click|hover|drag/.test(action)) return { label: "Clicking in the browser", detail: text(input.element), target: "browser" };
  if (/type|fill|press|select/.test(action)) return { label: "Typing in the browser", detail: text(input.element), target: "browser" };
  if (/snapshot|evaluate|console|network/.test(action)) return { label: "Reading the page", detail: "", target: "browser" };
  if (/tab|close|back|forward|resize|wait/.test(action)) return { label: "Using the browser", detail: "", target: "browser" };
  return { label: "Using the browser", detail: url ? hostOf(url) : "", target: "browser" };
}

/** A call as it starts. `folder` is the chat's, for which paths can be opened in Files. */
export function describeCall(payload: any, folder: string): ToolCall {
  const { name, input } = unwrap(payload);
  const path = text(input.path ?? input.file_path);
  const inside = path ? insideFolder(folder, path) : undefined;
  const file = (label: string): ToolCall => ({
    label: `${label} ${path ? base(path) : "a file"}`,
    detail: inside && inside !== base(path) ? inside : "",
    ...(inside ? { target: "files" as const, path: inside } : {}),
  });

  if (/^(bash|terminal|shell|exec_command)$/.test(name)) {
    return { label: "Running a command", detail: flat(text(input.description) || text(input.command) || text(input.cmd)), target: "terminal" };
  }
  if (name === "read") {
    const call = file("Reading");
    const from = Number(input.offset), count = Number(input.limit);
    if (Number.isInteger(from) && from > 0) call.detail = [call.detail, count > 0 ? `lines ${from}–${from + count - 1}` : `from line ${from}`].filter(Boolean).join(" · ");
    return call;
  }
  if (name === "write") return file("Writing");
  if (name === "edit") return file("Editing");
  if (name === "grep") return { label: `Searching for “${flat(text(input.pattern), 40)}”`, detail: flat([text(input.path), text(input.glob)].filter(Boolean).join(" · ")) };
  if (name === "find") return { label: `Looking for “${flat(text(input.pattern), 40)}”`, detail: flat(text(input.path)) };
  if (name === "ls") return { label: `Listing ${path ? base(path) : "the folder"}`, detail: "" };
  if (name === "show_image") return { label: "Showing a picture", detail: flat(text(input.title) || text(input.path)), target: "pictures" };
  if (name.startsWith("canvas_")) {
    const verb: Record<string, string> = { canvas_create: "Starting a document", canvas_write: "Writing in a document", canvas_read: "Reading a document", canvas_list: "Looking at the documents", canvas_delete: "Deleting a document" };
    return { label: verb[name] ?? "Using a document", detail: flat(text(input.title)), target: "canvas" };
  }
  if (/^browser[_.]/.test(name)) return browser(name.replace(/^browser[_.]/, ""), input);
  if (typeof input.tool === "string" && /browser/.test(input.tool)) return browser(input.tool, input);
  if (/web_?search|search_web/.test(name)) return { label: "Searching the web", detail: flat(text(input.query)) };
  if (/fetch|scrape|read_url|web_read/.test(name) && text(input.url)) return { label: "Opening a page", detail: hostOf(text(input.url)) };
  if (/search/.test(name)) return { label: "Searching", detail: flat(text(input.query) || text(input.pattern)) };
  const detail = [input.description, input.query, input.url, input.path, input.command].find((v) => typeof v === "string") as string | undefined;
  return { label: `Using ${name.replace(/[_.]+/g, " ")}`, detail: flat(detail ?? "") };
}

/** What a tool said back, as text. */
export function resultText(payload: any): string {
  const content = payload?.result?.content;
  if (Array.isArray(content)) return content.filter((c: any) => c?.type === "text").map((c: any) => text(c.text)).join("\n");
  return text(payload?.result) || text(payload?.error);
}

const lines = (s: string) => s.split("\n").filter((l) => l.trim() && !/^\[.*\]$/.test(l.trim()));

/**
 * What came of a call, in a few words, or nothing when there is nothing worth
 * adding to the tick. `start` is the call's own start payload, for what the
 * end does not repeat (a write's content).
 */
export function describeOutcome(start: any, end: any): string {
  const { name, input } = unwrap(start ?? end);
  const said = resultText(end);
  if (end?.isError) return flat(said.split("\n").find((l) => l.trim()) ?? "", 110);
  if (name === "edit") {
    const diff = text(end?.result?.details?.diff);
    if (!diff) return "";
    const added = diff.split("\n").filter((l) => /^\+\s*\d/.test(l)).length;
    const removed = diff.split("\n").filter((l) => /^-\s*\d/.test(l)).length;
    return `+${added} −${removed}`;
  }
  if (name === "write") {
    const content = text(input.content);
    return content ? plural(content.split("\n").length - (content.endsWith("\n") ? 1 : 0), "line") : "";
  }
  if (name === "grep") {
    if (/^no matches/i.test(said.trim())) return "No matches";
    const n = lines(said).length;
    return n ? `${plural(n, "match", "matches")}${end?.result?.details?.matchLimitReached ? "+" : ""}` : "";
  }
  if (name === "find") {
    if (/^no files/i.test(said.trim())) return "Nothing found";
    const n = lines(said).length;
    return n ? `${plural(n, "file")}${end?.result?.details?.resultLimitReached ? "+" : ""}` : "";
  }
  if (name === "ls") {
    const n = lines(said).length;
    return n ? plural(n, "entry", "entries") : "";
  }
  return "";
}

/** "12 s", "2 min 5 s": how long something has been going. */
export function elapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ""}`;
}
