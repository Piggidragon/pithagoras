import test from "node:test";
import assert from "node:assert/strict";
import { mentionsCommand, statusParts } from "../web/src/status-commands.ts";

test("a command named in an extension's status can be run from it, and nothing else", () => {
  const known = new Set(["bg-update", "reload"]);
  assert.deepEqual(statusParts("bg ⬆ v2.6.5 /bg-update", known), [{ text: "bg ⬆ v2.6.5 " }, { command: "bg-update" }]);
  assert.deepEqual(statusParts("/reload, then /bg-update.", known), [{ command: "reload" }, { text: ", then " }, { command: "bg-update" }, { text: "." }]);
  assert.deepEqual(statusParts("logs in /tmp/x and /nope", known), [{ text: "logs in /tmp/x and /nope" }]);
  assert.deepEqual(statusParts("a/bg-update", known), [{ text: "a/bg-update" }], "only a word of its own");
  assert.equal(mentionsCommand("bg ⬆ v2.6.5 /bg-update"), true);
  assert.equal(mentionsCommand("3 running"), false);
});
