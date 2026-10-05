# Devices

A **device** is one of your own computers, paired with the portal through the
**Pithagoras Sync** client that runs on it. A chat you give a device to can
read and change files there and run commands, as far as the device's own
settings let it. The settings live on the device, not in the portal: the
portal can see them, and change them only where the device's owner allowed
that on the device.

Devices are an add-on, **off** in a fresh install. While it is off, nothing
about devices answers: no device can pair or connect, and paired ones wait
until it is on again.

## Switching it on

**Settings → Add-ons → Devices.** The switch needs a portal password: a portal
that runs without one (`PORTAL_ALLOW_NO_PASSWORD`) cannot switch it on, as a
paired computer would be open to anyone who reaches the portal. Once it is on,
**Devices** is in the sidebar.

A reverse proxy that asks for its own login in front of the portal stops a
computer from pairing: its requests to `/sync/v1/pair` and `/sync/v1/connect`
would be sent to the proxy's login page. Until proxies are supported, let the
portal's password be the login and let the proxy pass the portal on.

Switching it off closes every device's connection and cancels an open pairing
code. The devices stay paired, and connect again by themselves once it is on.

## Pairing a computer

1. Install the client on the computer: the **Devices** page links to the
   newest release for Linux and Windows (the client's README has the rest).
   Run it as the user whose files the chats should reach, or better as a user
   of its own.
2. On the **Devices** page, press **Pair a device**. The portal shows an
   eight-character code, good once, for ten minutes. Ten wrong codes, from
   anywhere, cancel it.
3. Copy the command under the code and run it on the computer:

   ```sh
   pithagoras-sync pair 'pithagoras-sync://pair?portal=https%3A%2F%2Fportal.example&code=K7Q2M9XZ'
   ```

The link carries the portal's address as the page was opened, so open the
portal at the address the computer reaches it at. The client talks to the
portal only over HTTPS, or plain HTTP to an address on its own machine
(loopback). When the portal serves HTTPS itself (`PORTAL_TLS_CERT`, `PORTAL_TLS_KEY`) and the
page was opened over HTTPS, the link also carries the certificate's pin
(`spki=`), so a self-signed certificate works and no other one does. Behind a
TLS proxy there is no pin, and the computer checks the proxy's certificate
against its system's certificate authorities.

The code is shown only on the page that made it. Reloading the page says a
code is open, and until when; make a new one to see one again. A new code
replaces the old one.

The device asks for a name (by default its host name). When the name is
already taken, it gets a number (`laptop-2`): a computer that is paired again
after `pithagoras-sync unpair` is a new device to the portal, and the old entry
can be removed.

## The list

Each device shows whether it is **connected**, or when it was last seen; its
system and the user the client runs as; the client's version; its **mode**:

- **Ask**: every call asks you first.
- **Folders**: only in the folders the device grants, with commands only where
  a folder allows them.
- **Full**: everything the client's user can do, with the device's protections
  (protected paths, risky commands, untrusted chats) still asking.

and the tools it offers. A device that is the portal's own machine and user is
marked as such: a chat reaches nothing there that the portal's own tools do
not, so it is not offered to chats.

**Rename** with the pencil. **Remove** with the bin: the device's token stops
working, its connection is closed at once, and every chat loses it. To use the
computer again, pair it again.

When something else tries to connect with a device's token while the device is
connected, it is refused, and the device shows a warning. If that was not you
(a second copy of the client, say), remove the device and pair it again.

## Giving a chat a device

A chat reaches no device until you give it one. In the chat's header, beside
the browser's globe, the **laptop** button lists the paired devices, each with
a dot that says whether it is connected:

- The switch gives the chat that device, or takes it back. Only a connected
  device can be given, and not the portal's own machine.
- The folder under it is where the chat starts on the device: relative paths
  and commands begin there. It starts as the device's home, or in **Folders**
  mode as its first folder; type another, or pick one of the device's folders.
  In Folders mode only a folder the device offers is taken.

Each chat has its own devices, and a new chat has none. The button is only in
chats of the portal itself: a chat on a channel (Telegram, say) cannot answer a
device's questions, so it gets none. A chat that is working takes a change up
once its current run is over.

### What the agent can do there

Once a chat has a device, the agent's `read`, `write`, `edit` and `bash` take a
`device`: with it they act on that computer, without it on the server, as
before. `grep`, `find` and `ls` act only on a device. The agent is told which
devices the chat has and their folders; a call on a device shows the device's
name on its card in the chat.

- `~` is the device's home, and a relative path starts in the chat's folder
  there. On Windows, `C:\Users\x` is written `/c/Users/x`; the agent may use
  either.
- `bash` runs the device's own shell, in the device's own environment: nothing
  of the portal's environment goes along.
- `edit` writes back only if the file did not change on the device since it
  was read; otherwise the agent is told to read it again.
- Nothing falls back to the server: a device the chat does not have, one that
  is not connected, or one that switched a tool off is an error that names the
  devices the chat has.

Other tools, subagents, background jobs and MCP tools always act on the server.
A call of another tool that names a device is refused, and so is any call on a
device for somebody who is not the primary user (a colleague in a shared
conversation): the computers are yours.

When the last device is taken back, the tools stay as they are for the rest of
the chat's session and refuse a `device`; `grep`, `find` and `ls` go away
again. When the chat is deleted, or the device removed, the grant ends too, and
the device forgets what it allowed the chat.

If another installed extension brings a tool of one of these names, that chat
cannot be given a device, and the button says why.

## Approvals

A call that the device holds for your answer is asked in the chat that made it,
as a question over the chat, and shown under the device on the **Devices**
page, with what it wants to do and why the device asks:

- **Allow once**: this call.
- **Allow for this chat**: this call and more of its kind from the same chat,
  for as long as the device's settings say. Offered only for Ask mode's own
  question.
- **Allow for** *n minutes*: the same, for a time; no longer than the device
  allows.
- **Deny**.

The first answer wins, from the chat, the Devices page or the device itself
(`pithagoras-sync approve 12`, `deny 12`). An approval that nobody answers is
denied when the device's time for it runs out (two minutes unless the device
says otherwise). Approvals are asked only in the portal and on the device: a
chat on a channel (Telegram, say) cannot answer one.

## Settings

Under each connected device, **Settings** shows the device's settings, as the
client's `portal_policy` allows:

- `off`: the portal sees nothing of them.
- `read` (the default): shown, not changed.
- `write`: the portal may change them. **Mode** and the tools have controls of
  their own; everything else is changed in the text below them. **Save on the
  device** sends the whole document with the version it is based on: when the
  settings changed on the device meanwhile, the save is refused and nothing
  changes. The device checks every value, and refuses changes to the settings
  it lists as its own (**Only the device changes**).

`portal_policy` itself, the pairing, the shell, sudo's path and the elevation
password are never in the document, and only the device's owner changes them,
on the device. The client's settings are described in its
`docs/permissions.md`.

What a device decided about a call (allowed, asked, denied) is in the portal's
[audit log](/guide/sessions#audit) as **Device**, with the device's name.

## What is trusted

A device trusts the portal it is paired with. The portal is a server you run;
whoever controls it controls what it asks of every connected device, within
each device's own settings. In particular:

- **A compromised portal is the same as Full mode on an Ask device.** Approvals
  are answered in the portal, so whoever controls the portal can answer them.
  The protections that stay are the ones the device enforces itself: its mode's
  folders, its denied paths and command rules, its hours, the tools it has
  switched off, and the settings only it may change. A device that must not be
  reachable from a compromised portal should not be paired.
- **No chat reaches a device without a grant,** and only the chats you give
  one: each call names the chat, and the device keeps what it allowed per chat.
  The device is also told whether the portal's guard saw the chat read
  something untrusted (see [Prompt injection](/guide/security)); it can only
  make the device more careful.
- **The sudo password stays on the device.** Elevation (Linux `sudo`, off by
  default) uses a password stored on the device; it is never sent to the
  portal or the agent, and a command run with it always asks.
- **The connector token is the device's login.** The portal stores only its
  hash and compares it in constant time; the device keeps it in a file only its
  user can read. Removing the device makes it worthless at once.
- **The pairing code is the pairing's login.** Single use, ten minutes, ten
  wrong attempts in all. Pairing and the device's connection are refused from a
  browser (any request that names an `Origin`), so a web page cannot spend a
  code or open a device's connection.
- **One connection per device.** A second connection with the same token is
  refused while the first is up, so a copied token cannot push the real device
  off; the attempt is shown on the Devices page.
- Messages on the device's connection are limited to 4 MiB, file transfers to
  64 MiB, and a command's output to what the device allows (16 MiB by default).
  Nothing in a call carries environment variables to the device.
- The portal logs pairing and removal by device name only; tokens and codes
  never reach a log.
