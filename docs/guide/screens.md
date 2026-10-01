# Extension screens

An installed [extension](/guide/extensions) often has something worth looking at:
a todo list, a task board, a status. In pi's terminal it draws that itself. In
the portal it has no terminal to draw in, so the **Screens** panel does it
instead: a button in the chat's header that opens what the chat's extensions
show of themselves.

The panel does not run an extension's own interface. It draws a few generic
building blocks (text, a status, a list, a checklist, a group of those) from
data, and the portal knows nothing of any one extension. Making an extension
say its data in those blocks is a small job, which the agent does for you:

```
/screen <extension>
```

## Connecting an extension

1. Install the extension as usual, in [Settings → Extensions](/guide/extensions).
2. In a chat, type `/screen` and the extension's name, as `pi list` shows it. Leave
   the name out and the agent asks which one you mean.
3. The agent reads the extension, decides on the smallest screen of use (for a
   todo list: a progress line and the tasks with their state), writes the
   connection, checks that pi can load it, and tells you what it made and where.
   The check is its job because pi does not say in the chat when an extension
   fails to load: `/reload` reports a reload either way.
4. Run `/reload`, or start a new chat, so pi finds it. A **Screens** button
   appears in the chat's header once the extension has something to show: at
   once if its data is already in the conversation, otherwise the first time it
   is used.

A name with a scope, `@scope/name`, is fine to give `/screen`. The agent makes a
short folder name of its own from it for the connection.

`/screen` is a prompt template and `extension-screens` is the
[skill](/guide/extensions#built-in-skills) it has the agent follow. Both ship
with the portal and are there in every chat. The skill can also be asked for in
words: "show my todo extension in the web UI".

## The panel

It is a [panel](/guide/files#panels) like Files and Git: docked left, right or
at the bottom, or floated, and at most two are open at once. It is not shown in
[voice mode](/guide/voice). Each screen is a titled section; several extensions
stack one under another. It follows the extension live, while the agent works,
and is empty (and says so) when the extension takes its screen away.

The panel is a view. Nothing in it takes input: you cannot tick a todo there. To
change the extension's data, ask the agent, as before.

## The blocks

| Block | Shows |
| --- | --- |
| `group` | Blocks in a stack, under a heading. How a screen gets parts. |
| `text` | A paragraph, optionally coloured by a tone. |
| `status` | One fact: a label and its value in a pill. A count, a state, a version. |
| `list` | Items with a bullet, or numbered. Items may hold items. |
| `checklist` | Items with a mark for their state: to do, in progress, done, waiting. |

A **tone** is `ok`, `warn`, `error` or `muted`. A checklist item's **state** is
`todo`, `doing`, `done` or `blocked`. An item can carry a dimmer `detail` line.
The agent reads the exact fields from the skill's own reference
(`skills/extension-screens/reference/blocks.md` in the portal's source); a test
keeps that reference in step with what the page draws.

These five are the first set because a todo list needs exactly them, and most
status screens do. More are added to the portal as generic pieces when one is
missing (a table, say), never as something specific to one extension. The agent
is told not to change the portal or the extension to get one. It says which
block is missing, and shows what it can with the ones there are.

What the page does not understand is left out and not made into an error. A
block of a type it does not know is shown as a line saying so, and what a block
cannot read of its data is skipped, so a connection written for another version
of the portal loses a line, not the whole screen.

## How it works, and where the connection lives

Extension data reaches the page in three steps:

1. **The extension** keeps its data as it always did, usually in the `details` of
   its tool results, which is how it follows a conversation that branches.
2. **The glue**, a small pi extension of your own, watches that data and says
   it as blocks on pi's event bus: `screen:v1:set` with `{ id, title?, blocks }`,
   `screen:v1:clear` with `{ id }`. It says the whole screen each time, and a
   screen said again replaces the last.
3. **The portal** listens on the bus, holds each chat's screens while the chat's
   pi runs, and sends changes to the page as live events. A page opened later
   asks for what is held.

Like the [subagent protocol](/guide/extensions#the-subagent-protocol), it needs no
dependency on the portal: the glue only calls `pi.events.emit`, and does nothing
where nobody listens.

The glue lives in `extensions/screen-<slug>/index.ts` in pi's agent folder:
pi's own place for an extension of yours, on the data volume. That folder is
`~/.pi/agent`, or where `PI_CODING_AGENT_DIR` puts it (see
[Configuration](/reference/configuration)); the agent takes it from there and
does not write a path by hand. `<slug>` is a short name the agent chooses, such as
`screen-rpiv-todo`, and has no scope or `/` in it: pi finds an extension one
folder down and not two, so a folder named after `@scope/name` would never be
loaded. That is on purpose, and it is why the connection survives updates:

- **A portal update** replaces the image. The data volume stays.
- **An update of the extension** replaces the extension's own folder. The glue
  is not in it.
- Nothing in the portal's source, and nothing in the extension, is edited.

If an update changes the shape of the extension's data and the screen goes
wrong or empty, run `/screen <extension>` again and the agent writes it anew. To
remove a connection, delete its folder and `/reload`.

The glue is plain code the agent wrote, with the same rights as any extension.
It is meant to be read-only: it does not register tools, does not change the
extension's data and writes no files. Have a look at it, as you would at any
extension.

## What it does not do

- **Host executor only.** The portal hears the glue only where pi runs on the
  host (`EXECUTOR=host`, the default). With `EXECUTOR=container` pi runs in its
  own process with its own event bus, out of reach, and the panel stays empty.
  Subagents and jobs have the same limit.
- **Screens are not stored.** The portal keeps them while the chat's pi runs. The
  glue reads the extension's data back when pi starts for the chat, and says the
  screen again, so it is right without a database of its own. Opening a chat in
  the page does not start its pi, so after a restart of the portal the Screens
  button comes with the chat's first message (typing `/` starts it too), and not
  before.
- **At most 12 screens a chat**, and each is bounded, since a screen is sent whole
  to every open page with each change: text is cut at 2,000 characters, a list at
  200 entries, nesting at a few levels, the whole screen at a few thousand values,
  and all its text together at 100,000 characters. More is cut, not refused: at
  an entry, never inside one, so the item that does not fit is left out whole with
  the ones after it, a list that nothing of fits in goes with the block that holds
  it (rather than say "No tasks." of tasks that were dropped), and what stays is
  as the extension said it. A long
  description is better left out of a block than the reason the list ends early.
- **Blocks show, they do not take input.** There is no way to click through to
  the extension.
