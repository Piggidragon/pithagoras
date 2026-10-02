/**
 * The list under the composer while it holds a bare "/name".
 *
 * Pure so the rules can be tested without a page: which commands are offered,
 * in what order, and where the highlight goes.
 *
 * The character a command starts with is the person's to choose (see
 * command-trigger.ts), and it is only how a command is typed. What pi is sent
 * stays "/name" — pi, the channels and every saved routine call it that — so
 * `typedCommand` turns the one into the other.
 */

export interface Slashable {
  name: string;
}

/** The character a command starts with, until another is chosen. */
export const DEFAULT_TRIGGER = "/";

/** The token being typed, if the composer holds nothing but the trigger and one. */
export function slashToken(input: string, trigger = DEFAULT_TRIGGER): string | null {
  const text = input.trimStart();
  if (!text.startsWith(trigger)) return null;
  const rest = text.slice(trigger.length);
  return /^[\w:-]*$/.test(rest) ? rest : null;
}

/** A command as typed: its name, what follows it, and the "/name …" pi is sent. */
export interface TypedCommand {
  name: string;
  args: string;
  wire: string;
}

/**
 * The command a message starts with, if it starts with one: the trigger and a
 * name. Whether the name is one of the chat's commands is for the caller to
 * say, as `/etc/hosts is wrong` is a message however it starts.
 *
 * The slash form is read under any trigger. A command that is typed out in
 * full that way reaches pi as it always did, and the page has to treat it as
 * the command it is — `/new` must not be said to the agent because the
 * trigger was changed since it was learned.
 */
export function typedCommand(message: string, trigger = DEFAULT_TRIGGER): TypedCommand | null {
  for (const lead of trigger === DEFAULT_TRIGGER ? [trigger] : [trigger, DEFAULT_TRIGGER]) {
    if (!message.startsWith(lead)) continue;
    const rest = message.slice(lead.length);
    const m = /^([\w:-]+)\s*([\s\S]*)$/.exec(rest);
    if (m) return { name: m[1], args: m[2], wire: `/${rest}` };
  }
  return null;
}

/**
 * Every command that starts with what has been typed — all of them, not the
 * first few: `/` alone is how somebody finds out what there is, and a list
 * that stops at eight never reaches a skill or an extension.
 *
 * A command typed out in full comes first. Enter runs the highlighted one, and
 * `/skill:a` must not run `/skill:ab` because it happened to be listed earlier.
 */
export function paletteMatches<T extends Slashable>(commands: T[], token: string): T[] {
  const wanted = token.toLowerCase();
  const starts = commands.filter((c) => c.name.toLowerCase().startsWith(wanted));
  const exact = starts.filter((c) => c.name.toLowerCase() === wanted);
  return exact.length ? [...exact, ...starts.filter((c) => !exact.includes(c))] : starts;
}

/** Arrow keys wrap: from the last command down is the first. */
export function moveHighlight(index: number, delta: 1 | -1, count: number): number {
  if (count <= 0) return 0;
  return (index + delta + count) % count;
}

/**
 * The argument being typed, if the composer holds a command, a space and one
 * word: `/screen rpiv`. The command is whatever name was typed, for the caller
 * to say whether it is one that takes suggestions. Only the first argument is
 * suggested, so a second word, or a line break, ends it.
 *
 * Read under any trigger, as `typedCommand` is: the slash form is what pi is
 * sent, and what somebody who changed the trigger since may have typed.
 */
export function argumentToken(input: string, trigger = DEFAULT_TRIGGER): { name: string; typed: string } | null {
  const text = input.trimStart();
  for (const lead of trigger === DEFAULT_TRIGGER ? [trigger] : [trigger, DEFAULT_TRIGGER]) {
    if (!text.startsWith(lead)) continue;
    const m = /^([\w:-]+)[ \t]+(\S*)$/.exec(text.slice(lead.length));
    if (m) return { name: m[1], typed: m[2] };
  }
  return null;
}

/**
 * The values that fit what has been typed of an argument: those that start
 * with it first, then those that have it inside — `rpiv` finds
 * `@scope/rpiv-todo` — in the order they were offered. Nothing once what was
 * typed is one of them in full: there is nothing left to suggest, and Enter
 * is then the message.
 */
export function argumentMatches<T extends { value: string }>(choices: T[], typed: string): T[] {
  const wanted = typed.toLowerCase();
  const has = (c: T) => c.value.toLowerCase();
  if (wanted && choices.some((c) => has(c) === wanted)) return [];
  const starts = choices.filter((c) => has(c).startsWith(wanted));
  return [...starts, ...choices.filter((c) => !starts.includes(c) && has(c).includes(wanted))];
}
