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
let cleanup = false;
function cleanUp() {
  if (cleanup) return;
  cleanup = true;
  after(async () => {
    await Promise.all(started.map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill();
      await once(child, "exit");
    }));
    for (const home of homes) rmSync(home, { recursive: true, force: true });
  });
}

/** A new home: the server's data, sessions and pi's agent directory, all in one place. */
export function testHome(prefix) {
  cleanUp();
  const home = mkdtempSync(path.join(tmpdir(), prefix));
  homes.push(home);
  mkdirSync(path.join(home, "agent"), { recursive: true });
  mkdirSync(path.join(home, "agent-home"), { recursive: true });
  return home;
}

export const freePort = () => new Promise((resolve) => {
  const s = createServer().listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

/** What the server is started with: everything in `home`, no password, pi on the host. */
export const serverEnv = (home, port) => ({
  ...process.env,
  PORT: String(port), DATA_DIR: home, BIN_DIR: path.join(home, "bin"), SESSION_DIR: path.join(home, "sessions"), CHANNELS_DIR: path.join(home, "channels"),
  AGENT_HOME: path.join(home, "agent-home"), WORKSPACE_ROOT: path.join(home, "ws"), PI_CODING_AGENT_DIR: path.join(home, "agent"),
  PORTAL_PASSWORD: "", PORTAL_ALLOW_NO_PASSWORD: "1", EXECUTOR: "host", LLAMA_BASE_URL: "http://127.0.0.1:1",
});

/** Starts the server and waits until it answers. When it never does, the error carries what it printed. */
export async function startServer(env) {
  cleanUp();
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
