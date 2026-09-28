import { useMemo } from "react";
import type { DiffFile } from "../../git-diff";
import { t } from "../../i18n";

const ROW: Record<string, string> = {
  add: "bg-ok/10",
  del: "bg-danger/10",
  hunk: "bg-accent/8 text-fg-subtle",
  note: "text-fg-faint italic",
  ctx: "",
};
const MARK: Record<string, string> = { add: "+", del: "−", ctx: " ", hunk: "", note: "" };

/**
 * One file's changes, line by line: where each line was, where it is, and
 * what it says. Long lines scroll sideways rather than wrap, so that the
 * indentation of code still reads as indentation.
 */
export function DiffView({ file, truncated }: { file: DiffFile; truncated?: boolean }) {
  // Wide enough for the largest line number either side.
  const width = useMemo(() => {
    let most = 0;
    for (const r of file.rows) most = Math.max(most, r.old ?? 0, r.new ?? 0);
    return `${String(most).length + 1.5}ch`;
  }, [file]);

  if (file.binary) return <p className="p-6 text-center text-xs text-fg-subtle">{t("A binary file — its changes are not shown here.")}</p>;
  if (!file.rows.length) {
    return (
      <p className="p-6 text-center text-xs text-fg-subtle">
        {file.status === "renamed" ? t("Renamed, with nothing in it changed.") : t("No changes in the text — only its mode, or nothing at all.")}
      </p>
    );
  }
  return (
    <div className="git-diff min-h-0 flex-1 overflow-auto font-mono text-[11.5px] leading-[1.55]" role="table" aria-label={`Changes to ${file.path}`}>
      <div className="min-w-max">
        {file.rows.map((row, i) =>
          row.kind === "hunk" ? (
            <div key={i} role="row" className={`sticky left-0 px-2 py-0.5 ${ROW.hunk}`}>
              {row.text}
            </div>
          ) : (
            <div key={i} role="row" data-kind={row.kind} className={`flex ${ROW[row.kind]}`}>
              <span className="shrink-0 select-none pl-1 pr-1 text-right text-fg-faint" style={{ width }}>
                {row.old ?? ""}
              </span>
              <span className="shrink-0 select-none pr-1 text-right text-fg-faint" style={{ width }}>
                {row.new ?? ""}
              </span>
              <span
                aria-hidden
                className={`min-w-4 shrink-0 select-none whitespace-pre px-0.5 text-center ${row.kind === "add" ? "text-ok" : row.kind === "del" ? "text-danger" : "text-fg-faint"}`}
              >
                {row.mark ?? MARK[row.kind]}
              </span>
              <span className="whitespace-pre pr-4 text-fg">{row.text || " "}</span>
            </div>
          ),
        )}
      </div>
      {truncated && <p className="px-3 py-2 text-xs text-warn">{t("This diff is too large to show whole — it stops here.")}</p>}
    </div>
  );
}
