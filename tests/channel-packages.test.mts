import { test } from "node:test";
import assert from "node:assert/strict";

// The builtin channel packages against a stand-in for their platform, which is
// all they talk to: Telegram over fetch.

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

/** A Telegram that answers what the package asks, and hands it what the test puts in the inbox. */
function telegram() {
  const calls: { method: string; body: any }[] = [];
  const inbox: any[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: any) => {
    const method = String(url).split("/").pop()!;
    calls.push({ method, body: JSON.parse(init.body) });
    if (method === "getUpdates") {
      while (!inbox.length) {
        if (init.signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
        await sleep(5);
      }
      return json({ ok: true, result: inbox.splice(0) });
    }
    return json({ ok: true, result: method === "getMe" ? { username: "bot" } : {} });
  }) as any;
  return { calls, inbox, restore: () => (globalThis.fetch = real) };
}

test("a Telegram button is answered only by somebody the portal says may, and stays open for them", async () => {
  const api = telegram();
  const controller = new AbortController();
  const { start } = await import("../channels/telegram/index.js");
  const channel = await start({ config: { botToken: "t" }, log() {}, signal: controller.signal, ask: async () => "" });
  try {
    const answer = channel.prompt("chat:1", {
      id: "abcdefghijklmnopqrstuvwxyz",
      method: "confirm",
      question: "Delete branch release?",
      // As the portal answers it: the person it was put to, or the primary user.
      canAnswer: (senderId: string) => senderId === "111",
    });
    let settled: any;
    void answer.then((value: any) => (settled = value));
    await sleep(20);

    // The button's data is the last sixteen characters of the portal's id, and the index.
    const data = `${"abcdefghijklmnopqrstuvwxyz".slice(-16)}:0`;
    const tap = (from: number) => ({ update_id: Math.floor(Math.random() * 1e9), callback_query: { id: `q${from}`, data, from: { id: from }, message: { chat: { id: 1 }, message_id: 5 } } });

    api.inbox.push(tap(999));
    await sleep(60);
    assert.equal(settled, undefined, "a member of the group who is not that person did not answer it");
    assert.equal(api.calls.some((c) => c.method === "editMessageText"), false, "the buttons are still there");
    const refused = api.calls.find((c) => c.method === "answerCallbackQuery" && c.body.callback_query_id === "q999");
    assert.match(refused!.body.text, /not for you/);

    api.inbox.push(tap(111));
    await sleep(60);
    assert.deepEqual(settled, { value: true });
    assert.ok(api.calls.some((c) => c.method === "editMessageText"), "the question now reads as decided");
  } finally {
    controller.abort();
    await channel.stop();
    api.restore();
  }
});
