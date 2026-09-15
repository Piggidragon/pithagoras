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
draw. `notify`, `setStatus` and `setWidget` are one-way and do not open
anything.

An unanswered dialog times out after five minutes rather than wedging the
session forever.
