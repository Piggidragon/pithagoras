# Extensions

::: tip Looking for Browser or Voice?
Use **Settings → Add-ons**. See [Docker add-ons](/guide/add-ons) for setup instructions.
:::

Extensions are pi's own package system, not something the portal invented.
Anything you install is available to every session, and its slash commands
appear in the palette.

Do not confuse them with [channel packages](/channels/writing-a-channel), which
are a portal concept with a separate format and a separate install directory.

| | Extensions | Channel packages |
| --- | --- | --- |
| Owned by | pi | The portal |
| Installed with | `pi install` | The portal's installer |
| Live in | `~/.pi/agent` (`/data/home`) | `CHANNELS_DIR` (`/data/channels`) |
| Provide | Slash commands, skills, prompts, themes, model providers | Ways to reach the agent |

## Installing

Settings → Extensions. Four spec forms:

| Form | Example |
| --- | --- |
| npm | `npm:pi-llama-cpp` |
| git | `git:github.com/user/repo@v1` |
| url | `https://github.com/user/repo` |
| path | `/absolute/path/to/package` |

They persist across restarts, because `HOME` points at the data volume. **Update
all** upgrades everything; the bin icon removes one.

## Configuring

An extension that reads settings gets its own page in the settings navigation,
with one field per key. Values are written to pi's `settings.json`, which is
where extensions read from. Clearing a field removes the key rather than storing
an empty string, so the extension falls back to its own default.

The keys are recovered by reading the package source, not declared — see the
warning in [Settings](/guide/settings#extensions).

## What they can add

A package can contribute more than commands. `pi-llama-cpp` registers a **model
provider**, so a local llama-server appears in the model picker alongside hosted
models:

```
llama-server=http://192.168.1.101:8080 / qwen36-35b-a3b-mtp   64000 ctx
```

Those models only exist once extensions are bound, which is later than session
creation — the portal handles that, but it is worth knowing when a local model
seems not to stick.

## Built-in skills

The portal ships skills of its own, loaded from the image rather than installed,
so they are there without anyone adding them. They appear in Settings → Skills
under "Built in and from packages", read-only — editing one in place would be
lost on the next deploy without saying so.

There is one so far. **`skill-creator`** teaches the agent to write skills: the
format, the frontmatter and the ways it silently fails, how to split detail into
supporting files, and where to write one so it loads. Ask the agent to remember
a procedure and it has somewhere to put it.

::: tip A skills directory holds directories
pi treats any `.md` file sitting directly in a skills root as a skill in its own
right. A stray README there is reported as a broken skill — keep the root to
directories only.
:::

## Interactive commands

Extensions can ask questions. `ctx.ui.select`, `confirm`, `input` and `editor`
all render as a modal in the browser, standing in for the menu the TUI would
draw.

An unanswered dialog times out after five minutes rather than wedging the
session forever.

## What they say without being asked

Three of pi's UI calls expect nowhere in particular to put them, and each has a
place here:

| Call | Where it goes |
| --- | --- |
| `setWidget(key, lines)` | A block above the composer, one per key. Cleared by passing `undefined` |
| `setStatus(key, text)` | A line under the widgets |
| `notify(message, type)` | A message in the corner, which goes on its own — sooner for `info` than for `error` |

A widget may be a component rather than lines, and pi's contract is that the
component is registered once and repaints itself afterwards. That works: the
block follows it. What arrives is the text it drew, with the colour taken out —
it sits in a page, not a terminal.

`setTitle` is delivered and nothing reads it yet.

## Extensions that draw their own screen

The four shapes above are the ones pi names. An extension that wants something
else — a tree, a diff, a form, a picker with its own rules — builds it out of
[pi's TUI components](https://github.com/earendil-works/pi-mono/tree/main/packages/tui)
and shows it with `ctx.ui.custom()`. There is no list of those to support: each
one is its own screen, and the author can write a new one tomorrow.

So the portal does not re-implement them. It runs the component and shows you
what it drew:

```ts
const choice = await ctx.ui.custom<string | null>((tui, theme, keybindings, done) =>
  new MyComponent({ theme, keybindings, onSelect: done, onCancel: () => done(null) }),
);
```

The component runs on the server against pi's own theme and key table. Each time
it redraws, the screen it produced is sent to the browser and written into a
terminal in the dialog; each key you press goes back as the byte sequence a
terminal would have sent. Arrows, tab, ctrl+c, escape and anything else the
component listens for arrive as themselves, so a component written for the TUI
years ago behaves here the way its author intended.

The dialog is as tall as what was drawn, and closes itself the moment the
component calls `done()`. The ✕ answers for it — as a cancelled dialog, the same
as pressing escape in a menu that offers it — for a screen that does not end on
its own.

Two differences from a terminal are worth knowing:

- **Overlays stack instead of floating.** A component that puts something on top
  of itself gets it drawn underneath instead. It is visible and usable; it is not
  in the same place.
- **The cursor is the component's own.** Components draw their cursor into the
  screen, so the terminal's hardware cursor stays hidden — which is what pi does
  by default too.

## Tools that draw their own row

A tool can ship `renderCall` and `renderResult` — pi-tui components drawn in
place of the generic `◆ name {args}` row. That is where an extension puts the
part a one-line summary cannot carry: `pi-web-access` draws its search sources
there, which is why a search here used to show none.

The portal asks the tool to draw and shows what comes back, in the transcript
under the row. Colour survives, bent into a range that reads against the page
rather than against a terminal's background, and a terminal hyperlink becomes a
link you can follow.

pi's renderers are told whether the row is open, and most draw a thin line when
it is not — for a search, one status line. Both views are drawn on the server,
so **More** opens instantly and still works on a conversation reopened long
after the tool that drew it was uninstalled. A tool that ignores the flag draws
one thing and gets no **More**.

Very long output is cut off rather than written into the event log whole.

Under that sits **N sources** — where the tool says it got something from, as a
count and a row of site icons, opening to the list. And under that, **output**,
folded away like a thinking block: what the tool actually returned, which is
what the model was given. Long output is cut off for the page; the model still
got all of it.

Sources are read out of the output, so any tool that cites gets them, not just
a search. A link counts only where the tool put it in the position of a
citation — alone on its line, or behind a word like `Source:`. A link sitting
inside a sentence belongs to the page that was fetched, not to a claim about
where anything came from, and listing those would turn one fetched page into
forty citations it never made.

The icons are each site's own favicon, asked for directly. No third-party icon
service: that would tell someone else every domain the agent read, and the
point of running this yourself is that nobody is told. A site without one gets
its initial.

::: warning Only host sessions
Everything on this page that runs a component — a drawn screen, a widget built
from one, a tool's own row — needs the component to run in the portal's own
process. A session on the container executor reaches pi over RPC, which has no
component to run: `ctx.ui.custom()` returns `undefined` there, the same answer
pi's own RPC mode gives, and tool rows stay generic. A channel conversation has
no screen to draw on either, so one opened there is left unanswered until it
times out.
:::
