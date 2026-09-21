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
