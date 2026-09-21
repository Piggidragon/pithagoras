import { test } from "node:test";
import assert from "node:assert/strict";
import { favicon, validDomain } from "../dist/favicons.js";

test("a domain is a name and nothing smuggled through it", () => {
  assert.ok(validDomain("example.com"));
  assert.ok(validDomain("news.bbc.co.uk"));
  assert.ok(!validDomain(""));
  assert.ok(!validDomain("localhost"));
  assert.ok(!validDomain("example.com/../secret"));
  assert.ok(!validDomain("example.com:4100"));
  assert.ok(!validDomain("user@example.com"));
  assert.ok(!validDomain("10.10.30.122"));
  assert.ok(!validDomain("box.internal"));
  assert.ok(!validDomain("example..com"));
  assert.ok(!validDomain("nodot"));
});

/** Stands in for the network, and counts how often it was reached for. */
function stubFetch(reply) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return reply();
  };
  return { calls, restore: () => (globalThis.fetch = real) };
}

const image = (bytes = [0, 0, 1, 0]) =>
  new Response(new Uint8Array(bytes), { headers: { "content-type": "image/x-icon" } });

test("an icon is fetched once and kept", async () => {
  const net = stubFetch(() => image());
  try {
    const first = await favicon("kept-once.example");
    const second = await favicon("kept-once.example");
    assert.equal(first?.type, "image/x-icon");
    assert.deepEqual(second, first);
    assert.deepEqual(net.calls, ["https://kept-once.example/favicon.ico"]);
  } finally {
    net.restore();
  }
});

test("asked for twice at once, the site is asked once", async () => {
  const net = stubFetch(() => image());
  try {
    const [a, b] = await Promise.all([favicon("at-once.example"), favicon("at-once.example")]);
    assert.ok(a && b);
    assert.equal(net.calls.length, 1);
  } finally {
    net.restore();
  }
});

test("a page offered in place of an icon is not one", async () => {
  const net = stubFetch(
    () => new Response("<!doctype html>", { headers: { "content-type": "text/html" } })
  );
  try {
    assert.equal(await favicon("html.example"), null);
  } finally {
    net.restore();
  }
});

test("a site that has no icon is remembered as having none", async () => {
  const net = stubFetch(() => new Response("", { status: 404 }));
  try {
    assert.equal(await favicon("none.example"), null);
    assert.equal(await favicon("none.example"), null);
    assert.equal(net.calls.length, 1);
  } finally {
    net.restore();
  }
});

test("a site that will not answer is not an error", async () => {
  const net = stubFetch(() => {
    throw new Error("ECONNREFUSED");
  });
  try {
    assert.equal(await favicon("down.example"), null);
  } finally {
    net.restore();
  }
});
