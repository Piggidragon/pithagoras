import { readFileSync } from "node:fs";
import { installedExtensions } from "./extension-choices.js";
import { bundledSubagentDir } from "./features.js";
import { knownTools } from "./db.js";
import { piAgentDir, readPiSettings, readProjectPiSettings } from "./pi-settings.js";

/**
 * What a command can offer after its name: the values its argument may take,
 * for the page to suggest as the argument is typed.
 *
 * A prompt template says which source it takes its argument from, by a line of
 * its frontmatter (`arguments: extensions`). The sources are the portal's: a
 * template names one and cannot make one, so what is offered is never more
 * than what the portal itself reads. The page asks `GET
 * /api/sessions/:id/arguments/:source`, and nothing here knows any command.
 */
export interface ArgumentChoice {
  /** What is put after the command. */
  value: string;
  /** Where it comes from, in the words of the data: a source, a folder. */
  detail?: string;
  /** Short words the page puts a label to. */
  notes?: string[];
}

/** What a source may look at: the chat's folder, and what is off in it. */
export interface ArgumentContext {
  workspace: string;
  off: ReadonlySet<string>;
}

const SOURCES = new Map<string, (context: ArgumentContext) => ArgumentChoice[]>([
  [
    "extensions",
    ({ workspace, off }) => {
      const user = readPiSettings();
      const project = readProjectPiSettings(workspace);
      return installedExtensions({
        agentDir: piAgentDir(),
        userPackages: user.packages,
        userExtensions: user.extensions,
        projectDir: workspace,
        projectPackages: project.packages,
        projectExtensions: project.extensions,
        tools: knownTools(),
        off,
        bundled: bundledSubagentDir(),
      });
    },
  ],
]);

export const isArgumentSource = (name: string): boolean => SOURCES.has(name);

/** The values a source offers in a chat; undefined for a source there is none of. */
export const argumentChoices = (name: string, context: ArgumentContext): ArgumentChoice[] | undefined => SOURCES.get(name)?.(context);

/**
 * The source a prompt template takes its argument from, if it says one the
 * portal has. Read from the head of the file, as pi's own loader reads only
 * the keys it knows and leaves the rest.
 */
export function declaredArguments(file: string): string | undefined {
  let head: string;
  try {
    head = readFileSync(file, "utf8").slice(0, 4000);
  } catch {
    return undefined;
  }
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(head)?.[1];
  const source = frontmatter && /^arguments:[ \t]*["']?([\w-]+)["']?[ \t]*$/m.exec(frontmatter)?.[1];
  return source && isArgumentSource(source) ? source : undefined;
}
