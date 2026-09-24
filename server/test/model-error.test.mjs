import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const home = mkdtempSync(path.join(tmpdir(), "pithagoras-model-error-"));
process.env.DATA_DIR = home;
process.env.WORKSPACE_ROOT = path.join(home, "ws");
process.env.PI_CODING_AGENT_DIR = path.join(home, "agent");
mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });

const { createSession, eventsSince } = await import("../dist/db.js");
const { sessions } = await import("../dist/session-manager.js");

test("a failed model call reaches the transcript as an error notice", () => {
  const id = "err-busy";
  createSession({ id, title: "busy model", workspace: home, executor: "host" });
  // The shape pi closes a turn in when the provider refuses to answer —
  // llama-swap saying "model is busy" is exactly this: an assistant message
  // with stopReason "error", no content, and nothing else emitted.
  sessions.noteModelErrors(id, {
    type: "message_end",
    message: { role: "assistant", content: [], stopReason: "error", errorMessage: "model is busy" },
  });

  const notice = eventsSince(id).find((r) => r.type === "portal_notice");
  assert.ok(notice, "the error must be recorded as a portal notice");
  const payload = JSON.parse(notice.payload);
  assert.equal(payload.text, "Model error: model is busy");
  assert.equal(payload.error, true);
});

test("a retried turn that keeps failing ends with a failure notice", () => {
  const id = "err-retry";
  createSession({ id, title: "flaky model", workspace: home, executor: "host" });
  const failed = { type: "message_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "server error" } };
  sessions.noteModelErrors(id, failed);
  sessions.noteModelErrors(id, { type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 1000, errorMessage: "server error" });
  sessions.noteModelErrors(id, failed);
  sessions.noteModelErrors(id, { type: "auto_retry_end", success: false, attempt: 2, finalError: "server error" });

  const notices = eventsSince(id)
    .filter((r) => r.type === "portal_notice")
    .map((r) => JSON.parse(r.payload).text);
  assert.ok(notices.includes("Model error: server error"));
  assert.ok(notices.includes("Still failing after 2 retries: server error"));
});

test("a cancelled retry backoff and a clean answer produce no error notice", () => {
  const id = "err-cancelled";
  createSession({ id, title: "stopped mid-retry", workspace: home, executor: "host" });
  sessions.noteModelErrors(id, { type: "message_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "server error" } });
  sessions.noteModelErrors(id, { type: "auto_retry_end", success: false, attempt: 1, finalError: "Retry cancelled" });

  const notices = eventsSince(id)
    .filter((r) => r.type === "portal_notice")
    .map((r) => JSON.parse(r.payload));
  assert.ok(notices.every((p) => p.text !== "Still failing after 1 retry: Retry cancelled"));

  const id2 = "err-clean";
  createSession({ id: id2, title: "clean", workspace: home, executor: "host" });
  sessions.noteModelErrors(id2, { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "hi" }], stopReason: "stop" } });
  assert.equal(eventsSince(id2).filter((r) => r.type === "portal_notice").length, 0);
});

test("an aborted turn is not presented as a model error", () => {
  const id = "err-abort";
  createSession({ id, title: "aborted", workspace: home, executor: "host" });
  sessions.noteModelErrors(id, { type: "message_end", message: { role: "assistant", content: [], stopReason: "aborted" } });
  assert.equal(eventsSince(id).filter((r) => r.type === "portal_notice").length, 0);
});
