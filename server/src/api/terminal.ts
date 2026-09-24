import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readlinkSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import express, { type Router } from "express";
import { getSession } from "../db.js";

/**
 * A shell, in the portal.
 *
 * Over a real pty rather than plain pipes, because a shell without one lies
 * about being interactive: no prompt, no colours, no job control. `script` from
 * util-linux allocates one and is already in the image, which beats a native
 * dependency for a feature this small.
 *
 * Output goes out over SSE and input comes back as POSTs — the same shape as
 * the session event stream, and no websocket library to add.
 *
 * This is shell access to the container for anyone holding the portal
 * password. That is already true of every session — the agent has bash — so it
 * grants nothing new, but it is worth being clear that it is not a lesser
 * thing than the chat box beside it.
 */

const MAX_SCROLLBACK = 200_000;

/**
 * How long a shell is kept with nobody watching it.
 *
 * The panel closes its shell when it goes, but a tab that is closed or reloaded
 * never gets to say so, and each one used to leave a shell running for as long
 * as the portal did. Long enough to ride out a reload or a dropped connection.
 */
const UNWATCHED_MS = 5 * 60_000;

interface Term {
  id: string;
  proc: ChildProcess;
  /** Replayed to a client that connects late, so a reload keeps the screen. */
  buffer: string;
  listeners: Set<(chunk: string) => void>;
  exited: boolean;
  /** Set while nobody is attached; ends the shell if nobody comes back. */
  reaper?: NodeJS.Timeout;
}

const terms = new Map<string, Term>();

/**
 * Ends the shell, and whatever it started.
 *
 * Signalled directly rather than through `script`: util-linux 2.39 (Debian,
 * the LXC image) ignores a hangup, so every closed panel left its shell
 * running — and the test that closes one waited on it forever. The shell is in
 * a session of its own on the pty, jobs included, so a hangup to all of it is
 * what closing a real terminal does, and the shell is gone at once. What
 * ignores that, a `nohup` job, is killed a moment later — only what the
 * hangup found, and only if it is still there. Where the session cannot be
 * found, `script` is terminated and the rest left to the hangup.
 */
function end(term: Term): void {
  clearTimeout(term.reaper);
  if (!term.exited) {
    const session = sessionOf(term);
    const members = session ? signalSession(session, "SIGHUP") : Promise.resolve([]);
    term.proc.kill("SIGTERM");
    setTimeout(() => {
      if (!term.exited) term.proc.kill("SIGKILL");
      void members.then((pids) => {
        for (const pid of pids) {
          // Still in that session: a pid given to something else since is not.
          if (Number(statOf(pid)?.[3]) !== session) continue;
          try {
            process.kill(pid, "SIGKILL");
          } catch {
            // Gone in the meantime.
          }
        }
      });
    }, 2000).unref();
  }
  terms.delete(term.id);
}

/** The shell `script` started: the child that leads the session on the pty. */
function shellOf(term: Term): number | undefined {
  const pid = term.proc.pid;
  if (!pid) return undefined;
  try {
    const [child] = readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8").trim().split(/\s+/);
    return child ? Number(child) : undefined;
  } catch {
    return undefined;
  }
}

/** Fields of /proc/<pid>/stat after the command name, which may hold spaces. */
const fieldsOf = (stat: string): string[] => stat.slice(stat.lastIndexOf(")") + 2).split(" ");

function statOf(pid: string | number): string[] | undefined {
  try {
    return fieldsOf(readFileSync(`/proc/${pid}/stat`, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * The session the shell leads — the id stays after the shell itself is gone.
 * Never the portal's own: signalled, that would take the portal down with it.
 */
function sessionOf(term: Term): number | undefined {
  const shell = shellOf(term);
  const session = shell ? Number(statOf(shell)?.[3]) : NaN;
  return session > 0 && session !== Number(statOf(process.pid)?.[3]) ? session : undefined;
}

/**
 * Signals every process in a session, and says which they were.
 *
 * A walk of /proc — every process on the host — so it is read without holding
 * up the event loop: a busy host has thousands, and a closing panel is no
 * reason for every open stream to stall.
 */
async function signalSession(session: number, signal: NodeJS.Signals): Promise<number[]> {
  let pids: string[];
  try {
    pids = (await readdir("/proc")).filter((name) => /^\d+$/.test(name));
  } catch {
    return [];
  }
  const members: number[] = [];
  for (const pid of pids) {
    let stat: string;
    try {
      stat = await readFile(`/proc/${pid}/stat`, "utf8");
    } catch {
      continue;
    }
    if (Number(fieldsOf(stat)[3]) !== session) continue;
    try {
      process.kill(Number(pid), signal);
      members.push(Number(pid));
    } catch {
      // Gone already, or not ours to signal.
    }
  }
  return members;
}

function watchUnattended(term: Term): void {
  clearTimeout(term.reaper);
  if (term.listeners.size) return;
  term.reaper = setTimeout(() => end(term), UNWATCHED_MS);
  term.reaper.unref();
}

/**
 * The pty the shell is on: `script` holds the master, its child the other end.
 *
 * Linux only, through /proc, which is where the portal runs. Undefined anywhere
 * it cannot be found, and the caller falls back.
 */
function ptyOf(term: Term): string | undefined {
  const shell = shellOf(term);
  try {
    const tty = shell ? readlinkSync(`/proc/${shell}/fd/0`) : "";
    return tty.startsWith("/dev/pts/") ? tty : undefined;
  } catch {
    return undefined;
  }
}

function create(cwd: string): Term {
  const id = randomUUID().slice(0, 8);
  // -q quiet, -f flush on every write so output is not held back, -e return the
  // command's exit status, and /dev/null because we want the pty, not a log.
  const proc = spawn("script", ["-qfec", process.env.SHELL || "bash -il", "/dev/null"], {
    cwd,
    env: { ...process.env, TERM: "xterm-256color" },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const term: Term = { id, proc, buffer: "", listeners: new Set(), exited: false };
  // A folder that is gone, or no `script` on this machine. Unhandled, the
  // spawn failure is thrown from the process object and takes the portal down.
  proc.on("error", (e) => {
    term.exited = true;
    const text = `\r\nCould not start a shell: ${e.message}\r\n`;
    term.buffer += text;
    for (const l of term.listeners) l(text);
  });

  const push = (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    term.buffer = (term.buffer + text).slice(-MAX_SCROLLBACK);
    for (const l of term.listeners) l(text);
  };
  proc.stdout?.on("data", push);
  proc.stderr?.on("data", push);
  proc.on("exit", () => {
    term.exited = true;
    const text = "\r\n[session ended]\r\n";
    term.buffer += text;
    for (const l of term.listeners) l(text);
  });

  terms.set(id, term);
  watchUnattended(term);
  return term;
}

export function terminalRouter(): Router {
  const router = express.Router();

  /** Opens a shell, in the workspace of a session when one is named. */
  router.post("/terminal", (req, res) => {
    const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId : "";
    const cwd = (sessionId && getSession(sessionId)?.workspace) || process.env.HOME || "/";
    const term = create(cwd);
    res.json({ id: term.id, cwd });
  });

  router.get("/terminal/:id/stream", (req, res) => {
    const term = terms.get(req.params.id);
    if (!term) return res.status(404).end();

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const send = (chunk: string) => res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    // What is already on screen, so reconnecting does not show an empty shell.
    if (term.buffer) send(term.buffer);
    term.listeners.add(send);
    watchUnattended(term);
    // Without traffic a proxy takes an idle shell for a dead connection.
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 25_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      term.listeners.delete(send);
      watchUnattended(term);
    });
  });

  router.post("/terminal/:id/input", (req, res) => {
    const term = terms.get(req.params.id);
    if (!term || term.exited) return res.status(404).json({ error: "No such terminal" });
    if (typeof req.body?.data === "string") term.proc.stdin?.write(req.body.data);
    res.json({ ok: true });
  });

  /**
   * Tell the pty its new size.
   *
   * With stty from outside, on the shell's own tty: the kernel then tells
   * whatever is in front — the shell, vim, top — that the window changed.
   * Typing `stty` into the shell instead put the command on the screen and in
   * the history on every resize, and into whatever program had the keyboard.
   * That remains the fallback where the tty cannot be found.
   */
  router.post("/terminal/:id/resize", (req, res) => {
    const term = terms.get(req.params.id);
    const size = (v: unknown, fallback: number) => {
      const n = Math.round(Number(v));
      return Number.isFinite(n) && n >= 2 && n <= 1000 ? n : fallback;
    };
    const rows = size(req.body?.rows, 24);
    const cols = size(req.body?.cols, 80);
    if (!term || term.exited) return res.status(404).json({ error: "No such terminal" });
    const tty = ptyOf(term);
    if (tty) {
      execFile("stty", ["-F", tty, "rows", String(rows), "cols", String(cols)], () => {});
    } else {
      term.proc.stdin?.write(`stty rows ${rows} cols ${cols} 2>/dev/null\n`);
    }
    res.json({ ok: true });
  });

  router.delete("/terminal/:id", (req, res) => {
    const term = terms.get(req.params.id);
    if (term) end(term);
    res.json({ ok: true });
  });

  return router;
}
