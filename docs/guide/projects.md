# Projects

Every chat works in a folder. Most chats do not need one of their own, so there
is a single **Home**, and **New** starts a chat there. Home is the agent's own
directory: its SOUL.md, PrimaryUser.md and MEMORY.md are there, so in Home the agent
knows who it is and who it works for, and keeps its memory. A **project** is an extra
folder you make on purpose, with instructions for the agent in an AGENTS.md — and
only that — for work that should stay together.

## Home and New

**New** in the sidebar starts a chat in Home straight away: no dialog, no name.
The chat is called *New chat* until you send its first message, and is then named
after it (the first line, shortened). Rename it any time from the sidebar.

Home is the agent's directory, `AGENT_HOME` (`/data/agent-home` unless you set it) —
the same one the conversations on the Agent tab work in, so they share the agent's
SOUL.md, PrimaryUser.md and MEMORY.md, and anything the agent keeps in Home chats is
there for the others. It lives outside the workspace root, so it is not a project:
it is not listed on the Projects tab, has no instructions of its own and cannot be
deleted. If the agent has not been set up yet, Home has none of those files and its
chats start without them.

| Chat in | The agent has |
| --- | --- |
| Home | SOUL.md, PrimaryUser.md and MEMORY.md |
| A project | The project's AGENTS.md, and nothing of the agent's own |

## The Projects tab

**Projects** in the sidebar lists the projects — not Home — with how many chats each
has and when one last moved.

- **Click a project** to open its latest chat, or start one if it has none.
- **New project** asks for a name and, optionally, instructions, then creates the
  folder and opens a chat in it. "Cool Project" becomes the folder `cool-project`.
  A name that is taken, or `home`, is refused.
- **New chat here** (the plus on a row) starts another chat in that folder.
- **Instructions** (the document icon) edits the folder's instructions.
- **Delete** removes the project: its chats and its folder, after a confirmation
  that says how many chats and files go with it. It is refused while a chat in
  the project is running.

## Chats inside a project

In any chat, `/new` or `/clear` starts a fresh chat in the same project. The
sidebar shows each chat's full path under its title — Home is the agent's own
directory, a project is a folder under the workspace root.

Deleting a chat never deletes a folder. Folders are only made by **New project**
and only removed by deleting a project.

## Instructions

A project's instructions are the folder's `AGENTS.md`, which pi reads by itself
when a chat starts in it. The editor and the file are the same thing: edit it in
the portal or in the folder, whichever is nearer. Saving an empty text removes the
file. Home has none of its own.

Chats started after a change pick it up. A chat that is already open does after
`/reload`.

## Folders that already exist

Any folder directly under the workspace root, other than Home, is a project, whether
the portal made it or not, so folders and chats from before this existed are listed as they are.
The instructions are whatever AGENTS.md they already have.
