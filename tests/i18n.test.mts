import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { addLocale, ENGLISH, languages, resolve, setLanguage, t, tp, tx, type Locale, type Plural } from "../web/src/i18n.ts";

const SRC = path.resolve(import.meta.dirname, "../web/src");
const LOCALES = path.join(SRC, "locales");

const sources = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return p === LOCALES ? [] : sources(p);
    return /\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts") ? [p] : [];
  });

/** Every text the code shows, as it is written there, and whether it is a count's. */
function texts(): Map<string, { plural: boolean; where: string }> {
  const found = new Map<string, { plural: boolean; where: string }>();
  for (const file of sources(SRC)) {
    const src = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const literal = (e: ts.Expression | undefined) => (e && (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) ? e.text : undefined);
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
        const where = `${path.relative(SRC, file)}:${src.getLineAndCharacterOfPosition(n.getStart(src)).line + 1}`;
        const name = n.expression.text;
        if (name === "t" || name === "tx" || name === "msg") {
          const key = literal(n.arguments[0]);
          if (key !== undefined) found.set(key, { plural: false, where });
        } else if (name === "tp") {
          const one = literal(n.arguments[1]);
          const other = literal(n.arguments[2]);
          assert.ok(one !== undefined && other !== undefined, `${where}: tp takes its two forms as they are written`);
          found.set(other!, { plural: true, where });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(src);
  }
  return found;
}

const localeFiles = () => fs.readdirSync(LOCALES).filter((f) => f.endsWith(".ts") && f !== "index.ts");
const load = async (file: string): Promise<Locale> => (await import(path.join(LOCALES, file))).default;
const words = (s: string) => new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));

test("there is something to translate, and German is offered", async () => {
  assert.ok(texts().size > 1000);
  assert.ok(localeFiles().includes("de.ts"));
  assert.equal((await load("de.ts")).code, "de");
});

test("every language has every text the code shows, and nothing it no longer does", async () => {
  const want = texts();
  for (const file of localeFiles()) {
    const locale = await load(file);
    const missing = [...want.keys()].filter((k) => !(k in locale.strings));
    const stale = Object.keys(locale.strings).filter((k) => !want.has(k));
    assert.deepEqual(missing.map((k) => `${want.get(k)!.where}: ${k}`), [], `${file} lacks these`);
    assert.deepEqual(stale, [], `${file} has these the code no longer shows`);
  }
});

test("a translation fills in the same words, and a count's has every form", async () => {
  const want = texts();
  for (const file of localeFiles()) {
    const locale = await load(file);
    for (const [key, said] of Object.entries(locale.strings)) {
      const plural = want.get(key)?.plural;
      if (plural) {
        assert.equal(typeof said, "object", `${file}: "${key}" is a count, with a form for each number`);
        const forms = said as Plural;
        assert.ok(forms.other, `${file}: "${key}" needs its "other" form`);
        const known = new Set([...words(key), "n"]);
        for (const [form, text] of Object.entries(forms)) {
          for (const w of words(text!)) assert.ok(known.has(w), `${file}: "${key}" (${form}) fills in {${w}}, which is never given`);
        }
        assert.deepEqual(new Set([...words(forms.other)].filter((w) => w !== "n")), new Set([...words(key)].filter((w) => w !== "n")), `${file}: "${key}"`);
      } else {
        assert.equal(typeof said, "string", `${file}: "${key}" is no count`);
        assert.deepEqual(words(said as string), words(key), `${file}: "${key}" fills in other words than the English`);
        assert.ok((said as string).trim(), `${file}: "${key}" is empty`);
      }
    }
  }
});

test("English is what the code says; another language where it has the text", () => {
  addLocale({ code: "xx", name: "Test", strings: { "Hello {name}": "Hallo {name}", "{n} files": { one: "eine Datei", other: "{n} Dateien" } } });
  try {
    setLanguage("en");
    assert.equal(t("Hello {name}", { name: "Ada" }), "Hello Ada");
    assert.equal(tp(1, "{n} file", "{n} files"), "1 file");
    assert.equal(tp(1234, "{n} file", "{n} files"), "1,234 files");
    setLanguage("xx");
    assert.equal(t("Hello {name}", { name: "Ada" }), "Hallo Ada");
    assert.equal(t("Not there"), "Not there", "what a language lacks is shown in English");
    assert.equal(tp(1, "{n} file", "{n} files"), "eine Datei");
    assert.equal(tp(3, "{n} file", "{n} files"), "3 Dateien");
    assert.equal(t("Left {alone}"), "Left {alone}", "a word not given stays as it is");
  } finally {
    setLanguage("system");
  }
});

test("a text with something drawn in it keeps it in its place", () => {
  const node = tx("Press {key} to send", { key: "⏎" }) as { props: { children: unknown[] } };
  assert.deepEqual(node.props.children, ["Press ", "⏎", " to send"]);
});

test("the browser's language is used when there is one for it", () => {
  addLocale({ code: "de", name: "Deutsch", strings: {} });
  assert.equal(resolve("system", ["de-AT", "en"]).code, "de", "de-AT is German");
  assert.equal(resolve("system", ["fr-FR", "de"]).code, "de", "the first one there is");
  assert.equal(resolve("system", ["fr-FR"]).code, "en", "English without one");
  assert.equal(resolve("de", ["en-US"]).code, "de", "what was chosen, over the browser");
  assert.equal(resolve("zz", ["de"]).code, "en", "a language no longer there is English");
  assert.equal(languages()[0].code, ENGLISH.code, "English is offered first");
});
