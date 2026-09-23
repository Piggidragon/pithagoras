# Configuration

Configuration comes from four places. Knowing which one wins saves a lot of
confusion.

## The four layers

| Layer | Set from | Applies to |
| --- | --- | --- |
| Session | The pills under the composer | One session |
| Portal | Settings → General | New sessions |
| Environment | Compose / `.env` | The deployment |
| pi | `~/.pi/agent/settings.json` | pi itself, everywhere |

For model, effort and provider, they resolve in that order — first non-empty
wins, with a last-resort constant behind pi:

```
session → portal override → environment → pi settings.json → fallback
```

Everything past the session layer is a *default*. A session that has made its
own choice keeps it, and changing a default never rewrites a running session.

::: tip Empty means inherit
`PI_PROVIDER`, `PI_MODEL` and `PI_THINKING_LEVEL` are overrides, and they are
empty in the compose file on purpose. Give them a value and pi's own
`settings.json` can never be reached. The same is true in Settings → General:
an empty field inherits, and clearing one hands the setting back.
:::

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORTAL_PASSWORD` | — | Required. The single login password; the portal will not start without it. |
| `PORTAL_ALLOW_NO_PASSWORD` | — | `1` runs with no login at all. Only safe behind a reverse proxy that authenticates, with the port unreachable otherwise. |
| `PORTAL_SECRET` | random | Signs the cookie. Set it to survive restarts. |
| `PORT` | `4100` | Listen port. |
| `DATA_DIR` | `/data` | Where `portal.db` lives. |
| `SESSION_DIR` | `/data/sessions` | One folder per session, holding pi's conversation file. Removed when the session is deleted — with the container executor, a file written by another user can keep a folder from going; that is logged. |
| `WORKSPACE_ROOT` | `/workspaces` | Directories sessions can be created against. |
| `CHANNELS_DIR` | `/data/channels` | Installed channel packages. |
| `AGENT_HOME` | `/data/agent-home` | The agent session's directory. |
| `HOME` | `/data/home` | pi's home — its settings and packages. |
| `EXECUTOR` | `host` | `host` or `container`. |
| `PI_IMAGE` | `pithagoras-runner:latest` | Image for the container executor. |
| `TASK_MEMORY_MB` | `2048` | Container executor memory ceiling. |
| `TASK_CPUS` | `2` | Container executor CPU ceiling. |
| `TASK_PIDS_LIMIT` | `512` | Container executor process ceiling. |
| `PI_PROVIDER` | — | Override for pi's `defaultProvider`. |
| `PI_MODEL` | — | Override for pi's `defaultModel`. |
| `PI_THINKING_LEVEL` | — | Override for pi's `defaultThinkingLevel`. |

Provider credentials — `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY` and anything
else pi reads — pass through untouched.

`HOME` on the data volume is load-bearing. Point it back at the container
filesystem and every image rebuild silently wipes the pi packages you installed.

## pi's settings.json

Lives at `$HOME/.pi/agent/settings.json` — `/data/home/.pi/agent/settings.json`
in the container. Editable from Settings → Advanced, which validates it as JSON
before writing; a broken file stops every future session from starting.

```json
{
  "defaultProvider": "llama-server=http://192.168.1.101:8080",
  "defaultModel": "qwen36-35b-a3b-mtp",
  "defaultThinkingLevel": "high",
  "packages": ["npm:pi-llama-cpp"],
  "llamaServerUrl": "http://192.168.1.101:8080",
  "compaction": { "enabled": true }
}
```

Extension settings live here too, alongside pi's own. That is why the portal
writes single keys rather than replacing the file: a wholesale overwrite would
take the `packages` list with it.

## Portal settings

Stored in the `settings` table, edited in Settings → General. Saving an empty
value **deletes** the row rather than storing an empty string, which is what
makes "inherit" reachable again after you have set something.

The `GET /api/settings` response separates the three so a client can tell them
apart:

```json
{
  "settings": { "provider": "llama-server=…", "model": "qwen36-35b-a3b-mtp" },
  "stored":   {},
  "defaults": { "provider": "llama-server=…", "model": "qwen36-35b-a3b-mtp" }
}
```

`stored` empty and `settings` matching `defaults` means everything is inherited
— nothing is pinned.
