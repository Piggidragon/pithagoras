import { VoiceAddon } from "./VoiceAddon";
import { useEffect, useId, useState } from "react";
import { LuCheck, LuGlobe, LuMic, LuRefreshCw, LuTrash2 } from "react-icons/lu";
import { api, type BrowserStatus } from "../api";

/**
 * Optional pieces of the portal itself, as opposed to pi's packages.
 *
 * This is where an add-on is found before it exists. Its own page appears in
 * the sidebar once installed, which is the right place to live and the wrong
 * place to be discovered from — nothing was visible until it was already
 * running, so there was nowhere to press install.
 */
const addons = [{ id: 'browser', label: 'Browser', Icon: LuGlobe }, { id: 'voice', label: 'Voice', Icon: LuMic }] as const;
type Addon = typeof addons[number]['id'];

export function PortalExtensions({ onError }: { onError: (e: string) => void }) {
  const id = useId();
  const [selected, setSelected] = useState<Addon>('browser');
  const [visited, setVisited] = useState<Addon[]>(['browser']);
  const select = (addon: Addon) => {
    setSelected(addon);
    setVisited(previous => previous.includes(addon) ? previous : [...previous, addon]);
  };
  return <div>
    <p className="mb-4 text-xs text-fg-muted">Install and manage the add-ons for your sessions.</p>
    <div role="tablist" aria-label="Add-ons" className="flex gap-1 rounded-xl border border-line bg-raised/40 p-1">
      {addons.map(({ id: addon, label, Icon }, index) => <button
        key={addon} id={`${id}-${addon}-tab`} type="button" role="tab"
        aria-selected={selected === addon} aria-controls={`${id}-${addon}-panel`}
        tabIndex={selected === addon ? 0 : -1} onClick={() => select(addon)}
        onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? (index + 1) % addons.length
            : event.key === 'ArrowLeft' ? (index + addons.length - 1) % addons.length
            : event.key === 'Home' ? 0 : event.key === 'End' ? addons.length - 1 : null;
          if (next === null) return;
          event.preventDefault(); select(addons[next].id);
          document.getElementById(`${id}-${addons[next].id}-tab`)?.focus();
        }}
        className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${selected === addon ? 'bg-accent/12 text-accent shadow-sm ring-1 ring-inset ring-accent/25' : 'text-fg-muted hover:bg-fg/5 hover:text-fg'}`}
      ><Icon className="h-4 w-4" />{label}</button>)}
    </div>
    {addons.map(({ id: addon }) => <div key={addon} role="tabpanel" id={`${id}-${addon}-panel`}
      aria-labelledby={`${id}-${addon}-tab`} hidden={selected !== addon}>
      {visited.includes(addon) && (addon === 'browser' ? <BrowserAddon onError={onError} /> : <VoiceAddon onError={onError} />)}
    </div>)}
  </div>;
}

function BrowserAddon({ onError }: { onError: (e: string) => void }) {
  const [status, setStatus] = useState<BrowserStatus | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .browser()
      .then(setStatus)
      .catch((e) => onError((e as Error).message));

  useEffect(() => {
    load();
  }, []);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!status) {
    return (
      <p className="flex items-center gap-2 text-sm text-fg-subtle">
        <LuRefreshCw className="h-3.5 w-3.5 animate-spin" /> Loading…
      </p>
    );
  }

  const i = status.install;
  const installed = i.container === "running" || i.container === "stopped";
  const dockerMode = i.mode === "docker";
  const needsPassword = dockerMode && !status.config.hasPassword && !installed;

  return (
    <>
      <div className="mt-4 rounded-xl border border-line bg-raised/40 p-3">
        <div className="flex items-start gap-2.5">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
            <LuGlobe className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm text-fg">Browser</p>
              {installed && (
                <span className="inline-flex items-center gap-1 text-[11px] text-ok">
                  <LuCheck className="h-3 w-3" />
                  {i.container === "running" ? "running" : "installed"}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[11px] text-fg-faint">
              A real browser with a profile that stays logged in. Sign into it once; the agent
              drives the same one afterwards and never handles a password.
            </p>

            {!i.available && (
              <p className="mt-2 text-[11px] text-warn">
                Not possible here — the portal cannot reach Docker and there is no Chrome on the
                machine.
              </p>
            )}

            {i.available && !installed && (
              <p className="mt-2 text-[11px] text-fg-faint">
                {dockerMode
                  ? i.image
                    ? "Runs as its own container. The image is already downloaded."
                    : "Runs as its own container. Installing downloads a 4.6GB image."
                  : `Uses the Chrome on this machine (${i.binary}).`}
              </p>
            )}
          </div>
        </div>

        {needsPassword && (
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="a password for its web UI"
              className="min-w-[12rem] flex-1 rounded-lg border border-line bg-raised/60 px-2 py-1.5 text-xs outline-none focus:border-accent/60"
            />
            <button
              onClick={async () => setPassword((await api.suggestBrowserPassword()).password)}
              className="rounded-lg bg-fg/5 px-2.5 py-1.5 text-[11px] text-fg-muted transition hover:bg-fg/10"
            >
              Suggest one
            </button>
          </div>
        )}

        {i.available && (
          <div className="mt-3 flex flex-wrap gap-2">
            {!installed && (
              <button
                disabled={busy || (needsPassword && !password.trim())}
                onClick={() =>
                  act(async () => {
                    if (password.trim()) await api.setBrowserConfig({ password: password.trim() });
                    await api.installBrowser();
                    await api.connectBrowser();
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent/12 px-3 py-1.5 text-xs text-accent ring-1 ring-inset ring-accent/25 transition hover:bg-accent/20 disabled:opacity-40"
              >
                {busy && <LuRefreshCw className="h-3.5 w-3.5 animate-spin" />}
                Install
              </button>
            )}
            {installed && (
              <>
                <button
                  disabled={busy}
                  onClick={() =>
                    act(() => (i.container === "running" ? api.stopBrowser() : api.startBrowser()))
                  }
                  className="rounded-lg bg-fg/5 px-3 py-1.5 text-xs text-fg-muted transition hover:bg-fg/10"
                >
                  {i.container === "running" ? "Stop" : "Start"}
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      await api.disconnectBrowser();
                      await api.removeBrowser(false);
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg bg-fg/5 px-3 py-1.5 text-xs text-fg-muted transition hover:bg-danger/10 hover:text-danger"
                >
                  <LuTrash2 className="h-3.5 w-3.5" /> Remove
                </button>
              </>
            )}
          </div>
        )}

        {i.pulling.active && (
          <p className="mt-2 font-mono text-[11px] text-fg-faint">{i.pulling.line}</p>
        )}
        {installed && (
          <p className="mt-2 text-[11px] text-fg-faint">
            Removing keeps the profile, so its logins are still there if you install it again.
          </p>
        )}
      </div>
    </>
  );
}
