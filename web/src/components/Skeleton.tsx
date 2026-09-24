/**
 * A list's rows, while the list is fetched: the page keeps its shape, and
 * what arrives lands where the rows stood instead of below a line of text.
 */
export function RowsSkeleton({ rows = 4, label = "Loading…" }: { rows?: number; label?: string }) {
  return (
    <div role="status" className="skeleton-group mt-4 space-y-2">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl border border-line px-3 py-3" style={{ opacity: 1 - i * 0.18 }}>
          <div className="skeleton h-8 w-8 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="skeleton h-3" style={{ width: `${62 - ((i * 17) % 30)}%` }} />
            <div className="skeleton h-2.5" style={{ width: `${38 - ((i * 11) % 18)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
