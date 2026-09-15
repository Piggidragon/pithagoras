/**
 * Spell digits out for speech models that read them unreliably.
 *
 * Chatterbox reads digit groups as its own guess: German "RTX 4070" came back
 * from recognition as "RTX 70", "3060" as "3030". Written-out numbers are read
 * correctly, so synthesis receives words while the transcript keeps the digits.
 *
 * One pack per language, and a language without a pack keeps its text
 * unchanged — spelling a number wrong is worse than leaving the digits.
 */
interface NumberPack {
  /** 0–999999 as words. */
  number: (value: number) => string;
  /** Between the whole part and its digits, e.g. "3,5" in German. */
  decimal: string;
  percent: string;
}

function build(ones: string[], tens: string[], join: {
  /** Between tens and ones, e.g. "vierzig" + "und" + "eins", or "forty-one". */
  tensOnes: (tens: string, ones: string) => string;
  hundred: (count: string, rest: string) => string;
  thousand: (count: string, rest: string) => string;
  /** Some languages say "one hundred", others prefix a shortened form. */
  one: string;
}): (value: number) => string {
  const spell = (value: number): string => {
    if (value < 20) return ones[value];
    if (value < 100) {
      const rest = value % 10;
      return rest ? join.tensOnes(tens[Math.floor(value / 10)], rest === 1 ? join.one : ones[rest]) : tens[Math.floor(value / 10)];
    }
    if (value < 1000) {
      const count = Math.floor(value / 100);
      return join.hundred(count === 1 ? join.one : ones[count], value % 100 ? spell(value % 100) : "");
    }
    const count = Math.floor(value / 1000);
    return join.thousand(count === 1 ? join.one : spell(count), value % 1000 ? spell(value % 1000) : "");
  };
  return spell;
}

const PACKS: Record<string, NumberPack> = {
  de: {
    number: build(
      ["null", "eins", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn",
        "elf", "zwölf", "dreizehn", "vierzehn", "fünfzehn", "sechzehn", "siebzehn", "achtzehn", "neunzehn"],
      ["", "", "zwanzig", "dreißig", "vierzig", "fünfzig", "sechzig", "siebzig", "achtzig", "neunzig"],
      { tensOnes: (tens, ones) => `${ones}und${tens}`, hundred: (count, rest) => `${count}hundert${rest}`,
        thousand: (count, rest) => `${count}tausend${rest}`, one: "ein" }),
    decimal: "Komma", percent: "Prozent",
  },
  en: {
    number: build(
      ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
        "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"],
      ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"],
      { tensOnes: (tens, ones) => `${tens}-${ones}`, hundred: (count, rest) => `${count} hundred${rest && " " + rest}`,
        thousand: (count, rest) => `${count} thousand${rest && " " + rest}`, one: "one" }),
    decimal: "point", percent: "percent",
  },
};

export function hasNumberPack(language: string): boolean {
  return language in PACKS;
}

/**
 * Text with its numbers written out in `language`. Numbers of seven digits or
 * more, and anything already glued to letters (Q8_0, v2), stay as they are:
 * those read as identifiers rather than quantities. A language without a pack
 * gets its text back unchanged.
 */
export function spokenNumbers(text: string, language: string): string {
  const pack = PACKS[language];
  if (!pack) return text;
  return text
    .replace(/(\d+)\s*%/g, (_, digits: string) => `${digits} ${pack.percent}`)
    .replace(/(?<![\p{L}\d_])(\d{1,6})(?:[.,](\d{1,6}))?(?![\p{L}\d_])/gu, (match, whole: string, fraction?: string) => {
      const value = Number(whole);
      if (!Number.isSafeInteger(value)) return match;
      const spoken = pack.number(value);
      if (fraction === undefined) return spoken;
      return `${spoken} ${pack.decimal} ${[...fraction].map(digit => pack.number(Number(digit))).join(" ")}`;
    });
}
