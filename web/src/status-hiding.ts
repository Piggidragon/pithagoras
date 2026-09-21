const KEY = "hiddenStatuses";

/**
 * Status lines the reader has silenced.
 *
 * `setStatus` is a footer in the terminal pi was written for: ambient furniture
 * you stop seeing. A page has no footer, so it lands as a line of text above
 * the composer — and a line of text in a chat looks like somebody saying
 * something. `pi-lens` sets "LSP Inactive" once and leaves it there for the
 * life of the session, which reads as an announcement and is not one.
 *
 * So any of them can be switched off, by the key the extension gave it rather
 * than by its words, which change. Remembered for this browser: it is a
 * preference about reading, not a setting about the agent.
 */
export function hiddenStatuses(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((k) => typeof k === "string") : [];
  } catch {
    return [];
  }
}

export function hideStatus(key: string): string[] {
  const next = [...new Set([...hiddenStatuses(), key])].sort();
  store(next);
  return next;
}

export function showAllStatuses(): string[] {
  store([]);
  return [];
}

function store(keys: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(keys));
  } catch {
    // A browser that will not remember still hides them for this page.
  }
}
