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
## Switching tools off for one chat

The blocks icon in the composer says which tools the agent may reach for **in
this conversation**. "Look this up for me" and "do not go online, just read the
repo" are both reasonable in the same week.

Tools are grouped by what installed them, so a package can be switched off in
one go. An MCP server is its own group rather than a share of the adapter that
attached it — three servers used to arrive as one pile of forty tools called
`pi-mcp-adapter`, and nobody thinks of them that way.

::: tip The browser is one of them
It used to have a switch of its own beside the composer, which was a second
answer to a question the tools list already asked — and the two could
disagree. It is now an MCP server like any other: its tools are in the list,
switched one at a time or as a group, with a default like anything else.
Having its tools is having the browser, so a conversation with them all off is
not offered them and does not reach the container. Where it may go once it is
there is still the [allowlist](/guide/browser#where-it-may-go)'s question, not this one.
:::

It takes effect from the next message — pi is told at once and there is no need
to restart the conversation — and it is remembered per chat, including across a
restart.

The groups start shut, in both places. A handful of extensions is sixty tools,
and sixty checkboxes is not a list anybody reads; each closed group says how
many of its tools are off, which is the only thing worth knowing from outside
it. The ones you open stay open, here and in the settings — they are the same
groups asked about at two scopes.

### And what every chat starts with

Per chat is right for "not this time" and wrong for "hardly ever" — nobody
wants to turn the same tool off at the start of every conversation. **Settings
→ Tools** has the other half: which tools a conversation starts with.

A chat may still disagree with the default in either direction, and the row
says so where it does. What a chat stores is only its disagreement, so changing
a default reaches every conversation that never said anything about that tool —
including the ones open right now.

The list there is what the portal has seen a session register, not what is
loaded this second: pi builds its registry when a conversation starts, and
having to open a chat before you could say "off everywhere" would be the wrong
way round. It fills in as soon as any conversation has run.

A switch for a tool that is not loaded right now is kept, so reinstalling an
extension does not quietly bring back something you turned off.

::: tip Not the same as uninstalling
The extension is still loaded, its commands still work, and other chats are
unaffected. The tool is simply not offered to the model in this one.
:::

