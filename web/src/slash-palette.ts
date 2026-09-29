/**
 * The list under the composer while it holds a bare "/name".
 *
 * Pure so the rules can be tested without a page: which commands are offered,
 * in what order, and where the highlight goes.
 */

export interface Slashable {
  name: string;
}

/** The token being typed, if the composer holds nothing but "/" and one. */
export function slashToken(input: string): string | null {
  const m = /^\/([\w:-]*)$/.exec(input.trimStart());
  return m ? m[1] : null;
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
