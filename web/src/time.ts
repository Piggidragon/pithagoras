/** "5m ago", from the timestamps the server writes (UTC, with or without a zone marker). */
export const when = (iso: string): string => {
  const then = new Date(iso + (iso.endsWith("Z") ? "" : "Z")).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (!Number.isFinite(mins)) return iso;
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};
