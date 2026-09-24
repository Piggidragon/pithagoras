import { readFile, readdir, readlink, open } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * What the agent left running in a workspace: background shells, servers,
 * watchers, the jobs an extension started — whatever started them.
 *
 * Nothing here knows an extension. A process counts when the portal started
 * it (it carries MARKER in its environment, which survives it being detached
 * and reparented) and its working directory is in the workspace. Processes
 * are grouped by Unix session: pi starts each command in one of its own, so a
 * session is a job — `npm run dev &` and the node processes under it are one
 * entry. The person's own shells from the terminal panel are left out.
 *
 * Linux only, and only for the host executor: a container's processes are
 * not in this /proc with paths that mean anything here.
 */
export const MARKER = "PITHAGORAS_AGENT=1";

export interface BackgroundJob {
  /** Stable for the life of the job: the session id and when its leader started. */
  key: string;
  sid: number;
  pids: number[];
  command: string;
  startedAt: number;
  state: "running" | "stopped" | "exited";
  exitedAt?: number;
  /** Whether its output goes to a file that can be followed. */
  hasOutput: boolean;
  /** The portal's own child with its output on a pipe: a tool call the chat is showing. */
  attached: boolean;
}

interface Tracked extends BackgroundJob {
  workspace: string;
  output?: string;
}

const tracked = new Map<string, Tracked>();
/** How long a finished job stays listed. */
const KEEP_EXITED_MS = 30 * 60_000;

let bootMs: number | undefined;
function bootTime(): number {
  if (bootMs === undefined) {
    try {
      const line = readFileSync("/proc/stat", "utf8").split("\n").find((l) => l.startsWith("btime "));
      bootMs = Number(line?.split(/\s+/)[1] ?? 0) * 1000;
    } catch {
      bootMs = 0;
    }
  }
  return bootMs;
}
/** Clock ticks per second; 100 on every Linux the portal runs on. */
const HZ = 100;

const inside = (dir: string, root: string) => dir === root || dir.startsWith(root.endsWith("/") ? root : root + "/");

async function fileTarget(pid: number, fd: number): Promise<string | undefined> {
  try {
    const target = await readlink(`/proc/${pid}/fd/${fd}`);
    return target.startsWith("/") && !target.startsWith("/dev/") && !target.endsWith(" (deleted)") ? target : undefined;
  } catch {
    return undefined;
  }
}

interface Proc {
  pid: number;
  ppid: number;
  sid: number;
  state: string;
  start: number;
  argv: string[];
}

async function scan(workspace: string, excludeSids: Set<number>): Promise<Proc[]> {
  let names: string[];
  try {
    names = (await readdir("/proc")).filter((n) => /^\d+$/.test(n));
  } catch {
    return [];
  }
  const found: Proc[] = [];
  await Promise.all(
    names.map(async (name) => {
      const pid = Number(name);
      if (pid === process.pid) return;
      try {
        const cwd = await readlink(`/proc/${pid}/cwd`);
        if (!inside(cwd, workspace)) return;
        const env = await readFile(`/proc/${pid}/environ`, "latin1");
        if (!env.split("\0").includes(MARKER)) return;
        const stat = await readFile(`/proc/${pid}/stat`, "utf8");
        const f = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
        const sid = Number(f[3]);
        if (excludeSids.has(sid)) return;
        const argv = (await readFile(`/proc/${pid}/cmdline`, "utf8")).split("\0").filter(Boolean);
        found.push({ pid, ppid: Number(f[1]), sid, state: f[0], start: Number(f[19]), argv });
      } catch {
        // Gone meanwhile, or not ours to read.
      }
    }),
  );
  return found;
}

/** A shell's `-c` script rather than "bash -c …", which says nothing. */
function describe(argv: string[]): string {
  const at = argv.indexOf("-c");
  if (at >= 0 && at < argv.length - 1 && /(^|\/)(ba|z|da)?sh$/.test(argv[0] ?? "")) return argv[at + 1];
  return argv.join(" ");
}

/**
 * The jobs in a workspace, running and recently finished, newest first.
 * `excludeSids`: sessions that are the person's own shells.
 */
export async function listJobs(workspace: string, excludeSids: Set<number>): Promise<BackgroundJob[]> {
  const root = path.resolve(workspace);
  const procs = await scan(root, excludeSids);
  const groups = new Map<number, Proc[]>();
  for (const p of procs) {
    const list = groups.get(p.sid);
    if (list) list.push(p);
    else groups.set(p.sid, [p]);
  }

  const seen = new Set<string>();
  for (const [sid, members] of groups) {
    const leader = members.find((m) => m.pid === sid) ?? [...members].sort((a, b) => a.start - b.start)[0];
    const key = `${sid}-${leader.start}`;
    seen.add(key);
    const live = members.filter((m) => m.state !== "Z");
    const prior = tracked.get(key);
    let output = prior?.output;
    if (!output) {
      for (const m of [leader, ...members]) {
        output = (await fileTarget(m.pid, 1)) ?? (await fileTarget(m.pid, 2));
        if (output) break;
      }
    }
    const attached = leader.ppid === process.pid && !output;
    tracked.set(key, {
      key,
      sid,
      workspace: root,
      pids: live.map((m) => m.pid),
      command: describe(leader.argv),
      startedAt: bootTime() + (leader.start / HZ) * 1000,
      state: !live.length ? "exited" : live.every((m) => m.state === "T") ? "stopped" : "running",
      hasOutput: !!output,
      output,
      attached,
    });
  }

  const now = Date.now();
  for (const [key, job] of tracked) {
    if (job.workspace !== root || seen.has(key)) continue;
    if (job.state !== "exited") {
      job.state = "exited";
      job.exitedAt = now;
      job.pids = [];
    } else if (now - (job.exitedAt ?? now) > KEEP_EXITED_MS) tracked.delete(key);
  }

  return [...tracked.values()]
    .filter((j) => j.workspace === root)
    .sort((a, b) => b.startedAt - a.startedAt)
    .map(({ workspace: _w, output: _o, ...job }) => job);
}

/** The finished jobs are forgotten; the running ones stay. */
export function clearFinished(workspace: string): void {
  const root = path.resolve(workspace);
  for (const [key, job] of tracked) if (job.workspace === root && job.state === "exited") tracked.delete(key);
}

/** Output from `from` on, or the last `tail` bytes when `from` is not given. */
export async function readOutput(
  workspace: string,
  key: string,
  from?: number,
  tail = 200_000,
): Promise<{ text: string; from: number; size: number } | undefined> {
  const job = tracked.get(key);
  if (!job?.output || job.workspace !== path.resolve(workspace)) return undefined;
  const handle = await open(job.output, "r").catch(() => undefined);
  if (!handle) return { text: "", from: 0, size: 0 };
  try {
    const { size } = await handle.stat();
    const start = from === undefined ? Math.max(0, size - tail) : Math.min(Math.max(0, from), size);
    const length = Math.min(size - start, 1_000_000);
    const buf = Buffer.alloc(length);
    if (length) await handle.read(buf, 0, length, start);
    return { text: buf.toString("utf8"), from: start, size: start + length };
  } finally {
    await handle.close();
  }
}

/**
 * Stops a job: a hangup and a terminate to each of its processes, a kill for
 * whatever is still there a moment later. Only processes still marked as the
 * agent's and still in that session — a pid may have been given to something
 * else since the list was made.
 */
export async function stopJob(workspace: string, key: string, excludeSids: Set<number>): Promise<boolean> {
  const job = tracked.get(key);
  if (!job || job.workspace !== path.resolve(workspace) || job.state === "exited") return false;
  const current = (await scan(job.workspace, excludeSids)).filter((p) => p.sid === job.sid);
  if (!current.length) return false;
  for (const p of current) {
    try {
      process.kill(p.pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
  setTimeout(() => {
    for (const p of current) {
      try {
        const stat = readFileSync(`/proc/${p.pid}/stat`, "utf8");
        const f = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
        if (Number(f[3]) === job.sid && Number(f[19]) === p.start) process.kill(p.pid, "SIGKILL");
      } catch {
        // Gone, as asked.
      }
    }
  }, 3000).unref();
  return true;
}
