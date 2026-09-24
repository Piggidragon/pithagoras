/**
 * An extension's settings as the Settings page shows and stores them. pi
 * publishes no schema for them, so what a key means is read from its name and
 * what kind of value it is from the value already there.
 */

/** "llamaServerUrl" as a person would write it: "Llama server URL". */
export function humanKey(key: string): string {
  const words = key
    .replace(/[_.-]+/g, " ")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .map((w) => (/^(url|api|id|mcp|llm|tts|stt|http|https|json|ui|ai)$/i.test(w) ? w.toUpperCase() : w.toLowerCase()));
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** What was typed, as the kind of value that was there before it: a number stays a number. */
export function typed(before: unknown, text: string): unknown {
  const t = text.trim();
  if (t === "") return "";
  if (typeof before === "number" && Number.isFinite(Number(t))) return Number(t);
  if (typeof before === "boolean" && /^(true|false)$/i.test(t)) return t.toLowerCase() === "true";
  if (before !== null && typeof before === "object") {
    try { return JSON.parse(t); } catch { return t; }
  }
  return t;
}
