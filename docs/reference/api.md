# HTTP API

Everything the web UI does goes through this API, so anything the UI can do you
can script.

All routes are under `/api`. Everything except `/api/auth/*` requires the login
cookie.

```bash
curl -s -c jar -X POST localhost:4100/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"password":"…"}'

curl -s -b jar localhost:4100/api/sessions
```

## Auth

| | |
| --- | --- |
| `GET /api/auth/status` | `{ authRequired, authed }` |
| `POST /api/auth/login` | `{ password }` → sets the cookie |

## Workspaces

| | |
| --- | --- |
| `GET /api/workspaces` | `{ root, workspaces: [{ name, path, isGit }] }` |
| `POST /api/workspaces` | `{ name }` → creates a directory; the name is slugified |

## Projects

The folders made on purpose for chats to work in: every folder directly under the
workspace root. Home, where chats start, is the agent's directory and not one of
them. See [Projects](/guide/projects).

| | |
| --- | --- |
| `GET /api/projects` | `{ root, projects: [{ name, path, isGit, hasInstructions, sessions, lastActive }] }` |
| `POST /api/projects` | `{ name, instructions? }` → creates the folder (slugified) and writes `AGENTS.md` if there are instructions; 409 if it exists, 400 for `home` |
| `GET /api/projects/:name` | The project plus `{ files, bytes, complete }` — what deleting it would remove |
| `GET /api/projects/:name/instructions` | `{ text }` |
| `PUT /api/projects/:name/instructions` | `{ text }` → writes `AGENTS.md`; blank removes it. |
| `DELETE /api/projects/:name` | Deletes its chats (with their conversation files) and its folder; 409 while one is running |

## Sessions

| | |
| --- | --- |
| `GET /api/sessions` | `{ sessions, executor }` — pinned first, then most recent. Task sessions only. |
| `GET /api/agent/sessions` | `{ sessions, agentHome }` — conversations reached through a channel, each with the channel that owns it |
| `POST /api/sessions` | `{ workspace?, title? }` — no workspace means Home, the agent's directory; no title means "New chat", replaced by the first message |
| `GET /api/sessions/:id` | One session |
| `PATCH /api/sessions/:id` | `{ title?, pinned? }` |
| `DELETE /api/sessions/:id` | Stops it if running, then deletes it, its events and pi's conversation file for it (in `SESSION_DIR`). The folder it worked in is left alone. |

A session:

```json
{
  "id": "12_A1zVAa2rk",
  "title": "test-project",
  "workspace": "/workspaces/test-project",
  "executor": "host",
  "status": "idle",
  "pinned": false,
  "live": true,
  "created_at": "…",
  "updated_at": "…",
  "last_error": null
}
```

`status` is one of `idle`, `running`, `error`, `interrupted`. `live` is whether
a pi process is up right now, which is not the same thing — an idle session can
still be live.

## Files

The files in the folder a session works in, whether that is a project, the
workspace root or Home. Every path is relative to that folder; one that leads
out of it, by `..` or by a link, is refused with 400.

| | |
| --- | --- |
| `GET /api/sessions/:id/files?path=` | `{ path, entries: [{ name, type, link?, size, mtime }], truncated }` — `type` is `dir`, `file` or `link` (a link that leads out of the folder or nowhere); `link: true` marks every link, including one to a folder inside this one that is listed as a `dir`. Folders first; `.git` is left out; at most 2,000 entries |
| `GET /api/sessions/:id/file?path=` | `{ binary: false, size, mtime, content }`, or `{ binary: true, size, mtime }` for what is not text or is over 1 MB |
| `GET /api/sessions/:id/file?path=&download=1` | The file, as a download |
| `PUT /api/sessions/:id/file?path=` | `{ content, mtime? }` → saves it. With `mtime`, the time it was read at, the save is refused with 409 if the file has changed since. 413 over 1 MB |
| `PATCH /api/sessions/:id/file?path=` | `{ name }` → gives a file or folder another name in the same folder, and answers `{ path }`. 400 for a name with a `/` or `\`, or `.` or `..`; 409 if the name is taken. A link is renamed as the link |
| `DELETE /api/sessions/:id/file?path=` | Removes a file, or a folder and all in it; a link is removed as the link. The folder itself is refused |
| `GET /api/sessions/:id/archive?path=` | The folder — or, with `path`, a folder in it — as a `.tar.gz`, without `node_modules`, `.git`, `dist`, `build` and virtual environments. If `tar` cannot run the answer is a 500; if it fails part-way the download is cut off, so it does not end as if it were whole. A file that changes while it is read is not a failure |

## Prompting

| | |
| --- | --- |
| `POST /api/sessions/:id/prompt` | `{ message }` |
| `POST /api/sessions/:id/abort` | Stop the current run |
| `POST /api/sessions/:id/ui-response` | `{ id, value?, cancelled? }` — answer an extension dialog |
| `GET /api/tools` | `{ tools, off }` — every tool the portal has seen, and which are off by default |
| `PUT /api/tools` | `{ off: string[] }` — the default for every conversation; applied to the running ones too |
| `GET /api/sessions/:id/tools` | `{ tools, live, off }` — every tool the conversation could use and whether it is on. `live` is false when pi is not running to be asked |
| `PUT /api/sessions/:id/tools` | `{ off: string[] }` — switch tools off by name; everything not named is on |

`prompt` returns as soon as pi accepts the message, **not** when the work
finishes. Watch the event stream for progress.

A message matching a portal builtin is handled without reaching the model — see
[Slash commands](/guide/commands).

## Events

```
GET /api/sessions/:id/events?since=<seq>
```

Server-sent events. Replays everything after `since`, then tails live. Each
message is one event:

```json
{ "seq": 78, "type": "portal_notice", "payload": { "text": "…" } }
```

Track the highest `seq` you have seen and pass it as `since` when reconnecting.

::: warning Negative seq
Live-only events — extension dialogs — carry a negative `seq`. They are never
persisted, so they must not move your cursor. Ignore anything `<= 0` when
tracking position, or reconnecting will skip real history.
:::

Types worth knowing: `portal_prompt`, `portal_status`, `portal_notice`,
`agent_end`, `extension_ui_request`, `extension_ui_cancel`, `extension_error`,
`stderr`, plus everything pi emits.

## Session config

| | |
| --- | --- |
| `GET /api/sessions/:id/config` | `{ state, thinking, models, stats, contextLimit }` |
| `POST /api/sessions/:id/config` | `{ provider?, modelId?, thinkingLevel?, autoCompaction?, autoRetry? }` |
| `PUT /api/context-limit` | `{ provider, model, tokens }` — the context window this model really has here; `tokens: null` goes back to the default, or the model's own |
| `PUT /api/context-default` | `{ tokens }` — a ceiling on the window of every model; `null` removes it. Also returned by `GET /api/settings` as `contextDefault` |
| `POST /api/sessions/:id/compact` | Compact now |
| `GET /api/sessions/:id/commands` | The slash command palette |

`GET` does not start pi. While it is not running the response is `live: false`
with the stored model and effort, empty `thinking` and `models`, and
`stats: null`; once it is, it carries context usage and token counts.

When pi is running, the response also has `contextLimit`, the window set with
`PUT /api/context-limit` or `null`, and `contextDefault`, the ceiling from
`PUT /api/context-default`. Both apply to open chats at once, and `contextLimit`
is per model rather than per chat. `contextLimitSupported` is `false` when pi
cannot be given a window (see below). None of the three is in the `live: false`
response.

With `EXECUTOR=container` both `PUT` routes answer 400: pi runs in the container
behind an RPC client, and the portal cannot change the model it measures
against. `tokens` must
be a whole number from 1,024 to 10,000,000.

`POST` returns `{ ok, applied, state }`, where `applied` lists what actually
changed. Only those fields are persisted — an effort change does not rewrite the
model.

`compact` fails with a message when the session is too short for pi to bother.

## Portal settings

| | |
| --- | --- |
| `GET /api/settings` | `{ settings, stored, defaults, piSettingsPath, executor, workspaceRoot }` |
| `PUT /api/settings` | `{ provider?, model?, thinkingLevel? }` |

`settings` is what pi is launched with; `stored` is only your explicit
overrides; `defaults` is what an unset field falls back to. An empty string in
`PUT` clears an override rather than storing a blank.

## pi extensions

| | |
| --- | --- |
| `GET /api/packages` | Raw `pi list` output |
| `POST /api/packages` | `{ spec }` |
| `DELETE /api/packages` | `{ spec }` |
| `POST /api/packages/update` | Update everything |
| `GET /api/extensions` | Parsed packages with their recovered settings |
| `PUT /api/extensions/settings` | `{ key, value }` — empty value removes the key |
| `GET /api/pi-settings` | Raw `settings.json` |
| `PUT /api/pi-settings` | `{ content }` — refused unless it parses as JSON |

## Channels

| | |
| --- | --- |
| `GET /api/channels` | `{ channels, kinds, broken, agentHome, channelsDir }` |
| `POST /api/channels` | `{ kind, name, config }` |
| `PATCH /api/channels/:id` | `{ name?, slug?, enabled?, config?, instructions? }` |
| `DELETE /api/channels/:id` | Keeps its conversations; `?sessions=delete` discards them too |
| `POST /api/channel-packages` | `{ spec }` — install a channel package |
| `DELETE /api/channel-packages/:name` | Uninstall; refuses builtins |

A channel's `slug` is what agent sessions are keyed on, and it survives the
channel being deleted and recreated. Creating a channel with an explicit `slug`
reconnects it to the conversations that slug already had.

Secrets are never returned. A channel carries `secretsSet` listing which secret
fields have a value, and sending a blank secret keeps the stored one.

`broken` lists packages that failed to load, with the reason.
