import { useMemo, useState } from "react";
import { LuChevronDown, LuChevronRight } from "react-icons/lu";
import { css, parseAnsi, readable, type AnsiSegment } from "../ansi";
import { useResolvedTheme } from "../theme";

/** What a tool drew for itself, as the portal received it. */
export interface ToolRenderData {
  collapsed: string[];
  expanded?: string[];
}

/**
 * The row a tool drew in place of the one the portal would have built.
 *
 * Shown as the tool laid it out — monospace, whitespace kept — because it was
 * laid out by something counting columns. What it says is the tool's business:
 * pi-web-access puts its search sources here, and nothing in this file knows
 * that or needs to.
 *
 * The open view is drawn on the server alongside the closed one, so opening it
 * is instant and still works on a conversation reopened long after the tool
 * that drew it was removed.
 */
export function ToolRender({ render }: { render: ToolRenderData }) {
  const [open, setOpen] = useState(false);
  const dark = useResolvedTheme() === "dark";
  const lines = open && render.expanded ? render.expanded : render.collapsed;
  const rows = useMemo(() => lines.map(parseAnsi), [lines]);
  if (!rows.length) return null;

  return (
    <div className="mt-1">
      <pre className="overflow-x-auto whitespace-pre rounded-lg bg-raised/40 px-3 py-2 font-mono text-[11px] leading-[1.5] text-fg-muted">
        {rows.map((segments, i) => (
          <div key={i}>
            {segments.length ? segments.map((s, j) => <Run key={j} segment={s} dark={dark} />) : " "}
          </div>
        ))}
      </pre>
      {render.expanded && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-1 inline-flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-fg-subtle transition hover:text-fg"
        >
          {open ? <LuChevronDown className="h-3 w-3" /> : <LuChevronRight className="h-3 w-3" />}
          {open ? "Less" : "More"}
        </button>
      )}
    </div>
  );
}

function Run({ segment, dark }: { segment: AnsiSegment; dark: boolean }) {
  const style = {
    color: segment.color ? css(readable(segment.color, dark)) : undefined,
    fontWeight: segment.bold ? 600 : undefined,
    fontStyle: segment.italic ? "italic" : undefined,
    textDecoration: segment.underline ? "underline" : undefined,
    // Dim is a terminal's way of saying "this matters less", and the page has
    // its own: the muted foreground this block already sits in.
    opacity: segment.dim ? 0.7 : undefined,
  };
  if (segment.href) {
    return (
      <a
        href={segment.href}
        target="_blank"
        rel="noreferrer noopener"
        style={style}
        className="underline decoration-dotted underline-offset-2 hover:decoration-solid"
      >
        {segment.text}
      </a>
    );
  }
  return <span style={style}>{segment.text}</span>;
}
