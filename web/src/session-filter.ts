/** Chats whose name or folder contains what was typed, in any case; all of them when nothing was. */
export function filterSessions<S extends { title: string; workspace: string }>(
  sessions: readonly S[],
  query: string,
): S[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...sessions];
  return sessions.filter((s) => `${s.title} ${s.workspace}`.toLowerCase().includes(q));
}
