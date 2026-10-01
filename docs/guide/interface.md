# The interface

What the portal does in the browser, apart from the chat itself. Everything on
this page is kept **in this browser** — the theme, the language, the
confirmations, the shortcuts — so a phone and a laptop can differ without one
changing the other. The exception is the tools switched off by default, which
the server keeps.

## Install it as an app

The portal is a progressive web app. Chrome, Edge and Safari offer **Install**
(or **Add to Home Screen**) in the address bar or share menu, and it then opens
in its own window with no browser chrome. The app's title bar follows the
portal's theme, and its icon offers **Sessions** and **Projects** as shortcuts.

Browsers install an app only over **HTTPS or on `localhost`**. Behind
Tailscale, `tailscale serve` gives the portal a certificate; over plain
`http://` on a LAN address the browser will not offer it.

When the server is out of reach — restarting, or the phone is off the VPN — the
installed app still opens, from the last page the server gave, and says the
server cannot be reached, as a tab does. Nothing the agent does is cached: the
API and the agent's browser view always go to the server. A deploy shows up on
the next load rather than the one after.

## Theme

**Settings → This browser → Theme** is light, dark or **System**, the default,
which follows the machine and changes with it — at sunset, on a desktop that
flips.

## Language

English and German. See [Settings → Language](/guide/settings#language).

## Phone and narrow windows

On a phone the sidebar's rail gives way to a compact layout with larger
touch targets. The same pages and settings are there; nothing is left out.

On a wide screen the chat's panels — the browser, the terminal, Files, Git,
canvases — dock beside the conversation, each on its own side. See
[Files](/guide/files#panels) and [Session canvases](/guide/canvases).

## Confirmations

Deleting a session, a project, a routine and the like asks first. **Settings →
This browser → Confirmations → Ask before deleting** turns the question off.
It is kept per browser deliberately: a phone that trips over a delete button is
not made safer by the laptop having turned the question off.

## Notifications

See [Settings](/guide/settings#defaults). They need HTTPS or
`localhost`.

## Tools

Every tool an extension, an MCP server or pi itself offers can be switched off,
in two places:

- **Settings → Tools** sets what **every** conversation starts with. A tool
  switched off there is not offered to the model at all; the extension stays
  installed and its slash commands keep working. Tools are listed once a
  conversation has run, because that is when pi builds the list of what its
  extensions registered. A group can be switched off as a whole, and each
  package can be given a name of your own — *Rename* — for the list.
- **Projects → Tools** on a project's row sets what every chat in that project starts
  with, against the portal-wide default; see [Projects](/guide/projects#tools).
- The **tools** control of a chat switches them for that chat only, from its
  next message. It is there before the first message too, so a tool can be
  kept away from a chat from the start.

Both are safety tools as much as convenience: a browser or shell tool that a
chat has no business with is simply not there to be talked into.

## One server per data directory

Two portals on the same data would each mark the other's running chats as
interrupted. The server therefore holds a socket inside its data directory
(`portal.sock`), and a second one started on the same data exits with a
message instead of failing on the port. A socket left behind by a server that
ended is replaced. This includes a server the agent starts from a chat with
another `PORT`.

## Keyboard shortcuts

**Settings → Shortcuts** lists them, and the voice-mode ones can be changed —
see [Settings](/guide/settings#shortcuts).
