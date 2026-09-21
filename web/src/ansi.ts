/**
 * Terminal text, read for a page.
 *
 * A tool that draws its own row draws it for a terminal, because that is the
 * only surface pi has: colours as SGR escapes, links as OSC 8. The portal ships
 * those lines through untouched — see tool-render on the server — and this is
 * where they become something a browser can show.
 *
 * Colour is kept rather than stripped: it is how a search marks a domain apart
 * from a title, and an error apart from a note. But it was chosen against a
 * terminal's background, not this page's, so it is bent into a readable range
 * on the way — pi's dark theme uses a near-white for ordinary list text, which
 * on a white page is nothing at all.
 */

export interface AnsiSegment {
  text: string;
  color?: [number, number, number];
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** From OSC 8, which is how a terminal carries a link. */
  href?: string;
}

interface Style {
  color?: [number, number, number];
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  href?: string;
}

const BLANK: Style = { bold: false, dim: false, italic: false, underline: false };

/** CSI: colours and cursor moves. OSC: links and titles, which end in BEL or ST. */
const TOKEN = /\u001b\[([0-9;]*)m|\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\]([^\u0007\u001b]*)(?:\u0007|\u001b\\)|\u001b_[^\u0007]*\u0007/g;

/** One line of terminal output as the runs of text that differ in how they look. */
export function parseAnsi(line: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];
  let style: Style = { ...BLANK };
  let at = 0;

  const push = (text: string) => {
    if (!text) return;
    const last = segments[segments.length - 1];
    const next: AnsiSegment = { text, ...styleOf(style) };
    // Runs that look the same are one run: a line built escape by escape would
    // otherwise become a span per word.
    if (last && sameLook(last, next)) last.text += text;
    else segments.push(next);
  };

  TOKEN.lastIndex = 0;
  for (let match = TOKEN.exec(line); match; match = TOKEN.exec(line)) {
    push(line.slice(at, match.index));
    at = match.index + match[0].length;
    if (match[1] !== undefined) style = applySgr(style, match[1]);
    else if (match[2] !== undefined) style = applyOsc(style, match[2]);
    // Anything else — a cursor move, pi's cursor marker — has no meaning in a
    // page and leaves no text behind.
  }
  push(line.slice(at));
  return segments;
}

function styleOf(style: Style): Omit<AnsiSegment, "text"> {
  const out: Omit<AnsiSegment, "text"> = {};
  if (style.color) out.color = style.color;
  if (style.bold) out.bold = true;
  if (style.dim) out.dim = true;
  if (style.italic) out.italic = true;
  if (style.underline) out.underline = true;
  if (style.href) out.href = style.href;
  return out;
}

const sameLook = (a: AnsiSegment, b: AnsiSegment): boolean =>
  a.bold === b.bold &&
  a.dim === b.dim &&
  a.italic === b.italic &&
  a.underline === b.underline &&
  a.href === b.href &&
  String(a.color) === String(b.color);

function applyOsc(style: Style, body: string): Style {
  // OSC 8 ; params ; uri — an empty uri closes the link.
  const link = /^8;[^;]*;(.*)$/s.exec(body);
  if (!link) return style;
  const href = link[1].trim();
  // Only schemes a browser can follow and that cannot run anything.
  const safe = /^(https?:\/\/|mailto:)/i.test(href) ? href : undefined;
  return { ...style, href: safe };
}

function applySgr(style: Style, body: string): Style {
  const codes = (body === "" ? "0" : body).split(";").map((n) => Number(n) || 0);
  let next = { ...style };
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    if (code === 0) next = { ...BLANK, href: next.href };
    else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 22) next.bold = next.dim = false;
    else if (code === 23) next.italic = false;
    else if (code === 24) next.underline = false;
    else if (code >= 30 && code <= 37) next.color = PALETTE[code - 30];
    else if (code >= 90 && code <= 97) next.color = PALETTE[code - 90 + 8];
    else if (code === 39) next.color = undefined;
    else if (code === 38) {
      if (codes[i + 1] === 5) {
        next.color = PALETTE[codes[i + 2] & 0xff];
        i += 2;
      } else if (codes[i + 1] === 2) {
        next.color = [codes[i + 2] & 0xff, codes[i + 3] & 0xff, codes[i + 4] & 0xff];
        i += 4;
      }
    } else if (code === 48) {
      // A background this page does not paint. Consumed so its arguments are
      // not read back as foreground colours.
      i += codes[i + 1] === 5 ? 2 : codes[i + 1] === 2 ? 4 : 0;
    }
  }
  return next;
}

/** The xterm 256-colour palette: sixteen named, a 6×6×6 cube, then greys. */
function buildPalette(): [number, number, number][] {
  const base: [number, number, number][] = [
    [0, 0, 0], [205, 49, 49], [13, 188, 121], [229, 229, 16],
    [36, 114, 200], [188, 63, 188], [17, 168, 205], [229, 229, 229],
    [102, 102, 102], [241, 76, 76], [35, 209, 139], [245, 245, 67],
    [59, 142, 234], [214, 112, 214], [41, 184, 219], [255, 255, 255],
  ];
  const steps = [0, 95, 135, 175, 215, 255];
  for (let r = 0; r < 6; r++)
    for (let g = 0; g < 6; g++)
      for (let b = 0; b < 6; b++) base.push([steps[r], steps[g], steps[b]]);
  for (let i = 0; i < 24; i++) {
    const v = 8 + i * 10;
    base.push([v, v, v]);
  }
  return base;
}

export const PALETTE = buildPalette();

const luminance = ([r, g, b]: [number, number, number]): number =>
  (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

const mix = (
  c: [number, number, number],
  towards: number,
  amount: number
): [number, number, number] =>
  [
    Math.round(c[0] + (towards - c[0]) * amount),
    Math.round(c[1] + (towards - c[1]) * amount),
    Math.round(c[2] + (towards - c[2]) * amount),
  ];

/** Below this on a dark page, or above it on a light one, text stops being text. */
const FLOOR = 0.42;
const CEILING = 0.55;

/**
 * The same colour, bent until it can be read on this page.
 *
 * The hue is what carries the meaning — a red error, a blue heading — and it is
 * kept. Only the lightness moves, and only as far as it has to.
 */
export function readable(
  color: [number, number, number],
  dark: boolean
): [number, number, number] {
  let out = color;
  for (let i = 0; i < 8; i++) {
    const l = luminance(out);
    if (dark ? l >= FLOOR : l <= CEILING) break;
    out = mix(out, dark ? 255 : 0, 0.2);
  }
  return out;
}

export const css = ([r, g, b]: [number, number, number]): string => `rgb(${r} ${g} ${b})`;
