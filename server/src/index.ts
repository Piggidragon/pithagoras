import { fileURLToPath } from "node:url";

/**
 * The server's entry.
 *
 * pi runs inside this process, and an extension that starts another pi the way
 * pi's own examples do — this runtime and `process.argv[1]` — started this file
 * again: a second server, which failed on the port, and before that had marked
 * every chat the running one had going as interrupted. In pi, `argv[1]` is
 * pi's command line; here it is made so, before anything is loaded, whatever
 * the extension passes on. Nothing in the server reads it.
 */
process.argv[1] = fileURLToPath(new URL("./cli.js", import.meta.resolve("@earendil-works/pi-coding-agent")));
await import("./server.js");
