import { nanoid } from "nanoid";
import { createSession, findRoutineSession, getDb, type SessionRow } from "../db.js";
import { agentHome } from "../agent.js";
import { checkWorkspace } from "../workspaces.js";
import { sessions, EXECUTOR_KIND } from "../session-manager.js";
import { isDue, nextRun, parseCron } from "./cron.js";
import { reportFraming, reportToFor } from "../pi/report-tool.js";

/**
 * Runs routines when they are due.
 *
 * A routine is a standing instruction and a schedule: when it fires the agent
 * is given the instruction, does the work, and goes quiet again. Nothing is
 * waiting on the other end the way a chat is, so a run is allowed to take as
 * long as it takes and its outcome is recorded rather than replied to.
 */

export interface RoutineRow {
  id: string;
  slug: string;
  name: string;
  enabled: number;
  schedule: string;
  /** An ISO instant, for a routine that runs once instead of repeating. */
  run_at: string | null;
  instructions: string;
  fresh_session: number;
  /** 0 turns off the injection guard's blocking rules for this routine's runs. */
  guard: number;
  /** 1 lets this routine's runs drive the agent's browser. */
  browser: number;
  /** Where its runs happen: null for Home, else a project's directory. */
  workspace: string | null;
  /**
   * Where this routine's reports go. null inherits the portal default; the
   * empty string means it never reports, whatever the default is.
   */
  report_channel: string | null;
  report_target: string | null;
  last_report_at: string | null;
  last_run: string | null;
  last_status: string | null;
  last_output: string | null;
  last_ms: number | null;
  next_run: string | null;
  created_at: string;
  updated_at: string;
}

/** How long a single run may take before it is abandoned. */
const RUN_TIMEOUT_MS = 60 * 60_000;

/** Enough of the outcome to see what happened without storing a transcript. */
const MAX_OUTPUT = 4000;

const TICK_MS = 20_000;

class RoutineSupervisor {
  /** Routines with a run in flight — a slow one must not stack on itself. */
  private running = new Set<string>();
  /**
   * Routines that may not start a run, and by how many holds: the folder they
   * run in is being deleted. Counted, so that one delete finishing does not
   * lift the hold of another still under way.
   */
  private held = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;

  private rows(): RoutineRow[] {
    return getDb().prepare("SELECT * FROM routines").all() as RoutineRow[];
  }

  start(): void {
    if (this.timer) return;
    this.refreshSchedules();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Recompute when each routine fires next. Cheap, and keeps the UI honest. */
  refreshSchedules(): void {
    for (const row of this.rows()) {
      getDb().prepare("UPDATE routines SET next_run = ? WHERE id = ?").run(whenNext(row), row.id);
    }
  }

  /**
   * Keeps these routines from starting a run, by schedule or by hand, until the
   * returned release is called: their folder is being deleted, and a run begun
   * meanwhile would have it removed from under it.
   */
  hold(slugs: string[]): () => void {
    for (const slug of slugs) this.held.set(slug, (this.held.get(slug) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const slug of slugs) {
        const left = (this.held.get(slug) ?? 1) - 1;
        if (left > 0) this.held.set(slug, left);
        else this.held.delete(slug);
      }
    };
  }

  isRunning(slug: string): boolean {
    return this.running.has(slug);
  }

  private async tick(): Promise<void> {
    const now = new Date();
    for (const row of this.rows()) {
      if (!row.enabled || this.running.has(row.slug) || this.held.has(row.slug)) continue;

      if (isOneOff(row)) {
        // Deliberately catches up: a one-off whose moment passed while the
        // server was down should still happen, unlike a recurring one which
        // simply waits for its next slot.
        // Not `> now`: a time that cannot be read compares false to anything,
        // and would run on every tick. Such a one never fires, like a bad cron.
        if (oneOffDone(row) || !(new Date(row.run_at!) <= now)) continue;
        void this.run(row, "schedule");
        continue;
      }

      let cron;
      try {
        cron = parseCron(row.schedule);
      } catch {
        continue;
      }
      if (!isDue(cron, now, row.last_run ? new Date(row.last_run) : null)) continue;
      void this.run(row, "schedule");
    }
  }

  /**
   * Run one routine.
   *
   * Not awaited by the tick: a routine that takes twenty minutes must not hold
   * up every other one, and the next tick skips it because it is still marked
   * as running.
   */
  async run(row: RoutineRow, trigger: "schedule" | "manual"): Promise<RoutineRow> {
    if (this.running.has(row.slug)) throw new Error(`"${row.name}" is already running`);
    if (this.held.has(row.slug)) throw new Error(`"${row.name}" cannot run while the folder it runs in is being deleted`);
    this.running.add(row.slug);

    const started = Date.now();
    const lastRun = new Date(started).toISOString();
    // Written before the work, so a crash mid-run cannot make it fire again
    // the moment the server comes back.
    getDb()
      .prepare("UPDATE routines SET last_run = ?, last_status = 'running' WHERE id = ?")
      .run(lastRun, row.id);

    try {
      const session = this.sessionFor(row);
      const output = await sessions.ask(session.id, prompt(row, trigger), {
        timeoutMs: RUN_TIMEOUT_MS,
      });
      this.finish(row.id, "ok", output, Date.now() - started);
    } catch (e) {
      this.finish(row.id, "error", (e as Error).message, Date.now() - started);
    } finally {
      this.running.delete(row.slug);
      // A one-off has nothing left to do. Disabled rather than deleted, so the
      // result stays readable and it can be re-armed by giving it a new time.
      // Not one run by hand ahead of its moment: that was a try, and the
      // moment it was set for is still to come.
      if (oneOffDone({ ...row, last_run: lastRun })) {
        getDb().prepare("UPDATE routines SET enabled = 0 WHERE id = ?").run(row.id);
      }
      this.refreshSchedules();
    }

    return getDb().prepare("SELECT * FROM routines WHERE id = ?").get(row.id) as RoutineRow;
  }

  private finish(id: string, status: string, output: string, ms: number): void {
    getDb()
      .prepare("UPDATE routines SET last_status = ?, last_output = ?, last_ms = ? WHERE id = ?")
      .run(status, (output ?? "").slice(0, MAX_OUTPUT), ms, id);
  }

  /**
   * The session a run happens in.
   *
   * By default a routine keeps one, so a run can see what the last one did —
   * "nothing new since yesterday" needs yesterday. `fresh_session` gives each
   * run a clean one instead, for work where history is only noise.
   */
  private sessionFor(row: RoutineRow): SessionRow {
    // Its project, or Home. One that has gone is a failed run, said as such:
    // falling back to Home would do the work somewhere it was never meant for.
    const where = row.workspace ? checkWorkspace(row.workspace) : { path: agentHome() };
    if ("error" in where) {
      throw new Error(`Its project ${row.workspace} cannot be used (${where.error}). Choose where it runs in the routine.`);
    }
    if (!row.fresh_session) {
      const existing = findRoutineSession(row.slug, where.path);
      if (existing) return existing;
    }

    const id = nanoid(12);
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    createSession({
      id,
      title: row.fresh_session ? `${row.name} — ${stamp}` : row.name,
      workspace: where.path,
      executor: EXECUTOR_KIND,
      kind: "routine",
      routine_slug: row.slug,
    });
    const created = getDb().prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow;
    return created;
  }
}

/**
 * What the agent is actually asked.
 *
 * The instruction is given verbatim, with a line of context around it: an agent
 * that does not know it was woken by a schedule tends to answer as if somebody
 * is waiting, and asks a follow-up question nobody will ever read.
 */
function prompt(row: RoutineRow, trigger: "schedule" | "manual"): string {
  const how =
    trigger === "manual"
      ? "run by hand"
      : isOneOff(row)
        ? "at the time it was scheduled for"
        : `on its schedule (${row.schedule})`;
  const reporting = reportFraming(reportToFor(row.slug));
  return [
    `<routine name="${row.name}" trigger="${how}">`,
    "This is a scheduled task. Nobody is waiting on a reply — do the work, then",
    "finish with a short account of what you did and anything that needs a human.",
    "Do not ask questions; there is nobody to answer them.",
    ...(reporting ? ["", reporting] : []),
    "</routine>",
    "",
    row.instructions.trim(),
  ].join("\n");
}

/** A routine with a moment rather than a pattern. */
export const isOneOff = (row: { run_at: string | null; schedule: string }) =>
  Boolean(row.run_at) && !row.schedule.trim();

/**
 * A one-off that has had its run: one at or after the moment it was set for.
 * A run before it — by hand, to try it out — does not count. If that moment
 * cannot be read there is no "before" to tell apart, and any run is its run.
 */
export const oneOffDone = (row: { run_at: string | null; schedule: string; last_run: string | null }) => {
  if (!isOneOff(row) || !row.last_run) return false;
  const at = new Date(row.run_at!).getTime();
  return Number.isNaN(at) || new Date(row.last_run).getTime() >= at;
};

/** When it fires next, or null if it never will again. */
export function whenNext(row: RoutineRow): string | null {
  if (!row.enabled) return null;
  if (isOneOff(row)) return oneOffDone(row) ? null : row.run_at;
  try {
    return nextRun(parseCron(row.schedule))?.toISOString() ?? null;
  } catch {
    // An unparseable schedule is reported by the API on save; here it simply
    // never fires.
    return null;
  }
}

export const routineSupervisor = new RoutineSupervisor();
