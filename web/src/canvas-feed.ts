/**
 * A chat's canvases as they change, passed from the chat's event stream to
 * the canvas panel.
 *
 * They had a stream of their own, and two per open chat is how three tabs used
 * up the six connections a browser allows one address: a fourth chat, and
 * every request its page made, waited for one of them to close. Now the
 * stream the app opens for the chat in the address carries them as well.
 */
export type CanvasMessage = { type: string; [key: string]: unknown };

type Watcher = { message: (m: CanvasMessage) => void; connected: (on: boolean) => void };

const watchers = new Map<string, Set<Watcher>>();
const connections = new Map<string, boolean>();

/** Hear a chat's canvases change, and whether they are being heard at all. */
export function watchCanvases(sessionId: string, watcher: Watcher): () => void {
  let set = watchers.get(sessionId);
  if (!set) watchers.set(sessionId, (set = new Set()));
  set.add(watcher);
  watcher.connected(connections.get(sessionId) ?? false);
  return () => {
    set.delete(watcher);
    if (!set.size) watchers.delete(sessionId);
  };
}

/** A change to one of a chat's canvases, or on connecting all of them. */
export function canvasMessage(sessionId: string, message: CanvasMessage): void {
  for (const w of watchers.get(sessionId) ?? []) w.message(message);
}

/** Whether the chat's stream is up, so the panel knows to ask for the list itself when it is not. */
export function canvasConnection(sessionId: string, on: boolean): void {
  if (!on) connections.delete(sessionId);
  else connections.set(sessionId, true);
  for (const w of watchers.get(sessionId) ?? []) w.connected(on);
}
