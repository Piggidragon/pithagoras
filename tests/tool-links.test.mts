import { test } from "node:test";
import assert from "node:assert/strict";
import { extractLinks, domainOf } from "../web/src/tool-links.ts";

const urls = (text: string) => extractLinks(text).map((l) => l.url);

test("a heading above a link on its own line", () => {
  const found = extractLinks("### Terminal colours\nhttps://example.com/ansi\n");
  assert.deepEqual(found, [
    { url: "https://example.com/ansi", domain: "example.com", title: "Terminal colours" },
  ]);
});

test("a numbered list with the link indented under it", () => {
  const found = extractLinks("1. First thing\n   https://a.example/one\n\n2. Second\n   https://b.example/two");
  assert.deepEqual(found.map((l) => [l.title, l.domain]), [
    ["First thing", "a.example"],
    ["Second", "b.example"],
  ]);
});

test("the Source: shape, title and all", () => {
  const found = extractLinks("Some snippet text.\nSource: The Title (https://example.org/page)");
  assert.deepEqual(found, [
    { url: "https://example.org/page", domain: "example.org", title: "The Title" },
  ]);
});

/** The whole reason this is not a link scanner. */
test("links inside fetched prose are not sources", () => {
  const page = [
    "# Some article",
    "",
    "It was built on ideas from https://unrelated.example/a and later",
    "extended, see https://unrelated.example/b for the details.",
    "Many pages link to https://unrelated.example/c in passing.",
  ].join("\n");
  assert.deepEqual(urls(page), []);
});

test("a fetched page that also cites its origin lists only that", () => {
  const page = [
    "Read more at https://elsewhere.example/x in the second paragraph.",
    "",
    "Source: Where this came from (https://origin.example/doc)",
  ].join("\n");
  assert.deepEqual(urls(page), ["https://origin.example/doc"]);
});

test("a run of links on one line is a reference list, not a citation each", () => {
  assert.deepEqual(urls("See https://a.example and https://b.example"), []);
});

test("a bare link on its own line counts, with no title to invent", () => {
  assert.deepEqual(extractLinks("https://example.com/thing"), [
    { url: "https://example.com/thing", domain: "example.com" },
  ]);
});

test("the same link twice is one source", () => {
  assert.deepEqual(urls("https://example.com/a\nhttps://example.com/a"), ["https://example.com/a"]);
});

test("a sentence's full stop is not part of the link", () => {
  assert.deepEqual(urls("Source: https://example.com/page."), ["https://example.com/page"]);
});

test("but a bracket the link opened itself is", () => {
  assert.deepEqual(
    urls("Source: Article (https://en.wikipedia.org/wiki/Foo_(bar))"),
    ["https://en.wikipedia.org/wiki/Foo_(bar)"],
  );
});

test("www is not worth showing", () => {
  assert.equal(domainOf("https://www.example.com/deep/path?q=1"), "example.com");
  assert.equal(domainOf("not a url at all"), "not a url at all");
});

test("a quality tag in front of the title is not part of it", () => {
  const found = extractLinks("3. [high] A good page\n   https://example.com/good");
  assert.equal(found[0].title, "A good page");
});

test("prose above a link is not pressed into service as its title", () => {
  const found = extractLinks(
    "This paragraph runs on for rather a long time and says a great deal about the subject at hand without ever being a title for anything.\nhttps://example.com/x",
  );
  assert.equal(found[0].title, undefined);
});

test("a tool that returned nothing has no sources", () => {
  assert.deepEqual(extractLinks(undefined), []);
  assert.deepEqual(extractLinks(""), []);
});

test("a citation list is cut off rather than becoming a directory", () => {
  const many = Array.from({ length: 60 }, (_, i) => `https://example.com/${i}`).join("\n");
  assert.equal(extractLinks(many).length, 30);
});

test("the shapes pi-web-access actually writes, together", () => {
  const output = [
    "### Pi Coding Agent",
    "https://pi.dev/",
    "",
    "1. Getting started",
    "   https://docs.example/start",
    "",
    "A snippet of the page text.",
    "Source: Release notes (https://github.example/releases)",
  ].join("\n");
  assert.deepEqual(extractLinks(output).map((l) => [l.domain, l.title]), [
    ["pi.dev", "Pi Coding Agent"],
    ["docs.example", "Getting started"],
    ["github.example", "Release notes"],
  ]);
});

// --- what the tool listed itself -------------------------------------------

const link = (url: string, title?: string) => ({
  url,
  domain: url.replace(/^https?:\/\//, "").replace(/\/.*$/, ""),
  ...(title ? { title } : {}),
});

test("a tool that listed no sources changes nothing", async () => {
  const { omitDrawn } = await import("../web/src/tool-links.ts");
  const links = [link("https://a.example/one", "The first thing")];
  assert.deepEqual(omitDrawn(links, undefined, "out"), links);
  assert.deepEqual(omitDrawn(links, ["5 sources", "a preview of the text"], "out"), links);
});

test("a source the tool listed by url is not listed twice", async () => {
  const { omitDrawn } = await import("../web/src/tool-links.ts");
  const links = [link("https://a.example/one"), link("https://b.example/two")];
  const left = omitDrawn(links, ["  ▸ https://a.example/one"], "unrelated output");
  assert.deepEqual(left.map((l) => l.url), ["https://b.example/two"]);
});

test("a source the tool listed by title is not listed twice either", async () => {
  const { omitDrawn } = await import("../web/src/tool-links.ts");
  const links = [link("https://a.example/one", "Write-Ahead Logging - SQLite")];
  assert.deepEqual(omitDrawn(links, ["  ▸ Write-Ahead Logging - SQLite · a.example"], ""), []);
});

test("a title the tool truncated still counts as listed", async () => {
  const { omitDrawn } = await import("../web/src/tool-links.ts");
  const long = "Write-Ahead Logging and everything that follows from it in practice";
  const links = [link("https://a.example/one", long)];
  assert.deepEqual(omitDrawn(links, [`  ▸ ${long.slice(0, 47)}...`], ""), []);
});

test("colour in the drawing does not hide what it says", async () => {
  const { omitDrawn } = await import("../web/src/tool-links.ts");
  const links = [link("https://a.example/one", "The first thing here")];
  const drawn = ["  \u001b[38;5;188m▸ The first thing here\u001b[39m\u001b[38;5;241m · a.example\u001b[39m"];
  assert.deepEqual(omitDrawn(links, drawn, ""), []);
});

test("a title too short to be distinctive is matched on its url alone", async () => {
  const { omitDrawn } = await import("../web/src/tool-links.ts");
  const links = [link("https://a.example/one", "Docs")];
  assert.equal(omitDrawn(links, ["reading the Docs for a while"], "").length, 1);
  assert.equal(omitDrawn(links, ["▸ https://a.example/one"], "").length, 0);
});

test("a tool that listed every source leaves no row at all", async () => {
  const { omitDrawn } = await import("../web/src/tool-links.ts");
  const links = [link("https://a.example/one"), link("https://b.example/two")];
  assert.deepEqual(omitDrawn(links, ["https://a.example/one", "https://b.example/two"], ""), []);
});

/**
 * The one that matters: a tool with nothing better to draw shows the first of
 * the output back, and a citation caught in that excerpt is not a claim.
 */
test("a citation inside a preview of the output is the output, not a list", async () => {
  const { omitDrawn, extractLinks } = await import("../web/src/tool-links.ts");
  const output = [
    "Some description of the thing.",
    "Source: Write-Ahead Logging - SQLite (https://www.sqlite.org/wal.html)",
    "",
    "More text.",
    "Source: Pragma statements (https://www.sqlite.org/pragma.html)",
  ].join("\n");
  const drawn = ["5 sources", ...output.split("\n").slice(0, 2)];
  const links = extractLinks(output);
  assert.equal(links.length, 2);
  assert.deepEqual(omitDrawn(links, drawn, output), links);
});

test("but a list the tool built out of the same sources still counts", async () => {
  const { omitDrawn, extractLinks } = await import("../web/src/tool-links.ts");
  const output = "Source: Write-Ahead Logging - SQLite (https://www.sqlite.org/wal.html)";
  const drawn = ["── Curated Results ──", "  ▸ Write-Ahead Logging - SQLite · sqlite.org"];
  assert.deepEqual(omitDrawn(extractLinks(output), drawn, output), []);
});
