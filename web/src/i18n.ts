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
  settle();
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
let current: Locale = ENGLISH;
/** How numbers and dates are written, worked out with the language: see `formatsFor`. */
let formatLocale = "en";

/**
 * How numbers and dates are written: the browser's own way where it speaks the
 * language shown — "en-GB" writes the date first — and the language's
 * otherwise, so a German page does not show a date the American way. English
 * is also what is shown for a browser language there is no file for, so a
 * French browser on the English page keeps its French dates.
 */
export function formatsFor(code: string, wanted: readonly string[] = browserLanguages()): string {
  const base = code.split("-")[0];
  return wanted.find((l) => l.split("-")[0] === base) ?? (code === ENGLISH.code && wanted[0] ? wanted[0] : code);
}

/** The language a choice comes to now, and how it writes numbers and dates. */
function settle(): void {
  current = resolve(choice);
  formatLocale = formatsFor(current.code);
}
settle();

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
  const wasFormats = formatLocale;
  settle();
  try {
    document.documentElement.lang = current.code;
  } catch {
    // Not in a browser: the tests.
  }
  if (current !== was || formatLocale !== wasFormats) listeners.forEach((l) => l());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The language in effect, drawing the component again when it changes. */
export const useLanguage = (): string => useSyncExternalStore(subscribe, language, language);

const fill = (text: string, vars?: Record<string, string | number>) =>
  vars ? text.replace(/\{(\w+)\}/g, (all, name: string) => (Object.hasOwn(vars, name) ? String(vars[name]) : all)) : text;

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
 * What a value is called, from a table of `msg()` texts: a state, a role, a
 * level. One the table does not know — something newer than the portal — is
 * shown as `unknown` makes it, the value itself unless said otherwise.
 */
export const labelOf = (labels: Readonly<Record<string, string>>, value: string, unknown: (value: string) => string = (v) => v): string =>
  Object.hasOwn(labels, value) ? t(labels[value]) : unknown(value);

/**
 * A text with something drawn in it — a link, a key — where `t` takes only
 * words: `tx("Press {key} to send", { key: <kbd>Enter</kbd> })`.
 */
export function tx(text: string, vars: Record<string, ReactNode>): ReactNode {
  const said = current.strings[text];
  const parts = (typeof said === "string" ? said : text).split(/\{(\w+)\}/);
  return createElement(Fragment, null, ...parts.map((part, i) => (i % 2 ? (Object.hasOwn(vars, part) ? vars[part] : `{${part}}`) : part)));
}


/**
 * Formatters are costly to make and shown by the hundred — a count in every
 * row — so each is made once per language and set of options.
 */
const formatters = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat | Intl.DisplayNames | Intl.RelativeTimeFormat>();
function formatter<F extends Intl.NumberFormat | Intl.DateTimeFormat | Intl.DisplayNames | Intl.RelativeTimeFormat>(kind: string, locale: string, options: object | undefined, make: () => F): F {
  // Most calls pass no options — a count in a row — and are found without building a key from them.
  const key = options ? `${kind}|${locale}|${JSON.stringify(options)}` : `${kind}|${locale}`;
  let made = formatters.get(key) as F | undefined;
  if (!made) formatters.set(key, (made = make()));
  return made;
}

const DATE: Intl.DateTimeFormatOptions = { year: "numeric", month: "numeric", day: "numeric" };
const TIME: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "numeric", second: "numeric" };
const DATE_FIELDS = ["weekday", "year", "month", "day", "dateStyle"] as const;
const TIME_FIELDS = ["dayPeriod", "hour", "minute", "second", "fractionalSecondDigits", "timeStyle"] as const;

/** What toLocaleString, toLocaleDateString and toLocaleTimeString fill in when nothing is asked for. */
function withDefaults(options: Intl.DateTimeFormatOptions | undefined, fill: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions {
  const asked = options ?? {};
  const has = (fields: readonly string[]) => fields.some((f) => (asked as Record<string, unknown>)[f] !== undefined);
  return has(DATE_FIELDS) || has(TIME_FIELDS) ? asked : { ...fill, ...asked };
}

const dateTime = (d: Date | number | string, kind: string, options: Intl.DateTimeFormatOptions) => {
  const at = new Date(d);
  // What cannot be read says so, as toLocaleString did, rather than throwing.
  if (Number.isNaN(at.getTime())) return String(at);
  const locale = formatLocale;
  return formatter(kind, locale, options, () => new Intl.DateTimeFormat(locale, options)).format(at);
};

/** A number the language's way. */
export const formatNumber = (n: number, options?: Intl.NumberFormatOptions): string => {
  const locale = formatLocale;
  return formatter("number", locale, options, () => new Intl.NumberFormat(locale, options)).format(n);
};

/** A date and time the language's way. */
export const formatDateTime = (d: Date | number | string, options?: Intl.DateTimeFormatOptions): string =>
  dateTime(d, "datetime", withDefaults(options, { ...DATE, ...TIME }));

/** A date the language's way. */
export const formatDate = (d: Date | number | string, options?: Intl.DateTimeFormatOptions): string =>
  dateTime(d, "date", withDefaults(options, DATE));

/** A time of day the language's way. */
export const formatTime = (d: Date | number | string, options?: Intl.DateTimeFormatOptions): string =>
  dateTime(d, "time", withDefaults(options, TIME));

/** A language's name in the language shown: "de" is "German" in English, "Deutsch" in German. */
export function languageName(code: string, fallback = code): string {
  try {
    return formatter("language", current.code, undefined, () => new Intl.DisplayNames([current.code], { type: "language" })).of(code) ?? fallback;
  } catch {
    return fallback;
  }
}

/** "3 days ago", with the unit given, the language's way. */
export const formatRelative = (value: number, unit: Intl.RelativeTimeFormatUnit): string =>
  formatter("relative", current.code, undefined, () => new Intl.RelativeTimeFormat(current.code, { numeric: "always" })).format(value, unit);
