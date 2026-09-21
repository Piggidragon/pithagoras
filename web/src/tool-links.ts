/**
 * The places a tool says it got something from.
 *
 * A search hands the model prose with its sources woven in, and the row it
 * draws for itself summarises rather than lists them — so "where did this come
 * from" was answerable only by reading the whole output.
 *
 * The hard part is not finding links, it is not finding all of them. A tool
 * that fetches a page returns the page, and everything that page links to is a
 * link in the output without being a source of anything. So a link counts only
 * where the tool put it in the position of a citation: alone on its line, or
 * behind a word like "Source:". A link sitting inside a sentence is part of
 * what was fetched, not a claim about where it came from.
 *
 * Deliberately not about any one extension: every tool that cites gets the
 * list. pi-web-access alone writes them three ways — "### Title\nurl",
 * "1. Title\n   url" and "Source: Title (url)" — and matching any of them
 * exactly would be matching a version.
 */

export interface ToolLink {
  url: string;
  /** What to show: the host, without the www nobody reads. */
  domain: string;
  /** When the text made it clear. A bare URL has none, and says so by having none. */
  title?: string;
}

/** Enough to see where something came from; past this it is a directory, not a citation. */
const MAX_LINKS = 30;

/** A title is a label. Past this it is the prose the link was sitting in. */
const MAX_TITLE = 120;

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/g;

/** Words a tool puts in front of a link when it is naming a source. */
const CITED = /^(source|sources|url|link|from|see also|ref|reference)\b\s*[:\-–—]?\s*/i;

/**
 * Numbering, bullets and markdown headings a list format puts in front of a
 * title, and the quality tags one of them adds.
 */
const ORNAMENT = /^\s*(?:[#>*\-–—•]+\s*|\d+[.)]\s*|\[[^\]]{1,24}\]\s*)+/;

/**
 * Punctuation a URL collects from the text around it.
 *
 * A closing bracket only counts as punctuation when the URL has no opening one
 * of its own — Wikipedia's paths are full of them.
 */
function tidy(url: string): string {
  let out = url.replace(/[.,;:!?'"]+$/, "");
  while (/[)\]]$/.test(out)) {
    const open = out.slice(0, -1);
    const closer = out.slice(-1);
    const opener = closer === ")" ? "(" : "[";
    if (count(open, opener) > count(open, closer)) break;
    out = open.replace(/[.,;:!?'"]+$/, "");
  }
  return out;
}

const count = (text: string, char: string): number => text.split(char).length - 1;

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/[/?#].*$/, "");
  }
}

const strip = (line: string): string =>
  line.replace(ORNAMENT, "").replace(/\s*[:—–-]\s*$/, "").trim();

/** A label, not a paragraph, and not itself a link. */
const usable = (text: string): boolean =>
  text.length > 0 && text.length <= MAX_TITLE && !/https?:\/\//.test(text);

/**
 * Whether this line presents the link rather than merely containing it.
 *
 * Two shapes count. The line is the link, give or take the numbering or bullet
 * a list puts in front of it; or the line names it — "Source: Title (url)".
 * Anything else is a link inside text that was fetched, and listing those as
 * sources would turn one fetched page into forty citations it never made.
 */
function cites(line: string, url: string, urlsOnLine: number): boolean {
  const bare = strip(line.split(url).join("\u0000"));
  const [before, after = ""] = bare.split("\u0000");
  if (!before.trim() && !after.trim()) return true;
  if (urlsOnLine > 1) return false;
  const label = before.replace(/[([]\s*$/, "").trim();
  if (CITED.test(label)) return true;
  // "Title (url)" — the link is the line's subject, closing whatever the title
  // opened, with nothing following it.
  return !after.replace(/^[)\]]/, "").trim() && /[([]\s*$/.test(before);
}

export function extractLinks(text: string | undefined): ToolLink[] {
  if (!text) return [];
  const lines = text.split("\n");
  const found = new Map<string, ToolLink>();

  for (let index = 0; index < lines.length && found.size < MAX_LINKS; index++) {
    const line = lines[index];
    const matches = line.match(URL_PATTERN);
    if (!matches) continue;
    for (const raw of matches) {
      const url = tidy(raw);
      if (found.has(url) || !cites(line, raw, matches.length)) continue;
      const title = titleFor(lines, index, line, raw, matches.length);
      found.set(url, { url, domain: domainOf(url), ...(title ? { title } : {}) });
      if (found.size >= MAX_LINKS) break;
    }
  }

  return [...found.values()];
}

/**
 * Where a title comes from, in the order a human would look.
 *
 * What the line says around the link, and failing that the line above it —
 * which is where every list format puts it.
 */
function titleFor(
  lines: string[],
  index: number,
  line: string,
  url: string,
  urlsOnLine: number
): string | undefined {
  if (urlsOnLine === 1) {
    const rest = strip(
      line.split(url).join(" ").replace(/[()[\]]/g, " ").replace(/\s+/g, " ")
    ).replace(CITED, "");
    if (usable(rest)) return rest;
  }
  for (let i = index - 1; i >= 0 && i >= index - 2; i--) {
    const above = strip(lines[i]);
    if (!above) continue;
    return usable(above) ? above : undefined;
  }
  return undefined;
}

/**
 * A title short enough to appear by accident in unrelated prose.
 *
 * "Home" or "Docs" would match somewhere in almost any page, so below this
 * length only the URL itself counts as having been drawn already.
 */
const MIN_TITLE_MATCH = 12;

/** How much of a title to compare on: renderers truncate long ones with an ellipsis. */
const TITLE_PREFIX = 40;

const flatten = (text: string): string =>
  text
    // CSI and OSC — colour and links, which the drawing is full of.
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();

/**
 * Drop the sources the tool listed itself.
 *
 * A tool that lists its sources in its own row has said it better than this can
 * — it knows which of them it actually used — and saying it again underneath is
 * saying it twice. What it left out is still worth carrying, so this removes
 * links rather than the list: where a tool lists every source the row goes away
 * entirely, and where it lists none nothing changes.
 *
 * The trap is that a drawing is often an excerpt of the very output these were
 * read from. pi-web-access shows the first five hundred characters of the
 * result when it has nothing better, and a citation inside that excerpt is the
 * output quoted back, not the tool claiming anything. So a line only counts as
 * the tool's own when it is not in the output verbatim.
 */
export function omitDrawn(
  links: ToolLink[],
  drawn: string[] | undefined,
  output: string | undefined
): ToolLink[] {
  if (!drawn?.length) return links;
  const lines = drawn.map(flatten).filter((line) => line.trim());
  if (!lines.length) return links;
  const source = flatten(output ?? "");
  // A line the output already contains is the output being shown back, however
  // it got there. Only what the tool composed itself is a claim.
  const composed = lines.filter((line) => !source.includes(line.trim()));
  if (!composed.length) return links;

  return links.filter((link) => !composed.some((line) => mentions(line, link)));
}

function mentions(line: string, link: ToolLink): boolean {
  if (line.includes(link.url.toLowerCase())) return true;
  const title = link.title?.trim() ?? "";
  if (title.length < MIN_TITLE_MATCH) return false;
  return line.includes(flatten(title.slice(0, TITLE_PREFIX)));
}
