import { session, type SafeStorage } from "./safe-storage";

const PREFIX = "pithagoras.draft.";

/**
 * What has been typed into each chat's message box and not yet sent.
 *
 * The box is one component for every chat, so without this whatever was half
 * written in one followed you into the next — and could be sent there. Held in
 * memory, and mirrored to session storage so that a reload does not lose it
 * either; a browser that will not store it still keeps drafts while the page
 * is open.
 */
export function createDrafts(store: SafeStorage = session) {
  const memory = new Map<string, string>();
  return {
    get(id: string): string {
      return memory.get(id) ?? store.get(PREFIX + id) ?? "";
    },
    set(id: string, text: string): void {
      if (text) {
        memory.set(id, text);
        store.set(PREFIX + id, text);
      } else {
        memory.delete(id);
        store.remove(PREFIX + id);
      }
    },
  };
}

export const drafts = createDrafts();

/**
 * A message that did not go, back in front of whatever has been typed since.
 *
 * Put back rather than lost; and put before rather than over, so nothing typed
 * while it was on its way is thrown away either.
 */
export function withUnsent(current: string, unsent: string): string {
  return current.trim() ? `${unsent}\n${current}` : unsent;
}
