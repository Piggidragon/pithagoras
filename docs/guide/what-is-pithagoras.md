# What is Pithagoras

Pithagoras is a web front end for the [pi coding agent](https://pi.dev). You
point it at a directory, describe a task, and close the tab. The work carries on
without you, and the transcript is waiting when you come back.

That last part is the whole design. A prompt is accepted, not awaited — the HTTP
request returns as soon as pi has taken the message, and the run continues under
the server's ownership. Everything pi emits is appended to a SQLite event log,
so a browser that reconnects an hour or a week later replays from its last seen
position rather than discovering it missed the interesting part.

## What it is not

It is not a sandbox by default. The host executor runs pi as a child of the
portal with the portal's own permissions, working directly on mounted
directories. That is fast and simple, and it assumes you trust the tasks you
submit. A container executor exists for stricter isolation — see
[Architecture](/reference/architecture#executors).

It is also not multi-tenant. There is one password, and anyone who knows it gets
the same view. Run it somewhere private; Tailscale is the setup it was built
against.

## The pieces

**Sessions** are the normal unit of work: one workspace directory, one
conversation, its own model and effort level. You create them, they persist, you
pin the ones you keep coming back to. See [Sessions](/guide/sessions).

**The agent** is a single long-lived session rooted at a fixed directory
(`agentHome`), reachable from outside the portal through channels. Where sessions
are per-task, the agent is continuous. See [Agent and channels](/channels/).

**Channels** are two-way links into that agent — Telegram, a webhook, whatever
you write. Messages arrive through a channel and replies go back the same way,
and every channel points at the same conversation. Channel types are packages,
so adding one is installing a repo rather than patching the portal. See
[Writing a channel](/channels/writing-a-channel).

**Extensions** are pi's own package system. Anything you install shows up in the
portal's slash command palette, interactive menus included. See
[Extensions](/guide/extensions).

**Panels** sit beside the chat: [Files](/guide/files), [Git](/guide/git), a
[terminal](/guide/terminal) with background jobs and subagents, and
[canvases](/guide/canvases). Each docks on its own side.

**Models** are set up from Settings, without editing files — see
[Models and providers](/guide/models). **Voice** talks to the agent with local
speech recognition and synthesis ([Voice control](/guide/voice)), and the
agent's own [browser](/guide/browser) and an [Understory memory](/guide/memory)
are optional add-ons. The portal installs as an app and speaks English and
German — see [The interface](/guide/interface).

## Status

Honest state of things, so you know what you are getting:

| Area | State |
| --- | --- |
| Sessions, workspaces, transcript replay | Working |
| Model and effort per session, surviving restarts | Working |
| Slash commands — builtin, extension, prompt, skill | Working |
| Files, Git, terminal, canvases, voice, model providers | Working |
| Settings, extension config, package management | Working |
| Channel packages: loading, installing, configuring | Working |
| The channel supervisor — starting them, routing replies | Working |
| The builtin packages against real Telegram/Slack/Discord | Untested |

Channels start, resolve each conversation to its own session, and carry the
reply back. What has not happened is a connection to a real Telegram, Slack or
Discord account — that needs credentials I could not test with, so treat the
first one you configure as the real trial.
