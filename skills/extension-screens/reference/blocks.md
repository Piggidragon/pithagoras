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
list at 200 entries, nesting at a few levels, the whole screen at a few thousand
values, and all its texts together at 100,000 characters (the rest of a text that
crosses that is cut, and the texts after it are left out): more is cut, not
refused. A screen is sent whole to every open page with each change, so say what
matters, not everything: cut a long description before it goes in a block.
