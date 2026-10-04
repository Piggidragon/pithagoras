/** What is typed into a note of the memory while it is edited. */
export interface NoteDraft {
  title: string;
  type: string;
  description: string;
  tags: string;
  body: string;
}

/**
 * The edit each note was left with, for as long as the portal stays open. The
 * page does not ask before Back, Forward or a link to another page of the portal
 * takes it away from a note, so the note keeps the edit instead and brings it
 * back when it is opened again. Only a change is kept: a draft that is the note
 * as it is has nothing to bring back.
 */
const kept = new Map<string, NoteDraft>();

export const readNoteDraft = (path: string): NoteDraft | null => kept.get(path) ?? null;

/** Keeps the edit; `null` forgets it, as when it was saved, cancelled or given up on purpose. */
export function keepNoteDraft(path: string, draft: NoteDraft | null): void {
  if (draft) kept.set(path, draft);
  else kept.delete(path);
}

/** The whole memory was cleared: no note is left for an edit to belong to. */
export const forgetNoteDrafts = (): void => kept.clear();
