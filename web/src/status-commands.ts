/**
 * The commands an extension names in its status line, so they can be run
 * from it. A status such as "bg ⬆ v2.6.5 /bg-update" says what to type; the
 * portal can type it. Only names the chat really has count: a path like
 * /tmp in a status is text, not a command.
 */

export type StatusPart = { text: string } | { command: string };

export function statusParts(text: string, known: ReadonlySet<string>): StatusPart[] {
  const parts: StatusPart[] = [];
  let last = 0;
  for (const m of text.matchAll(/(^|\s)\/([\w:-]+)(?=\s|$|[.,;:!?)])/g)) {
    if (!known.has(m[2])) continue;
    const start = m.index! + m[1].length;
    if (start > last) parts.push({ text: text.slice(last, start) });
    parts.push({ command: m[2] });
    last = start + m[2].length + 1;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** Whether a status line names anything that looks like a command, worth asking the chat for its list. */
export const mentionsCommand = (text: string) => /(^|\s)\/[\w:-]+/.test(text);
