---
name: "extension-screens"
description: "Use when asked to show an installed pi extension's data in the web UI — a todo list, a task board, a status — or to connect, wire up or add a screen for an extension. This is what the /screen command asks for. Writes a small glue extension that says the extension's data as building blocks, which the portal draws in its Screens panel."
---

# Putting an extension on a screen

The portal has a **Screens** panel beside the chat. It does not run an
extension's own interface; it draws a few generic **blocks** (text, status,
list, checklist, group) from data. Your job is the connection: a small pi
extension of the user's, the **glue**, that watches the other extension's data
and says it as blocks over pi's event bus. The portal and the extension stay
as they are.

## Before you start

- One line to the user: which extension, and what you mean to show of it.
- The portal reads the glue's events from pi's event bus, which it shares with
  pi only on the host executor (`EXECUTOR=host`, the default). On
  `EXECUTOR=container` nothing reaches the panel, whatever you write.

## 1. Find the extension and read it

```bash
pi list
```

Where its code is, by how it was installed: `npm:` packages are in
`$HOME/.pi/agent/npm/node_modules/<name>`, `git:` ones in
`$HOME/.pi/agent/git/<host>/<path>`, and a path is the path. Use `$HOME`, never
a literal home directory. If it is not installed, say so and ask: installing a
package runs its code with the agent's rights, so it is the user's call.

Read its `package.json` (the `pi.extensions` entry says which file starts it)
and that file. You are looking for:

- **Where its data is kept.** Most extensions keep state in the `details` of
  their tool results and rebuild it from `ctx.sessionManager.getBranch()` on
  `session_start` and `session_tree`, so that it follows a conversation that
  branches. Others write custom entries (`pi.appendEntry`) or emit events on
  `pi.events`. The data you show is that, not something you make up.
- **Which tool or event changes it**, so the glue knows when to say it again.
- **What its own screen draws** (`setWidget`, a TUI component, a `/command` that
  lists things). That says what the person cares about seeing.

Decide the smallest screen that is of use. For a todo list: a progress line and
the tasks with their state. Leave out what nobody looks at.

## 2. Compose it from blocks

Read `reference/blocks.md`: the blocks there are, what each takes, and how
they nest. Use only those. Everything is plain data: strings, numbers, lists
and objects of them.

If what you need is not a block, do not edit the portal or the extension to get
it. Say which block is missing and what it would take, and show what you can
with the ones there are. Blocks are generic pieces added to the portal itself:
in a checkout of it, `web/src/screens.ts` says what exists and
`web/src/components/ScreenBlocks.tsx` draws and registers each. A deployed
portal has only the built page, so this is not something to do there.

## 3. Write the glue

Copy the template and change the three places marked `CHANGE`:

```bash
mkdir -p "$HOME/.pi/agent/extensions/screen-<name>"
cp "<this skill's folder>/templates/glue.mts" "$HOME/.pi/agent/extensions/screen-<name>/index.ts"
```

`<this skill's folder>` is the directory of this file. The template is written
for a made-up todo tool; you replace what it reads with what yours keeps.

Put it **there** and nowhere else. `$HOME/.pi/agent/extensions` is the user's
own folder on the data volume: a portal update replaces its image and does not
touch it, and an update of the extension replaces the extension's folder and
does not either. A file in the extension's folder or in the portal's source
would be overwritten by the next update.

Rules for the glue:

- **One stable id per screen** (`todo`) and a title. The glue says the screen
  *whole* each time, `screen:v1:set` with `{ id, title, blocks }`, which
  replaces the last; `screen:v1:clear` with `{ id }` takes it away.
- **Say it again** when the data changes (the tool's `tool_result`) and **read
  it back** on `session_start` and `session_tree`, so the screen is right after
  a restart, when a chat is opened again, and on another branch. Clear it on
  `session_shutdown`.
- **Defensive.** Data that is not the shape you expect gives no screen, never
  a wrong one and never an exception: the glue's handlers run in every turn.
  A failed tool call that carries none of the data leaves the screen as it was.
- **Read only.** It does not register tools or commands, does not change the
  extension's data, and does not write files. It needs no import from the
  portal: only the `ExtensionAPI` type.
- No timers, no watchers. The extension's events are the only clock.
- Write at its top which extension and version it was written against.

## 4. Load it and check it

Tell the user to run `/reload` (or start a new chat): pi finds the new
extension then. A **Screens** button appears in the chat's header once a
screen has been said, which for a glue that reads the conversation back is at
once if the extension has data in it, and otherwise the first time the extension
is used. Ask the user to open it and tell you what it shows.

If there is no button: the glue did not load (an error in the file may show as
an extension error in the chat; the folder and `index.ts` must be named exactly
as above), or the extension has not produced data yet (use it once), or the
portal runs pi in containers (`EXECUTOR=container`), which it cannot hear.

## 5. Say what you made

Two lines for the user: what the screen shows, and the path of the glue. Say
that if the extension is updated and its data changes shape, `/screen <name>`
makes the glue again.

## What this is not

- Not a copy of the extension's own interface, and not a way to click through
  to it. Blocks show; they do not take input.
- Not a change to the extension, to pi, or to the portal.
