import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

/** Kept for as long as this server runs: collected or closed, it lets the next one in. */
let held: Database.Database | undefined;

/**
 * Makes this the one server on a data directory, or says it is not.
 *
 * A second server on the same data marks every chat the first has running as
 * interrupted when it starts, and nothing about the port stops that: one the
 * agent starts from a chat with another PORT reads the same database. So the
 * data itself is locked. SQLite's exclusive lock is held by the process, and
 * the system lets go of it when the process ends however it ends, so a crash
 * leaves nothing behind to clear. The transaction is never ended.
 */
export function holdDataDir(dir: string): boolean {
  mkdirSync(dir, { recursive: true });
  const lock = new Database(path.join(dir, "portal.lock"), { timeout: 0 });
  try {
    // The file holds nothing, so nothing to roll back: without this, the
    // transaction left a journal beside it every time the server stopped.
    lock.pragma("journal_mode = OFF");
    lock.exec("BEGIN EXCLUSIVE");
  } catch (e) {
    lock.close();
    if ((e as { code?: string }).code === "SQLITE_BUSY") return false;
    throw e;
  }
  held = lock;
  return true;
}
