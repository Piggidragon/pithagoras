/**
 * The server's entry, and pi's when an extension starts pi through it.
 *
 * pi runs inside this process, so an extension that starts another pi the way
 * pi's own examples do — this runtime, `process.argv[1]` and pi's arguments —
 * starts this file again. The server is never given arguments; with some, this
 * is that pi, and it runs as pi's command line would. Before, it came up as a
 * second server on the same port, and failed there only after it had marked
 * every chat the running one had going as interrupted.
 */
if (process.argv.length > 2) {
  await import(new URL("./cli.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);
} else {
  await import("./server.js");
}
