# The agent's browser

::: tip Docker installation
See [Docker add-ons](/guide/add-ons) for installation, controls and profile cleanup.
:::

Optional. Nothing here is installed, pulled or shown unless you ask for it.

A real browser, in its own container, with a profile that stays signed in. You
log into it once by hand; every run after that finds the accounts already there.
**No password ever passes through the model.**

## Installing it

**Settings → Add-ons → Browser → Install.** Nothing to edit, nothing to
redeploy. It is not in `docker-compose.yml` and never was for you: a deployment
that never installs it has no image, no container, and no Browser page.

Set a password when asked — this holds live sessions for the agent's accounts,
and there is a button to generate one.

Two ways it can run, chosen for you rather than configured:

| | When | What you get |
| --- | --- | --- |
| **Container** | the portal can reach the Docker socket | Its own container, pulled on install. Costs nothing until you install it. |
| **Local Chrome** | it cannot | The browser already on the machine, same profile directory. Nothing downloaded. |

The local path is mostly the portal run from source. It goes headless when there
is no display, and says so — sign-in pages refuse headless browsers often
enough to matter.

**Remove** takes the container away and keeps the profile, so installing again
finds the logins still there.

## Logging in

Browser tool responses use on-demand snapshots to keep model context small.
Actions return status without repeating the entire page. The agent uses
`browser_find` for matching text and element references. An explicit
`browser_snapshot({})` returns the full accessibility tree without an imposed
depth limit. Targeted snapshots and optional depth limits are available when
the agent only needs a particular section.

**Browser → Open browser** in the portal, or `https://<host>:3011` directly.
That is a full Chromium in a web page: sign into whatever the agent should have,
then close the tab. The profile lives on its own volume and survives restarts.

### Embedded, or in a tab

The portal proxies the browser's UI at `/browser-ui`, so **Open browser** shows
it inline with a fullscreen button, using the portal's own certificate and
credential. No second password, no second certificate.

That needs the portal itself on HTTPS. The VNC client gates on
`isSecureContext`, and a frame only counts as secure when **every page above it**
does — so an HTTPS frame inside an HTTP portal fails exactly as plain HTTP
would. Without TLS the page says so and offers a tab instead.

Give the portal a certificate:

```
PORTAL_TLS_DIR=/etc/pithagoras/certs
PORTAL_TLS_CERT=/certs/portal.crt
PORTAL_TLS_KEY=/certs/portal.key
```

A self-signed pair is enough:

```bash
mkdir -p /etc/pithagoras/certs && cd /etc/pithagoras/certs
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout portal.key -out portal.crt -subj "/CN=pithagoras"
```

On a tailnet, `tailscale cert <machine>.<tailnet>.ts.net` gives a real one and
no warnings at all.

The direct port still works if you would rather not: `https://<host>:3011`, with
`BROWSER_USER` and `BROWSER_PASSWORD`, and its own self-signed certificate to
accept.

Give the agent **its own accounts** rather than sharing yours. That is what
makes it a teammate rather than a proxy, and it keeps a colleague's request from
reaching your personal mail.

## Letting the agent drive it

The browser reaches the agent as MCP tools. Add one server in
[Settings → MCP](/guide/mcp):

```json
{
  "browser": {
    "command": "npx",
    "args": ["-y", "@playwright/mcp@latest", "--cdp-endpoint", "http://127.0.0.1:9222"]
  }
}
```

`--cdp-endpoint` is the whole trick: it **attaches to the running browser**
instead of launching one. A Playwright MCP server without it starts its own
throwaway Chromium, which is signed into nothing.

::: warning Do not run both
A second, headless Playwright server is a way around everything on this page —
its own browser, no profile, no allowlist. If you have one, remove it.
:::

## Who may drive it

The browser reaches the agent as an MCP server, so it is switched where every
other package is: the blocks icon beside the composer for one conversation,
**Settings → Tools** for all of them. Having its tools is having the browser —
a conversation with them all off is not offered them and does not reach the
container. A routine still has its own switch on its own page.

Like any other package, its tools are **on** unless something says otherwise.
An installation that had the old per-session switch keeps what it had: the
browser's tools are written into the defaults as off and the conversations that
had been granted it are given it back. So an existing portal wakes up the way it
went to sleep, and a new one starts like any other server.

That happens when the first conversation after the upgrade lists its tools, not
when the portal starts — which of them are the browser's is only known once a
session has registered them. Until then the old switch is what answers, so there
is no moment in between where every conversation has the browser.

::: tip Turning it off everywhere
**Settings → Tools → browser → all off**. That is the one switch; there is no
second one to keep in step with it.
:::

Deliberately **not** gated on who is speaking. The agent has its own accounts and
uses them as itself, including when it is helping a colleague. What balances
that is visibility: every page it opens is recorded in [Audit](/guide/security).

::: warning With `EXECUTOR=container`
pi runs inside the container and never tells the portal what it registered, so
there is no tool list to switch and the tools popover says so. The browser is
granted per session over the API there (`PUT /api/sessions/:id/browser`), which
is what the old switch wrote.
:::

## Where it may go

**Browser → Where it may go** takes one domain per line, `*.example.com` for
subdomains. Empty means no restriction.

::: danger Read this one together with the section above
That default was written when the browser was off until somebody turned it on,
so an empty list blocked nothing that was not already blocked. It is on by
default now. An empty allowlist and an untouched tools list means **every
conversation can point the agent's signed-in browser anywhere** — so on a
portal whose browser holds real logins, fill this in, or switch the browser's
tools off by default and turn them on where you want them.
:::

::: warning This is a check, not a wall
It is applied when the agent asks for a URL. A page that redirects itself is not
covered, and neither is a request the agent makes through the debugging protocol
rather than by navigating. Real enforcement is a filtering proxy in front of the
browser, which is not built yet.
:::

## The debugging port

Chromium exposes `127.0.0.1:9222`, and that port is **unauthenticated**. Whoever
reaches it owns every account the browser is signed into.

Host networking is what keeps it to the box. Never publish it, never put it
behind a reverse proxy, and treat the profile volume as the secret it is.

### Screenshot images

The portal requests inline image data for browser screenshots. In the pinned
Playwright version, providing `filename` suppresses the image block, leaving
only a file link. The portal removes that argument from screenshot calls;
Playwright still saves the screenshot under an automatic filename. Capture
options such as target, full-page, scale, and format remain available.

Snapshot output uses compact notation: `[eN]` or `[fNeN]` is the exact element
reference, an omitted role means `generic`, and `[pointer]` means a pointer
cursor. The tree retains its nodes, text, URLs and state; this formatting does
not impose a depth limit or truncate content.
