# Opt-in features

Two capabilities ship with Pithagoras and are **off** until you switch them on
in **Settings → Add-ons**: a **subagent tool** and **Understory** as the agent's
memory. A fresh install has neither. Switching one on writes it into pi's own
configuration — a package, an MCP server — so it can also be seen, and undone,
from Settings → Extensions and Settings → MCP. Switching it off removes it.

Each is a reference implementation behind a seam the portal already has, so a
third-party equivalent can take its place without changing the portal:

- the subagent tool speaks the [subagent protocol](/guide/extensions#the-subagent-protocol);
  any extension that does is shown and steered the same way;
- Understory is an [MCP server](/guide/mcp); any memory server can be attached
  the same way.

A switch reloads the idle open chats so they have the change at once. A chat
that is busy — running, compacting, or with a subagent still working in the
background — keeps what it had until it is idle and reloaded (`/reload`).

## Subagents

**Settings → Add-ons → Subagents.** The `subagent` tool hands a self-contained
task to a second pi with a context of its own and gets its answer back. You can
watch it beside the chat (the robot button in the chat's header), give it
instructions while it works, and stop it.

Switching it on installs the bundled `extensions/subagent` folder as a local pi
package; switching it off removes it. One you installed by hand from a clone is
recognised as the same tool.

### How it runs against the agent

| Mode | What happens | When to use it |
| --- | --- | --- |
| **Interrupt** (default) | The tool call waits for the subagent's answer, so the agent's turn is held while it runs. Subagents asked for together run one after the other. | Local hosting, a single GPU: only one model call at a time. |
| **Background** | The tool call returns at once and the agent goes on working. The subagent's answer arrives later as a message in the chat and starts a turn if the agent is idle. A subagent you stop does not start one. | Hosted models, or hardware that can serve two agents at once. |

Background runs two agents — two model processes — at the same time. With a
local model that means two model calls at once, which a single GPU may not
hold. Stopping the chat does not stop a background subagent; stop it from its
window. Closing or reloading the chat does.

The choice is stored as `subagentMode` in pi's `settings.json` (`"background"`,
or absent for interrupt), so the tool behaves the same when pi runs outside the
portal. `PI_SUBAGENT_BIN` picks the `pi` it starts (default: `pi` on `PATH`).

Subagents need the host executor (`EXECUTOR=host`): only there does the portal
share pi's event bus with the tool.

## Memory: Understory

**Settings → Add-ons → Memory.** [Understory](https://github.com/thecodacus/understory)
is a memory that grows: plain markdown on disk, cross-linked and maintained,
which the agent looks things up in and adds to through its tools
(`understory_memory_query`, `…_add`, `…_update`, `…_status`, `…_maintain`).
The bundle is human-readable and git-diffable, and Understory's own web UI
browses it (*Browse the memory* on the Memory tab).

Switching it on:

1. installs `pi-mcp-adapter` if it is not installed yet, which makes MCP servers
   into tools;
2. writes an `understory` server into `mcp.json`, with its tools directly in the
   agent's tool list;
3. stops reading `MEMORY.md`.

Switching it off removes the server, and `MEMORY.md` is read again.

### MEMORY.md while it is on

Understory **replaces** the agent's global memory, so the two do not both feed
the agent: while the `understory` server is in `mcp.json` and not disabled,
`MEMORY.md` in the agent's home is not handed to new chats, and the agent is
told to use its memory tools instead. The file is not deleted, and it is marked
as not read on the Agent page. Disabling the server in Settings → MCP counts as
off too.

Only conversations with the primary user ever had `MEMORY.md`; a teammate's
conversation cannot use the memory tools unless a rule allows it (see
[Roles](/people/roles)).

### Running Understory

Understory runs as a container of its own; the portal only points the agent at
its MCP address. It needs a model to maintain the memory — any
OpenAI-compatible endpoint, a local one included.

```yaml
services:
  understory:
    image: ghcr.io/thecodacus/understory:latest
    ports: ["3800:3800"]
    volumes: [understory-memory:/bundle]
    environment:
      BUNDLE_ROOT: /bundle
      LLM_API_BASE_URL: ${LLM_API_BASE_URL}
      LLM_API_KEY: ${LLM_API_KEY}
      LLM_API_FORMAT: openai
      LLM_MODEL: ${LLM_MODEL}
      # AUTH_TOKEN: ${MEMORY_UNDERSTORY_AUTH_TOKEN}
    restart: unless-stopped
volumes:
  understory-memory:
```

The address is what the **portal** reaches: `http://localhost:3800/mcp` with
the shipped compose file's host networking, or `http://understory:3800/mcp` on
a shared Docker network. It can be changed on the Memory tab.

| Variable | Default | Meaning |
| --- | --- | --- |
| `MEMORY_UNDERSTORY_URL` | `http://localhost:3800/mcp` | The address the Memory tab starts from. |
| `MEMORY_UNDERSTORY_AUTH_TOKEN` | — | Sent as `Authorization: Bearer …` when Understory has an `AUTH_TOKEN`. Named in `mcp.json` (`bearerTokenEnv`), never copied into it. |
