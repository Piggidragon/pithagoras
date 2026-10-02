# The building blocks

What the Screens panel draws. A screen is `{ id, title?, blocks }`; a block is
`{ type, … }`. Blocks compose: a `group` holds blocks, and a `list` or
`checklist` holds items, which may hold items. Everything is plain data.

What a block does not understand of its data is left out; a block whose `type`
the page does not know is shown as a line saying so. A glue written for another
version of the portal loses a line, not the screen.

Block types: `group`, `text`, `status`, `list`, `checklist`.

## Tones and states

`tone` is one of `ok` (green), `warn` (amber), `error` (red), `muted` (dim). A
block or item without one is plain.

A checklist item's `state` is one of `todo` (the default), `doing`, `done`
(struck through) or `blocked` (waiting on something else).

## `group`

Blocks in a stack, under a heading. The way to give a screen parts.

```json
{ "type": "group", "title": "Steps", "blocks": [ { "type": "text", "text": "…" } ] }
```

| Field | |
| --- | --- |
| `title` | The heading. Optional. |
| `blocks` | The blocks in it. |

## `text`

A paragraph. Line breaks are kept; it is plain text, not Markdown.

```json
{ "type": "text", "text": "Cutting 1.2", "tone": "warn" }
```

| Field | |
| --- | --- |
| `text` | What it says. |
| `tone` | Optional. |

## `status`

One fact: a label and its value, the value in a pill. For a count, a state, a
version.

```json
{ "type": "status", "label": "Build", "text": "green", "tone": "ok" }
```

| Field | |
| --- | --- |
| `label` | What it is the value of. Optional. |
| `text` | The value. |
| `tone` | Colours the pill. Optional. |

## `list`

Items with a bullet, or numbered.

```json
{ "type": "list", "ordered": true, "items": ["Bump the version", { "text": "Tag it", "detail": "v1.2.0" }], "empty": "No steps." }
```

| Field | |
| --- | --- |
| `items` | Each a string, or `{ text, detail?, tone?, items? }`. `detail` is a dimmer line of small print after the text; `items` are held under it. |
| `ordered` | `true` numbers them. |
| `empty` | What is said when there are no items. Optional. |

## `checklist`

Items with a mark for their state. A todo list.

```json
{ "type": "checklist", "items": [ { "text": "Write the docs", "state": "doing" }, { "text": "Ship it", "state": "blocked", "detail": "after #1" } ] }
```

| Field | |
| --- | --- |
| `items` | Each a string (to do), or `{ text, state?, detail?, tone?, items? }`. |
| `empty` | What is said when there are no items. Optional. |

## Limits

A chat has at most 12 screens. Within one, text is cut at 2000 characters, a
list at 200 entries, the whole screen at a few thousand values, and all its texts
together at 100,000 characters.

Nesting is at most **seven levels**. A screen's blocks are the first level, and
each block in a group, and each item in an item, is one more; a list between two
of them is not a level. So a checklist of tasks inside three groups is four levels
and its tasks the fifth, which leaves two for sub-tasks. Count the groups before
you build a screen out of them: a board by project, milestone and owner uses
three.

What goes over any of these is cut between entries: the item or block that does
not fit is left out whole, and so are the ones after it. A list that had data
and keeps none of it is left out as well, with the block that holds it (and so
on up), so a screen never says "No tasks." of tasks it dropped. An entry that is
no data to begin with (`null`, `undefined`, a function) is only skipped: a list of
nothing else is an empty list, and its block stays. Nothing is cut in the middle,
so what stays is as you said it. More is cut, not refused. A screen is sent whole
to every open page with each change, so say what matters, not everything: cut a
long description before it goes in a block.
