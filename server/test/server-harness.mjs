import { after } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The whole server, started as it is deployed, for the tests that need it:
 * each in a home of its own, stopped and removed when the file's tests end.
 */
export const ENTRY = fileURLToPath(new URL("../dist/index.js", import.meta.url));

const started = [];
const homes = [];
// On the root of whichever test file imports this.
after(async () => {
  await Promise.all(started.map(async (child) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill();
    await once(child, "exit");
  }));
});
// The homes go when the process ends, not in a hook: a test that loads the server's modules
// closes its database in a hook of its own, which may run after any hook here.
process.on("exit", () => {
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

/** A new folder in the system's temp directory, removed when the process ends: for what a test needs to put things in. */
export function scratch(prefix) {
  const folder = mkdtempSync(path.join(tmpdir(), prefix));
  homes.push(folder);
  return folder;
}

/** A new home: the server's data, sessions and pi's agent directory, all in one place. */
export function testHome(prefix) {
  const home = scratch(prefix);
  mkdirSync(path.join(home, "agent"), { recursive: true });
  mkdirSync(path.join(home, "agent-home"), { recursive: true });
  return home;
}

export const freePort = () => new Promise((resolve) => {
  const s = createServer().listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

/**
 * Every folder the server reads and writes, set to a place in `home`: none of them is left to its default.
 * And git is kept from looking above the temp folder for a repository: where that folder lies inside one, a
 * command pi runs in a chat folder would otherwise be run in it, with the developer's credentials. Nor does it
 * read the developer's own config, which may sign every commit.
 */
const homeEnv = (home) => ({
  GIT_CEILING_DIRECTORIES: path.dirname(home),
  // A config of its own, empty: not the developer's, whose signing or hooks would run in a test that commits.
  GIT_CONFIG_GLOBAL: path.join(home, ".gitconfig"), GIT_CONFIG_NOSYSTEM: "1",
  DATA_DIR: home, BIN_DIR: path.join(home, "bin"), SESSION_DIR: path.join(home, "sessions"), CHANNELS_DIR: path.join(home, "channels"),
  AGENT_HOME: path.join(home, "agent-home"), WORKSPACE_ROOT: path.join(home, "ws"), PI_CODING_AGENT_DIR: path.join(home, "agent"),
});

/**
 * A home for a test that loads the server's modules into its own process, as
 * `testHome` is for one that starts the server: this process's environment
 * points every folder into it, so nothing reaches the developer's own pi
 * settings or a portal's data, and it is removed when the file's tests end.
 * Call it before the modules are imported (they read the environment as they
 * load), and `await import(...)` them after it.
 */
export function inProcessHome(prefix) {
  const home = testHome(prefix);
  Object.assign(process.env, homeEnv(home));
  mkdirSync(process.env.WORKSPACE_ROOT, { recursive: true });
  return home;
}

/**
 * What the server is started with: everything in `home`, no password, pi on the
 * host. `overrides` change any of it, a test of the login giving it a password.
 */
export const serverEnv = (home, port, overrides = {}) => ({
  ...process.env,
  PORT: String(port), ...homeEnv(home),
  PORTAL_PASSWORD: "", PORTAL_ALLOW_NO_PASSWORD: "1", EXECUTOR: "host", LLAMA_BASE_URL: "http://127.0.0.1:1",
  ...overrides,
});

/**
 * Runs `args` with this runtime to its end, with what it printed. One that is
 * still going after `ms` is stopped, and has code null: a test that meant it
 * to fail at once fails, rather than waiting for ever.
 */
export function runToEnd(args, env, { cwd, ms = 60_000 } = {}) {
  const child = spawn(process.execPath, args, { env, cwd, stdio: ["ignore", "pipe", "pipe"] });
  started.push(child);
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { err += d; });
  const timer = setTimeout(() => child.kill(), ms);
  // "close", not "exit": by then everything it printed has been read.
  return new Promise((resolve) => child.on("close", (code) => { clearTimeout(timer); resolve({ code, out, err }); }));
}

/** Starts the server and waits until it answers. When it never does, the error carries what it printed. */
export async function startServer(env) {
  const base = `http://127.0.0.1:${env.PORT}`;
  const child = spawn(process.execPath, [ENTRY], { env, stdio: ["ignore", "pipe", "pipe"] });
  started.push(child);
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${base}/api/auth/status`)).ok) break;
    } catch { /* not up yet */ }
    if (i > 200 || child.exitCode !== null) throw new Error(`the server did not start:\n${log}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  return { child, base };
}
