# Settings

Settings open from the bottom of the sidebar, or `/settings`. There is a search
box at the top: it finds a setting by name or by what it does, in English or
German. Navigation runs down the left edge, in four groups:

| Group | Pages |
| --- | --- |
| **Models** | **Providers** — where models come from, see [Models and providers](/guide/models); **Defaults** — model, effort and context for new chats |
| **Agent** | **Tools**, **Images**, **Skills**, **MCP**, **Extensions** |
| **Reach** | **Channels**, **People** |
| **Portal** | **This browser**, **Add-ons**, **Shortcuts**, **About**, **Advanced** |

Plus a page for every extension that exposes configuration.

There is no Session tab. Model, effort and context all live on the pills under
the composer, and a second copy here would be two places to keep in sync.

## Defaults

*(The **Defaults** page; older links call it `general`.)*

Defaults for newly created sessions, and read-only deployment facts — the
executor, the workspace root, and where pi's `settings.json` lives.

The fields show **only your explicit overrides**. Leave one empty and it
inherits, with the inherited value shown as the placeholder. Clearing a field
hands the setting back to pi; clicking the active effort level again unsets it.

This matters more than it sounds. An earlier version prefilled each field with
the *resolved* value, so one click of Save pinned an inherited setting forever —
which is how a portal could end up permanently stuck on a model nobody chose.

**Notifications** are a switch on **This browser**, kept in this browser like
the confirmations. Turned on, the browser asks for permission once, and after
that a chat that finishes or an extension that needs an answer says so while you
are on another tab or window. Nobody is told about the chat in front of them.
It needs a secure connection — HTTPS, or `localhost` — because browsers do not
offer notifications over plain HTTP; the switch says so where it is unavailable.
A chat that is not open is noticed too: while one is running and notifications
are on, a hidden page keeps checking every fifteen seconds.

**Sign out**, also on **This browser**, appears when the portal has a password. It
signs out this browser only, and the login it held stops working anywhere a
copy of its cookie was taken. A login that runs out — after thirty days, or when
the portal restarts without `PORTAL_SECRET` — brings the password screen back
rather than failing every request with *Unauthorized*.

### Language

The portal speaks English and German. **This browser → Language** picks one,
and is kept in this browser like the theme; until one is picked it follows the
browser's own language, and English where there is none of its own. Dates and
numbers are written the language's way. It changes the portal's words only:
what the agent writes is up to the agent, and messages that come from the
server — an error it reports, a channel's own description — stay as they are.

A language is one file in `web/src/locales/`, mapping each English text to its
own; adding one means adding that file, and the tests list what it lacks.

### Where a model comes from

Resolved in order, first match wins:

1. The session's own choice, from the pill under the composer
2. A portal override, saved here in General
3. `PI_PROVIDER` / `PI_MODEL` / `PI_THINKING_LEVEL` in the environment
4. `defaultProvider` / `defaultModel` / `defaultThinkingLevel` in pi's `settings.json`
5. A last-resort constant

Steps 4 and 5 are the point: an install configured through the pi CLI behaves
the same in the portal without being configured twice.

::: tip Models from extensions
A model provided by an extension — anything under a `llama-server=…` provider —
does not exist until extensions are bound, which happens after the session is
created. The portal resolves the model a second time after binding. Without
that, a session asking for a local model silently started on pi's fallback.
:::

## Tools, Skills and MCP

**Tools** sets which tools every conversation starts with, see
[The interface](/guide/interface#tools). **Skills** lists, creates, imports and
switches the agent's procedures. **MCP** manages MCP servers, see
[MCP servers](/guide/mcp).

**Images** holds the image endpoint behind generation and editing, including the maximum picture size of an edit, see
[Opt-in features](/guide/features#image-generation). The tools themselves, `show_image`,
`generate_image` and `edit_image`, are in the Tools list, together in one **Images** group.

## Channels

Two-way links into the agent, and the packages that provide them. See
[Agent and channels](/channels/).

## Extensions

Install, update and remove pi packages, from npm, a git repository, a URL or a
local path. The list comes from the server's parsed view of `pi list` — the
browser used to re-parse it and listed some packages twice.

Any extension whose settings the server can recover gets its own page in the
navigation, with a field per key.

::: warning Recovered, not declared
pi publishes no schema for extension settings — extensions simply read keys off
the settings object. The portal recovers them by reading the package source,
which is a heuristic: a key built dynamically at runtime will not appear. Use
Advanced to edit `settings.json` directly when that happens.
:::

## This browser, Add-ons and About

**This browser** holds what is kept per browser: theme, animations, language,
notifications, the command character, confirmations and sign-out — see
[The interface](/guide/interface) and
[Slash commands](/guide/commands#the-command-character).
**Add-ons** installs the optional parts of the portal itself: Browser, Voice,
Subagents and Memory, see [Docker add-ons](/guide/add-ons) and
[Opt-in features](/guide/features). **About** shows where this portal runs the
agent, its workspace root and where pi keeps its files.

## Shortcuts

Every keyboard shortcut, in one list. The voice-mode ones can be changed: choose
**Change** and press the new keys, with any modifiers. **Clear** leaves an action
without one, **Reset** puts its default back, and **Reset all** puts back every
default. A key that another action already has moves to the one being changed,
and the list says which action lost it. Shortcuts are kept in this browser.

A shortcut is the physical key, so it stays the same key whatever the keyboard
layout, and it is shown with the label on this keyboard where the browser can
tell (Chromium can). The chat's own keys — the command character (`/` unless
you chose another, under **This browser**), Enter, Shift+Enter and Escape in
the message box — are listed there too, and are fixed.

## Advanced

pi's raw `settings.json`, edited in place. It is validated as JSON before
writing — a broken file stops every future session from starting, so an invalid
save is refused rather than accepted.
