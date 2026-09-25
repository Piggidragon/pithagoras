import test from "node:test";
import assert from "node:assert/strict";
import { mentionsCommand, statusParts } from "../web/src/status-commands.ts";

test("a command named in an extension's status can be run from it, and nothing else", () => {
  const known = new Set(["bg-update", "reload"]);
  assert.deepEqual(statusParts("bg ⬆ v2.6.5 /bg-update", known), [{ text: "bg ⬆ v2.6.5 " }, { command: "bg-update" }]);
  assert.deepEqual(statusParts("/reload, then /bg-update.", known), [{ command: "reload" }, { text: ", then " }, { command: "bg-update" }, { text: "." }]);
  assert.deepEqual(statusParts("logs in /tmp/x and /nope", known), [{ text: "logs in /tmp/x and /nope" }]);
  assert.deepEqual(statusParts("a/bg-update", known), [{ text: "a/bg-update" }], "only a word of its own");
  // Named as people name commands: before a colon or a dash, in brackets or quotes.
  assert.deepEqual(statusParts("run /bg-update: now", known), [{ text: "run " }, { command: "bg-update" }, { text: ": now" }]);
  assert.deepEqual(statusParts("(/bg-update)", known), [{ text: "(" }, { command: "bg-update" }, { text: ")" }]);
  assert.deepEqual(statusParts('try "/reload"', known), [{ text: 'try "' }, { command: "reload" }, { text: '"' }]);
  assert.deepEqual(statusParts("try /bg-update-", known), [{ text: "try " }, { command: "bg-update" }, { text: "-" }]);
  assert.equal(mentionsCommand("bg ⬆ v2.6.5 /bg-update"), true);
  assert.equal(mentionsCommand("(/bg-update)"), true);
  assert.equal(mentionsCommand("3 running"), false);
});

import { buildTranscript } from "../web/src/transcript.ts";

test("each command sent is a line in the chat that says how it went", () => {
  let seq = 0;
  const ev = (type: string, payload: any = {}) => ({ seq: ++seq, type, at: 0, payload });
  const items = buildTranscript([
    ev("portal_command", { text: "/bg-clear" }),
    ev("portal_command_end", { of: 1, outcome: "handled", quiet: true }),
    ev("portal_command", { text: "/bg-update" }),
    ev("portal_notice", { text: "2.6.5 is out", from: "extension" }),
    ev("portal_command_end", { of: 3, outcome: "handled" }),
    ev("portal_command", { text: "/skill:x" }),
    ev("portal_command_end", { of: 6, outcome: "started" }),
    ev("portal_command", { text: "/broken" }),
    ev("portal_notice", { text: "/broken failed: boom", error: true, from: "extension", of: 8 }),
    ev("portal_command_end", { of: 8, error: "boom" }),
    ev("message_end", { message: { role: "custom", customType: "r", content: [{ type: "text", text: "All green" }], display: true } }),
    ev("message_end", { message: { role: "custom", customType: "hidden", content: "for the model", display: false } }),
    // Not said to be for display: for the model, as pi's TUI takes it.
    ev("message_end", { message: { role: "custom", customType: "ctx", content: "context for the model" } }),
    ev("portal_command", { text: "/lost" }),
    ev("portal_status", { status: "idle" }),
  ]);
  assert.deepEqual(
    items.map((i) => (i.kind === "command" ? `${i.text}:${i.state}${i.error ? `:${i.error}` : ""}` : i.kind === "notice" ? `notice:${i.text}` : i.kind)),
    ["/bg-clear:quiet", "/bg-update:done", "notice:2.6.5 is out", "/skill:x:started", "/broken:failed:boom", "notice:All green", "/lost:done"],
  );
});
