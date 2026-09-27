/**
 * The server's entry, and pi's when an extension starts pi through it.
 *
 * pi runs inside this process, so an extension that starts another pi the way
 * pi's own examples do — this runtime, `process.argv[1]` and pi's arguments —
 * starts this file again. Before, it came up as a second server on the same
 * port, and failed there only after it had marked every chat the running one
 * had going as interrupted.
 *
 * It is that pi when it was started from inside the server, which leaves this
 * mark in the environment of everything it starts, and was given arguments,
 * which the server never is. Either alone is not enough: the agent starts the
 * server from a chat to try it, and a server may one day be given an argument.
 */
const STARTED_BY_SERVER = "PITHAGORAS_SERVER";

if (process.env[STARTED_BY_SERVER] && process.argv.length > 2) {
  await import(new URL("./cli.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);
} else {
  process.env[STARTED_BY_SERVER] = "1";
  await import("./server.js");
}
