import { createElement, Fragment, useSyncExternalStore, type ReactNode } from "react";
import { local } from "./safe-storage";

/**
 * The portal in more than one language.
 *
 * English is written in the code, as it always was, and is its own key:
 * `t("New chat")` is "New chat" until a language has another word for it. A
 * language is one file in `locales/`, mapping each English text to its own —
 * adding one means adding that file and nothing else. What a language lacks
 * is shown in English rather than not at all; the tests say what is missing.
 *
 * Words in the text are `{name}`, filled in from what is passed along:
 * `t("Saved {file}", { file })`. A count takes `tp`, since languages do not
 * agree on how many forms a noun has: `tp(n, "{n} file", "{n} files")`, and a
 * language gives the forms it has for the plural as the key.
 *
 * Text the code keeps before it is shown — a tab's label in a table — is
 * marked with `msg()`, which changes nothing, so the tests find it too; it is
 * translated where it is drawn, with `t(label)`.
 *
 * `t` answers in the language in effect at the moment it is called, so a
 * component has to be drawn again to change. The app is, from the top, when
 * the language changes (`useLanguage` in App): React draws everything under a
 * component again with it, except what is `memo`ed, which is drawn anew only
 * when what is passed to it changes — text in one has to come from outside it,
 * or it has to ask for `useLanguage` itself. The same goes for text kept in
 * state or a `useMemo`: kept, it stays in the language it was made in.
 */

/** A text with a count, in every form the language has — "other" at least. */
export type Plural = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

export interface Locale {
  /** The language's code, as a browser names it: "de", "pt-BR". */
  code: string;
  /** Its name in itself, as it is offered: "Deutsch". */
  name: string;
  /** Each English text, in this language. A count's text is keyed by its English plural. */
  strings: Record<string, string | Plural>;
}

/** What is written in the code. */
export const ENGLISH: Locale = { code: "en", name: "English", strings: {} };

const locales = new Map<string, Locale>([[ENGLISH.code, ENGLISH]]);

/** A language to offer. Added before the app is drawn, from `locales/`. */
export function addLocale(locale: Locale): void {
  locales.set(locale.code, locale);
  current = resolve(choice);
}

/** Every language there is, English first, then by name. */
export function languages(): { code: string; name: string }[] {
  const rest = [...locales.values()].filter((l) => l !== ENGLISH).sort((a, b) => a.name.localeCompare(b.name));
  return [ENGLISH, ...rest].map(({ code, name }) => ({ code, name }));
}

/** A language, or whatever the browser is set to. */
export type LanguageChoice = "system" | string;

const KEY = "pithagoras.language";

const browserLanguages = (): readonly string[] => {
  try {
    return navigator.languages?.length ? navigator.languages : [navigator.language];
  } catch {
    return [];
  }
};

/**
 * The language a choice comes to: the one named, or the first of the
 * browser's that there is — "de-AT" is "de" when there is no "de-AT" — and
 * English when there is none.
 */
export function resolve(choice: LanguageChoice, wanted: readonly string[] = browserLanguages()): Locale {
  const find = (code: string) => locales.get(code) ?? locales.get(code.split("-")[0]);
  if (choice !== "system") return find(choice) ?? ENGLISH;
  for (const code of wanted) {
    const hit = code && find(code);
    if (hit) return hit;
  }
  return ENGLISH;
}

const storedChoice = (): LanguageChoice => local.get(KEY) || "system";

let choice: LanguageChoice = storedChoice();
let current: Locale = resolve(choice);
const listeners = new Set<() => void>();

/** The language chosen in this browser, "system" when none was. */
export const languageChoice = (): LanguageChoice => choice;

/** The code of the language in effect. */
export const language = (): string => current.code;

/** Change it, and remember it in this browser. */
export function setLanguage(next: LanguageChoice): void {
  choice = next;
  if (next === "system") local.remove(KEY);
  else local.set(KEY, next);
  apply();
}

/** Take up the language again — the browser's may have changed — and tell the page. */
export function apply(): void {
  const was = current;
  current = resolve(choice);
  try {
    document.documentElement.lang = current.code;
  } catch {
    // Not in a browser: the tests.
  }
  if (current !== was) listeners.forEach((l) => l());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The language in effect, drawing the component again when it changes. */
export const useLanguage = (): string => useSyncExternalStore(subscribe, language, language);

const fill = (text: string, vars?: Record<string, string | number>) =>
  vars ? text.replace(/\{(\w+)\}/g, (all, name: string) => (name in vars ? String(vars[name]) : all)) : text;

/** A text in the language in effect. */
export function t(text: string, vars?: Record<string, string | number>): string {
  const said = current.strings[text];
  return fill(typeof said === "string" ? said : text, vars);
}

const plurals = new Map<string, Intl.PluralRules>();
const pluralOf = (code: string, n: number): Intl.LDMLPluralRule => {
  let rules = plurals.get(code);
  if (!rules) plurals.set(code, (rules = new Intl.PluralRules(code)));
  return rules.select(n);
};

/**
 * A text with a count, `{n}` in it being the count, written the language's
 * way: "1,234" in English, "1.234" in German.
 */
export function tp(n: number, one: string, other: string, vars?: Record<string, string | number>): string {
  const said = current.strings[other];
  const form = pluralOf(current.code, n);
  const text = said && typeof said === "object" ? (said[form] ?? said.other) : form === "one" ? one : other;
  return fill(text, { n: formatNumber(n), ...vars });
}

/** Marks a text kept for later, to be put through `t` where it is shown. */
export const msg = <T extends string>(text: T): T => text;

/**
 * A text with something drawn in it — a link, a key — where `t` takes only
 * words: `tx("Press {key} to send", { key: <kbd>Enter</kbd> })`.
 */
export function tx(text: string, vars: Record<string, ReactNode>): ReactNode {
  const said = current.strings[text];
  const parts = (typeof said === "string" ? said : text).split(/\{(\w+)\}/);
  return createElement(Fragment, null, ...parts.map((part, i) => (i % 2 ? (part in vars ? vars[part] : `{${part}}`) : part)));
}

/**
 * How numbers and dates are written: the browser's own way where it speaks the
 * language shown — "en-GB" writes the date first — and the language's
 * otherwise, so a German page does not show a date the American way.
 */
function formats(): string {
  const base = current.code.split("-")[0];
  return browserLanguages().find((code) => code.split("-")[0] === base) ?? current.code;
}

/** A number the language's way. */
export const formatNumber = (n: number, options?: Intl.NumberFormatOptions): string =>
  n.toLocaleString(formats(), options);

/** A date and time the language's way. */
export const formatDateTime = (d: Date | number | string, options?: Intl.DateTimeFormatOptions): string =>
  new Date(d).toLocaleString(formats(), options);

/** A date the language's way. */
export const formatDate = (d: Date | number | string, options?: Intl.DateTimeFormatOptions): string =>
  new Date(d).toLocaleDateString(formats(), options);

/** A time of day the language's way. */
export const formatTime = (d: Date | number | string, options?: Intl.DateTimeFormatOptions): string =>
  new Date(d).toLocaleTimeString(formats(), options);
