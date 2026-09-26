/**
 * What a tool was called with, in words rather than as the JSON the model
 * wrote.
 *
 * A call's header says what it acted on in a line: the command, the file, the
 * search. For the tools that have one of those, that is all it needs. For
 * everything else it said `{"queries":["…","…"]}`, braces and quotes and all,
 * where "Queries: …, …" says the same to someone reading. Opened, each
 * parameter is a label and its value, lists as lists, rather than one block of
 * JSON per parameter.
 *
 * server/src/tool-summary.ts says the same for a channel, and a test holds the
 * two to it.
 */

/** Parameters that are what a call acted on: said bare, without a label. */
const PRIMARY = ["command", "file_path", "path", "pattern", "query", "url"] as const;

export type Scalar = string | number | boolean;

export const isScalar = (v: unknown): v is Scalar => typeof v === "string" || typeof v === "number" || typeof v === "boolean";

/** "queries" → "Queries", "file_path" → "File path", "numResults" → "Num results". */
export function argLabel(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}

const flat = (s: string) => s.replace(/\s+/g, " ").trim();

/** A value as a few words for the header, or nothing when it has none worth a line. */
function inline(v: unknown): string | undefined {
  if (typeof v === "string") return flat(v) || undefined;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    if (!v.length) return undefined;
    if (v.every(isScalar)) return v.map((x) => flat(String(x))).filter(Boolean).join(", ") || undefined;
    return `${v.length} ${v.length === 1 ? "item" : "items"}`;
  }
  return undefined;
}

/**
 * A call's arguments in one line: what it acted on, bare, or else its short
 * parameters labelled — "Queries: pgvector vs qdrant, homelab vector db" —
 * cut to `max` characters.
 */
export function argsSummary(input: unknown, max = 160): string | undefined {
  if (input === undefined || input === null) return undefined;
  const cut = (s: string) => (s.length > max ? s.slice(0, max - 1) + "…" : s);
  if (typeof input !== "object") return cut(flat(String(input))) || undefined;
  if (Array.isArray(input)) return (inline(input) && cut(inline(input)!)) || undefined;
  const args = input as Record<string, unknown>;
  for (const key of PRIMARY) {
    const v = args[key];
    if (typeof v === "string" && flat(v)) return cut(flat(v));
  }
  const parts = Object.entries(args).flatMap(([key, v]) => {
    const said = inline(v);
    return said === undefined ? [] : [`${argLabel(key)}: ${said}`];
  });
  return parts.length ? cut(parts.join(" · ")) : undefined;
}

/** Text worth showing as code, or long enough to need its own lines. */
export const isBlock = (v: string) => v.includes("\n") || v.length > 80;
