# Memory and audit

Two pages in the sidebar for looking at what the agent knows and what it was
allowed to do.

## Memory

**Memory** appears in the sidebar while the [Understory memory add-on](/guide/features#memory-understory)
is on. It is the web view of the agent's memory: a bundle of markdown notes,
kept in folders and linked to each other.

**Notes.** Down the side, the folders and notes with their types, and a search
(*Search the memory*). Above them, the count of notes and folders and whether the
bundle is *conformant* to Understory's format; when it is not, the issues are
listed. Choose a note to read it: its type, tags, when it last changed, its text,
and links that open other notes here.

**Log.** What changed in the memory, newest first.

**Graph.** Every note is a point coloured by its type, its links are lines, and
notes nothing links to are ringed in red. **Query paths** shows the routes
Understory's own queries took. Drag to move, scroll or the zoom buttons to zoom,
click a note to open it.

What is open is in the address (`/memory?note=…`, `?view=log`, `?view=graph`), so
it can be linked to.

### Editing

In the Understory the portal runs, a note can be edited (title, type,
description, tags, text) or deleted from the pencil and bin over it. After a
change a window says what Understory's checks find — a link to nothing, a note
nothing links to, an index that misses something — and offers:

- **Rebuild the index** — every folder's `index.md` written anew, empty folders
  removed. No model.
- **Repair with the model** — the model mends links to nothing and wires in
  orphans. Only offered when there is something to repair; it takes as long as
  the model needs and costs tokens.

**Clear the log** empties the record of changes and the query paths; the notes
stay. **Clear the memory** deletes every note and folder and starts as a new
memory does. Both ask first and cannot be undone. A memory run elsewhere is read
only here.

Setting Understory up — installing it, choosing the model that tidies it, the
nightly pass — is in [Opt-in features](/guide/features#memory-understory).

## Audit

**Audit** is always in the sidebar. It answers *what has my agent been asked to
do this week*: every time the guard refused something, let something through, or
turned someone away. See [People](/people/) for who is allowed what.

The page lists the latest decisions, newest first, updating every ten seconds
while it is visible. It shows counts of *refused*, *allowed* and *turned away*,
and filters:

| Filter | Shows |
| --- | --- |
| Everything | All of it |
| Refused | What the guard stopped |
| Allowed | What went through on a rule or an approval |
| Strangers | People turned away |

Each row has its kind — *Refused*, *Allowed by rule*, *Allowed by approval*,
*Turned away*, *You answered* or *Page opened* — who it concerned, when, the tool
and what it was aimed at, and the reason. A rule that never shows up here is not
pulling its weight; a person turned away often may be worth a
[role](/people/roles).

The page loads the last 300 decisions, of up to 2,000 kept (`GET /api/audit`).
