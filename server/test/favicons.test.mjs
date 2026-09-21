import { test } from "node:test";
import assert from "node:assert/strict";
import { dns, favicon, publicAddress, publicHost, validDomain } from "../dist/favicons.js";

/** Everything that is not about resolution talks to a public address. */
dns.lookup = async () => [{ address: "93.184.216.34", family: 4 }];
const publicLookup = dns.lookup;

/** Answers for the resolver, so what an address means is tested, not the network. */
const resolvesTo = (...addresses) => {
  dns.lookup = async () =>
    addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  return () => (dns.lookup = publicLookup);
};

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

test("an address inside the network is not somewhere on the internet", () => {
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ]) {
    assert.equal(publicAddress(address), false, address);
  }
  for (const address of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:2800:220:1::1"]) {
    assert.equal(publicAddress(address), true, address);
  }
});

test("a public name that points at the loopback is not followed", async () => {
  // 127.0.0.1.nip.io and localtest.me are ordinary names on the public
  // internet, and both answer with the portal's own machine.
  const restore = resolvesTo("127.0.0.1");
  try {
    assert.equal(await publicHost("127.0.0.1.nip.io"), false);
  } finally {
    restore();
  }
});

test("a name that answers with one address inside and one outside is refused", async () => {
  const restore = resolvesTo("93.184.216.34", "10.0.0.5");
  try {
    assert.equal(await publicHost("split.example"), false);
  } finally {
    restore();
  }
});

test("a redirect into the network is not followed", async () => {
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    if (seen.length === 1) {
      return new Response("", { status: 302, headers: { location: "http://10.0.0.5/admin/logo.png" } });
    }
    return image();
  };
  const restore = resolvesTo("93.184.216.34");
  try {
    assert.equal(await favicon("redirects.example"), null);
    // The first request went out; the address the site chose was never asked for.
    assert.deepEqual(seen, ["https://redirects.example/favicon.ico"]);
  } finally {
    globalThis.fetch = real;
    restore();
  }
});

test("a redirect to another public site is followed", async () => {
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    if (seen.length === 1) {
      return new Response("", { status: 301, headers: { location: "https://cdn.example/icon.png" } });
    }
    return image();
  };
  try {
    const icon = await favicon("moved.example");
    assert.equal(icon?.type, "image/x-icon");
    assert.deepEqual(seen, ["https://moved.example/favicon.ico", "https://cdn.example/icon.png"]);
  } finally {
    globalThis.fetch = real;
  }
});

test("a redirect that goes round in circles gives up", async () => {
  let hops = 0;
  const real = globalThis.fetch;
  globalThis.fetch = async () => {
    hops++;
    return new Response("", { status: 302, headers: { location: "https://loop.example/again" } });
  };
  try {
    assert.equal(await favicon("loop.example"), null);
    assert.ok(hops <= 4, `gave up after ${hops}`);
  } finally {
    globalThis.fetch = real;
  }
});
