import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** What /screen sends the agent, expanded by pi as it does for any prompt template. */
const home = mkdtempSync(path.join(tmpdir(), "pithagoras-screen-command-"));
process.env.DATA_DIR = home;
process.env.PI_CODING_AGENT_DIR = path.join(home, "agent");
mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });

const { builtinPromptsDir, builtinSkillsDir } = await import("../dist/pi/sdk-client.js");
const { piFile } = await import("../dist/pi/package.js");
const { expandPromptTemplate, loadPromptTemplates } = await import(piFile("core/prompt-templates.js").href);
const templates = loadPromptTemplates({ cwd: home, agentDir: process.env.PI_CODING_AGENT_DIR, promptPaths: [builtinPromptsDir()], includeDefaults: false });

test("the command is a prompt template shipped beside the skill it invokes", () => {
  assert.ok(builtinSkillsDir(), "the skills the portal ships are found");
  const screen = templates.find((t) => t.name === "screen");
  assert.ok(screen, "/screen is a command");
  assert.match(screen.description, /Screens panel/);
  assert.equal(screen.argumentHint, "<extension>");
});

test("it names the extension, and the skill to follow", () => {
  const sent = expandPromptTemplate("/screen @scope/rpiv-todo", templates);
  assert.match(sent, /pi extension @scope\/rpiv-todo to the Screens panel/);
  assert.match(sent, /skill `extension-screens`/);
  assert.doesNotMatch(sent, /\$|\{@/, "every placeholder is filled in");
});

test("without a name it has the agent find out which, rather than guess", () => {
  const sent = expandPromptTemplate("/screen", templates);
  assert.match(sent, /pi list/);
  assert.match(sent, /skill `extension-screens`/);
  assert.doesNotMatch(sent, /\$|\{@/);
});
