import { useState } from "react";
import { LuChevronDown, LuChevronRight } from "react-icons/lu";
import type { ToolLink } from "../tool-links";

/** Enough faces to recognise where something came from, before the list is opened. */
const PREVIEW = 6;

/**
 * Where a tool says it got something from.
 *
 * Shut, it is a count and a row of faces — the question "did it read anything
 * real" answered without opening anything. Open, it is the list, each one a
 * link.
 *
 * The icons are each site's own favicon, asked for directly. No third-party
 * icon service: that would tell someone else every domain the agent read, and
 * the point of running this yourself is that nobody is told. A site without one
 * gets its initial instead, which is also what a site gets while its icon is
 * still arriving.
 */
export function ToolSources({ links }: { links: ToolLink[] }) {
  const [open, setOpen] = useState(false);
  if (!links.length) return null;

  return (
    <div className="mt-0.5 text-[11px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded px-1 py-0.5 text-fg-subtle transition hover:text-fg"
      >
        {open ? <LuChevronDown className="h-3 w-3" /> : <LuChevronRight className="h-3 w-3" />}
        <span>
          {links.length} {links.length === 1 ? "source" : "sources"}
        </span>
        {!open && (
          <span className="flex items-center gap-0.5">
            {links.slice(0, PREVIEW).map((link) => (
              <Favicon key={link.url} domain={link.domain} />
            ))}
            {links.length > PREVIEW && (
              <span className="ml-0.5 text-fg-faint">+{links.length - PREVIEW}</span>
            )}
          </span>
        )}
      </button>

      {open && (
        <ul className="mt-1 space-y-0.5 border-l border-line pl-2">
          {links.map((link) => (
            <li key={link.url} className="flex items-baseline gap-1.5">
              <span className="translate-y-0.5">
                <Favicon domain={link.domain} />
              </span>
              <a
                href={link.url}
                target="_blank"
                rel="noreferrer noopener"
                title={link.url}
                className="min-w-0 truncate text-fg-muted underline decoration-dotted underline-offset-2 hover:decoration-solid"
              >
                {link.title || link.url}
              </a>
              <span className="shrink-0 text-fg-faint">{link.domain}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Favicon({ domain }: { domain: string }) {
  const [failed, setFailed] = useState(false);
  if (failed || !domain.includes(".")) {
    return (
      <span
        aria-hidden
        className="inline-grid h-3.5 w-3.5 place-items-center rounded-sm bg-fg/10 text-[8px] uppercase text-fg-faint"
      >
        {domain.slice(0, 1)}
      </span>
    );
  }
  return (
    <img
      src={`https://${domain}/favicon.ico`}
      alt=""
      width={14}
      height={14}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="h-3.5 w-3.5 rounded-sm object-contain"
    />
  );
}
