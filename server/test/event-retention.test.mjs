import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pithagoras-event-retention-"));
process.env.DATA_DIR = dataDir;

const { appendEvent, eventsSince } = await import("../dist/db.js");

test.after(() => rmSync(dataDir, { recursive: true, force: true }));

test("message replay keeps every delta without storing cumulative snapshots", () => {
  const chunks = Array.from({ length: 400 }, (_, index) => `chunk-${index};`);
  let accumulated = "";
  let originalBytes = 0;

  for (const chunk of chunks) {
    accumulated += chunk;
    const partial = {
      role: "assistant",
      content: [{ type: "text", text: accumulated }],
    };
    const payload = {
      type: "message_update",
      message: partial,
      assistantMessageEvent: {
        type: "text_delta",
        delta: chunk,
        partial,
      },
    };
    originalBytes += Buffer.byteLength(JSON.stringify(payload));
    appendEvent("long-session", "message_update", payload);
  }

  const stored = eventsSince("long-session", 0, 1000);
  const replayed = stored
    .map((row) => JSON.parse(row.payload).assistantMessageEvent?.delta ?? "")
    .join("");
  const storedBytes = stored.reduce((total, row) => total + Buffer.byteLength(row.payload), 0);

  assert.equal(stored.length, chunks.length);
  assert.equal(replayed, accumulated);
  assert.ok(
    storedBytes < originalBytes / 10,
    `expected compact replay data; stored ${storedBytes} of ${originalBytes} bytes`,
  );
});

test("unrecognised message update payloads are retained verbatim", () => {
  const payload = { type: "message_update", extensionData: { future: true } };
  appendEvent("future-session", "message_update", payload);

  const [stored] = eventsSince("future-session", 0, 10);
  assert.deepEqual(JSON.parse(stored.payload), payload);
});
