import { useEffect, useState } from "react";
import { Select } from "./Select";
import {
  LuChevronLeft,
  LuChevronRight,
  LuCircleAlert,
  LuClipboardPaste,
  LuDownload,
  LuFileJson,
  LuGlobe,
  LuPlug,
  LuPlus,
  LuRefreshCw,
  LuTerminal,
  LuTrash2,
  LuTriangleAlert,
} from "react-icons/lu";
import { api, type McpConfigView, type McpServerEntry, type McpServerView } from "../api";

const inputCls =
  "w-full rounded-lg border border-line bg-raised/60 px-3 py-2 text-sm outline-none transition placeholder:text-fg-faint focus:border-accent/60";
const btnCls =
  "inline-flex items-center gap-1.5 rounded-lg bg-fg/5 px-3 py-2 text-sm text-fg transition hover:bg-fg/10 disabled:opacity-40";
const primaryCls =
  "inline-flex items-center gap-1.5 rounded-lg bg-accent/12 px-3 py-2 text-sm text-accent ring-1 ring-inset ring-accent/25 transition hover:bg-accent/20 disabled:opacity-40";
const monoCls = `${inputCls} font-mono text-xs leading-relaxed`;

type Transport = "stdio" | "http" | "socket";

/** Lines in, list out — blank lines dropped. Used for args, filters and pairs. */
const lines = (text: string): string[] =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

function pairsToText(obj: Record<string, string> | undefined, sep: string): string {
  if (!obj) return "";
  return Object.entries(obj)
    .map(([k, v]) => `${k}${sep}${v}`)
    .join("\n");
}

function textToPairs(text: string, sep: string): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const line of lines(text)) {
    const at = line.indexOf(sep);
    if (at < 1) continue;
    out[line.slice(0, at).trim()] = line.slice(at + sep.length).trim();
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * MCP servers for `pi-mcp-adapter`.
 *
 * The adapter is what turns this file into tools; the portal only owns the
 * configuration. So the panel says plainly when the adapter is missing rather
 * than letting someone configure servers that nothing will ever read.
 */
export function McpPanel({ onError }: { onError: (e: string) => void }) {
  const [view, setView] = useState<McpConfigView | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ name: string | null } | null>(null);
  const [importing, setImporting] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);

  const load = async () => {
    try {
      setView(await api.mcp());
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await load();
    } catch (e) {
      onError((e as Error).message);
    }
  };

  if (loading || !view) {
    return (
      <p className="flex items-center gap-2 text-sm text-fg-subtle">
        <LuRefreshCw className="h-3.5 w-3.5 animate-spin" /> Reading configuration…
      </p>
    );
  }

  if (editing) {
    const existing = editing.name ? view.servers.find((s) => s.name === editing.name) : undefined;
    return (
      <ServerForm
        server={existing}
        onBack={() => setEditing(null)}
        onSave={async (name, entry) => {
          await api.saveMcpServer(name, entry, existing?.name);
          setEditing(null);
          await load();
        }}
        onError={onError}
      />
    );
  }

  return (
    <>
      {!view.adapterInstalled && (
        <section className="mb-6 rounded-xl border border-warn/30 bg-warn/10 p-3">
          <div className="flex items-start gap-2">
            <LuTriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-fg">The MCP adapter is not installed</p>
              <p className="mt-1 text-xs text-fg-muted">
                MCP support comes from the <span className="font-mono">pi-mcp-adapter</span>{" "}
                extension. Until it is installed, servers configured here are read by nothing.
              </p>
              <button
                className={`${primaryCls} mt-3`}
                disabled={installing}
                onClick={async () => {
                  setInstalling(true);
                  try {
                    await api.installPackage(view.adapterSpec);
                    await load();
                  } catch (e) {
                    onError((e as Error).message);
                  } finally {
                    setInstalling(false);
                  }
                }}
              >
                {installing ? (
                  <LuRefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <LuDownload className="h-4 w-4" />
                )}
                Install it
              </button>
            </div>
          </div>
        </section>
      )}

      {view.parseError && (
        <section className="mb-6 rounded-xl border border-danger/30 bg-danger/10 p-3">
          <div className="flex items-start gap-2">
            <LuCircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
            <div className="min-w-0">
              <p className="text-sm text-danger">This file does not parse</p>
              <p className="mt-1 font-mono text-xs text-fg-muted">{view.parseError}</p>
              <p className="mt-1 text-xs text-fg-faint">
                Nothing is listed and nothing will be written until it is fixed — edit it below.
              </p>
            </div>
          </div>
        </section>
      )}

      <section className="mb-6 rounded-xl border border-line bg-raised/40 p-3">
        <div className="flex items-center gap-2">
          <LuFileJson className="h-3.5 w-3.5 shrink-0 text-fg-faint" />
          <p className="text-xs text-fg-subtle">Config file</p>
          <p className="ml-auto truncate pl-3 font-mono text-xs text-fg-muted">{view.path}</p>
        </div>
        <p className="mt-1.5 text-xs text-fg-faint">
          Applies to every session in this portal. Changes are picked up by sessions started
          afterwards, so restart a running one to pull in a new server.
        </p>
      </section>

      <section className="mb-6">
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-sm font-medium text-fg">Servers</h3>
          <span className="text-xs text-fg-faint">{view.servers.length}</span>
          <div className="ml-auto flex gap-2">
            <button className={btnCls} onClick={() => setImporting((v) => !v)}>
              <LuClipboardPaste className="h-4 w-4" /> Paste JSON
            </button>
            <button className={primaryCls} onClick={() => setEditing({ name: null })}>
              <LuPlus className="h-4 w-4" /> Add server
            </button>
          </div>
        </div>

        {importing && (
          <ImportBox
            onCancel={() => setImporting(false)}
            onDone={async () => {
              setImporting(false);
              await load();
            }}
            onError={onError}
          />
        )}

        {view.servers.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-xs text-fg-faint">
            No servers yet. Most MCP projects publish a JSON snippet in their README — paste it
            straight in.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {view.servers.map((s) => (
              <ServerRow
                key={s.name}
                server={s}
                onOpen={() => setEditing({ name: s.name })}
                onToggle={() =>
                  act(() =>
                    api.saveMcpServer(s.name, { ...s.entry, disabled: !s.disabled }, s.name),
                  )
                }
                onDelete={() => act(() => api.deleteMcpServer(s.name))}
              />
            ))}
          </ul>
        )}
      </section>

      <GlobalSettings
        settings={view.settings}
        onSave={(next) => act(() => api.saveMcpSettings(next))}
      />

      <section className="mt-6">
        <button
          className="flex w-full items-center gap-2 text-left text-sm text-fg-muted transition hover:text-fg"
          onClick={() => setRawOpen((v) => !v)}
        >
          <LuChevronRight
            className={`h-3.5 w-3.5 transition-transform ${rawOpen ? "rotate-90" : ""}`}
          />
          Edit the file directly
        </button>
        {rawOpen && (
          <RawEditor initial={view.raw} onSaved={load} onError={onError} />
        )}
      </section>
    </>
  );
}

function ServerRow({
  server,
  onOpen,
  onToggle,
  onDelete,
}: {
  server: McpServerView;
  onOpen: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const e = server.entry;
  const summary =
    server.transport === "stdio"
      ? [e.command, ...(e.args ?? [])].join(" ")
      : server.transport === "http"
        ? e.url
        : server.transport === "socket"
          ? e.socket
          : "No transport configured";

  return (
    <li className="group flex items-center gap-3 rounded-xl border border-line bg-raised/40 px-3 py-2.5">
      {server.transport === "http" ? (
        <LuGlobe className="h-4 w-4 shrink-0 text-fg-faint" />
      ) : (
        <LuTerminal className="h-4 w-4 shrink-0 text-fg-faint" />
      )}
      <button className="min-w-0 flex-1 text-left" onClick={onOpen}>
        <p className={`truncate text-sm ${server.disabled ? "text-fg-subtle" : "text-fg"}`}>
          {server.name}
          {server.disabled && <span className="ml-2 text-xs text-fg-faint">disabled</span>}
        </p>
        <p className="truncate font-mono text-xs text-fg-faint">{summary}</p>
      </button>
      <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-fg-subtle">
        <input
          type="checkbox"
          className="accent-accent"
          checked={!server.disabled}
          onChange={onToggle}
        />
        On
      </label>
      <button
        className="shrink-0 rounded-lg p-1.5 text-fg-faint opacity-0 transition hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
        title="Remove"
        onClick={onDelete}
      >
        <LuTrash2 className="h-4 w-4" />
      </button>
      <button className="shrink-0 text-fg-faint" onClick={onOpen} title="Edit">
        <LuChevronRight className="h-4 w-4" />
      </button>
    </li>
  );
}

function ImportBox({
  onCancel,
  onDone,
  onError,
}: {
  onCancel: () => void;
  onDone: () => void;
  onError: (e: string) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ added: string[]; skipped: { name: string; reason: string }[] } | null>(null);

  return (
    <div className="mb-3 rounded-xl border border-line bg-raised/40 p-3">
      <p className="mb-2 text-xs text-fg-muted">
        Accepts a whole config, a bare <span className="font-mono">mcpServers</span> map, or a single
        server object.
      </p>
      <textarea
        className={monoCls}
        rows={7}
        spellCheck={false}
        placeholder={'{\n  "mcpServers": {\n    "filesystem": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/data"]\n    }\n  }\n}'}
        value={text}
        onChange={(ev) => setText(ev.target.value)}
      />
      {result && (
        <div className="mt-2 text-xs">
          {result.added.length > 0 && (
            <p className="text-ok">Added {result.added.join(", ")}</p>
          )}
          {result.skipped.map((s) => (
            <p key={s.name} className="text-warn">
              Skipped {s.name}: {s.reason}
            </p>
          ))}
        </div>
      )}
      <div className="mt-2 flex gap-2">
        <button
          className={primaryCls}
          disabled={busy || !text.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await api.importMcp(text);
              setResult(r);
              if (r.added.length) {
                setText("");
                onDone();
              }
            } catch (e) {
              onError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <LuRefreshCw className="h-4 w-4 animate-spin" /> : <LuDownload className="h-4 w-4" />}
          Import
        </button>
        <button className={btnCls} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function ServerForm({
  server,
  onBack,
  onSave,
  onError,
}: {
  server?: McpServerView;
  onBack: () => void;
  onSave: (name: string, entry: McpServerEntry) => Promise<void>;
  onError: (e: string) => void;
}) {
  const e = server?.entry ?? {};
  const [name, setName] = useState(server?.name ?? "");
  const [transport, setTransport] = useState<Transport>(
    server && server.transport !== "unknown" ? server.transport : "stdio",
  );
  const [command, setCommand] = useState(e.command ?? "");
  const [args, setArgs] = useState((e.args ?? []).join("\n"));
  const [env, setEnv] = useState(pairsToText(e.env, "="));
  const [cwd, setCwd] = useState(e.cwd ?? "");
  const [url, setUrl] = useState(e.url ?? "");
  const [headers, setHeaders] = useState(pairsToText(e.headers, ": "));
  const [auth, setAuth] = useState<string>(e.auth === false ? "none" : (e.auth ?? "auto"));
  const [tokenEnv, setTokenEnv] = useState(e.bearerTokenEnv ?? "");
  const [socket, setSocket] = useState(e.socket ?? "");
  const [lifecycle, setLifecycle] = useState(e.lifecycle ?? "lazy");
  const [includeTools, setIncludeTools] = useState((e.includeTools ?? []).join("\n"));
  const [excludeTools, setExcludeTools] = useState((e.excludeTools ?? []).join("\n"));
  const [directTools, setDirectTools] = useState(e.directTools === true);
  const [debug, setDebug] = useState(e.debug === true);
  const [disabled, setDisabled] = useState(e.disabled === true);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) return onError("Give the server a name");
    // Start from the stored entry so fields this form does not show — oauth
    // blocks, tracing, timeouts set by hand — survive an edit here.
    const next: McpServerEntry = { ...e };
    for (const k of [
      "command", "args", "env", "cwd", "url", "headers", "socket",
      "auth", "bearerTokenEnv", "lifecycle", "includeTools", "excludeTools",
      "directTools", "debug", "disabled",
    ]) {
      delete next[k];
    }

    if (transport === "stdio") {
      next.command = command.trim();
      if (lines(args).length) next.args = lines(args);
      const parsed = textToPairs(env, "=");
      if (parsed) next.env = parsed;
      if (cwd.trim()) next.cwd = cwd.trim();
    } else if (transport === "http") {
      next.url = url.trim();
      const parsed = textToPairs(headers, ":");
      if (parsed) next.headers = parsed;
      if (auth === "none") next.auth = false;
      else if (auth !== "auto") next.auth = auth as "oauth" | "bearer";
      if (auth === "bearer" && tokenEnv.trim()) next.bearerTokenEnv = tokenEnv.trim();
    } else {
      next.socket = socket.trim();
    }

    if (lifecycle !== "lazy") next.lifecycle = lifecycle as McpServerEntry["lifecycle"];
    if (lines(includeTools).length) next.includeTools = lines(includeTools);
    if (lines(excludeTools).length) next.excludeTools = lines(excludeTools);
    if (directTools) next.directTools = true;
    if (debug) next.debug = true;
    if (disabled) next.disabled = true;

    setSaving(true);
    try {
      await onSave(name.trim(), next);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        className="mb-4 flex items-center gap-1 text-sm text-fg-muted transition hover:text-fg"
        onClick={onBack}
      >
        <LuChevronLeft className="h-4 w-4" /> Servers
      </button>

      <div className="space-y-4">
        <Field label="Name" hint="How its tools are prefixed, so keep it short">
          <input
            className={inputCls}
            value={name}
            placeholder="filesystem"
            onChange={(ev) => setName(ev.target.value)}
          />
        </Field>

        <Field label="Transport">
          <div className="flex gap-2">
            {(["stdio", "http", "socket"] as Transport[]).map((t) => (
              <button
                key={t}
                onClick={() => setTransport(t)}
                className={`rounded-lg px-3 py-2 text-sm transition ${
                  transport === t
                    ? "bg-accent/12 text-accent ring-1 ring-inset ring-accent/25"
                    : "bg-fg/5 text-fg-muted hover:bg-fg/10"
                }`}
              >
                {t === "stdio" ? "Local process" : t === "http" ? "HTTP" : "Unix socket"}
              </button>
            ))}
          </div>
        </Field>

        {transport === "stdio" && (
          <>
            <Field label="Command">
              <input
                className={inputCls}
                value={command}
                placeholder="npx"
                onChange={(ev) => setCommand(ev.target.value)}
              />
            </Field>
            <Field label="Arguments" hint="One per line">
              <textarea
                className={monoCls}
                rows={3}
                spellCheck={false}
                value={args}
                placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/data"}
                onChange={(ev) => setArgs(ev.target.value)}
              />
            </Field>
            <Field label="Environment" hint="KEY=value per line; ${VAR} is expanded at launch">
              <textarea
                className={monoCls}
                rows={2}
                spellCheck={false}
                value={env}
                placeholder="GITHUB_TOKEN=${GITHUB_TOKEN}"
                onChange={(ev) => setEnv(ev.target.value)}
              />
            </Field>
            <Field label="Working directory" hint="Optional">
              <input className={inputCls} value={cwd} onChange={(ev) => setCwd(ev.target.value)} />
            </Field>
          </>
        )}

        {transport === "http" && (
          <>
            <Field label="URL">
              <input
                className={inputCls}
                value={url}
                placeholder="https://example.com/mcp"
                onChange={(ev) => setUrl(ev.target.value)}
              />
            </Field>
            <Field label="Headers" hint="Name: value per line">
              <textarea
                className={monoCls}
                rows={2}
                spellCheck={false}
                value={headers}
                onChange={(ev) => setHeaders(ev.target.value)}
              />
            </Field>
            <Field label="Authentication">
              <Select
                className="w-full"
                value={auth}
                onChange={setAuth}
                options={[
                  { value: "auto", label: "Detect", hint: "OAuth if the server offers it" },
                  { value: "oauth", label: "OAuth" },
                  { value: "bearer", label: "Bearer token" },
                  { value: "none", label: "None" },
                ]}
              />
            </Field>
            {auth === "bearer" && (
              <Field
                label="Token environment variable"
                hint="The variable name, not the token — secrets do not belong in this file"
              >
                <input
                  className={inputCls}
                  value={tokenEnv}
                  placeholder="MY_SERVICE_TOKEN"
                  onChange={(ev) => setTokenEnv(ev.target.value)}
                />
              </Field>
            )}
          </>
        )}

        {transport === "socket" && (
          <Field label="Socket path">
            <input
              className={inputCls}
              value={socket}
              placeholder="~/.rmcp/mux.sock"
              onChange={(ev) => setSocket(ev.target.value)}
            />
          </Field>
        )}

        <Field label="Lifecycle" hint="Lazy connects on first use, which is usually what you want">
          <Select
            className="w-full"
            value={lifecycle}
            onChange={(v) => setLifecycle(v as McpServerEntry["lifecycle"] & string)}
            options={[
              { value: "lazy", label: "Lazy" },
              { value: "lazy-keep-alive", label: "Lazy, then keep alive" },
              { value: "eager", label: "Eager" },
              { value: "keep-alive", label: "Keep alive" },
            ]}
          />
        </Field>

        <Field label="Only these tools" hint="One name or glob per line; leave empty for all">
          <textarea
            className={monoCls}
            rows={2}
            spellCheck={false}
            value={includeTools}
            onChange={(ev) => setIncludeTools(ev.target.value)}
          />
        </Field>
        <Field label="Except these tools" hint="One name or glob per line">
          <textarea
            className={monoCls}
            rows={2}
            spellCheck={false}
            value={excludeTools}
            onChange={(ev) => setExcludeTools(ev.target.value)}
          />
        </Field>

        <div className="space-y-2 rounded-xl border border-line bg-raised/40 p-3">
          <Toggle
            checked={directTools}
            onChange={setDirectTools}
            label="Register tools directly"
            hint="Puts every tool in the system prompt instead of behind the proxy — 150–300 tokens each, so keep it to small servers"
          />
          <Toggle checked={debug} onChange={setDebug} label="Show server stderr" />
          <Toggle
            checked={disabled}
            onChange={setDisabled}
            label="Disabled"
            hint="Kept here but never connected"
          />
        </div>

        <div className="flex gap-2 pt-1">
          <button className={primaryCls} disabled={saving} onClick={submit}>
            {saving && <LuRefreshCw className="h-4 w-4 animate-spin" />}
            Save
          </button>
          <button className={btnCls} onClick={onBack}>
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}

function GlobalSettings({
  settings,
  onSave,
}: {
  settings: Record<string, unknown>;
  onSave: (next: Record<string, unknown>) => void;
}) {
  const [prefix, setPrefix] = useState(String(settings.toolPrefix ?? "server"));
  const [idle, setIdle] = useState(settings.idleTimeout === undefined ? "" : String(settings.idleTimeout));
  const [timeout, setTimeout] = useState(
    settings.requestTimeoutMs === undefined ? "" : String(settings.requestTimeoutMs),
  );
  const [dirty, setDirty] = useState(false);

  const save = () => {
    const next: Record<string, unknown> = { ...settings };
    if (prefix === "server") delete next.toolPrefix;
    else next.toolPrefix = prefix;
    if (idle.trim() === "") delete next.idleTimeout;
    else next.idleTimeout = Number(idle);
    if (timeout.trim() === "") delete next.requestTimeoutMs;
    else next.requestTimeoutMs = Number(timeout);
    onSave(next);
    setDirty(false);
  };

  const track = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setDirty(true);
  };

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <LuPlug className="h-3.5 w-3.5 text-fg-faint" />
        <h3 className="text-sm font-medium text-fg">Adapter settings</h3>
        {dirty && (
          <button className={`${primaryCls} ml-auto py-1.5`} onClick={save}>
            Save
          </button>
        )}
      </div>
      <div className="grid gap-3 rounded-xl border border-line bg-raised/40 p-3 sm:grid-cols-3">
        <Field label="Tool naming">
          <Select
            className="w-full"
            value={prefix}
            onChange={(v) => track(setPrefix)(v)}
            options={[
              { value: "server", label: "server_tool" },
              { value: "short", label: "short" },
              { value: "mcp", label: "mcp_tool" },
              { value: "none", label: "tool" },
            ]}
          />
        </Field>
        <Field label="Idle timeout" hint="Minutes; 0 never disconnects">
          <input
            className={inputCls}
            value={idle}
            placeholder="10"
            inputMode="numeric"
            onChange={(ev) => track(setIdle)(ev.target.value)}
          />
        </Field>
        <Field label="Request timeout" hint="Milliseconds">
          <input
            className={inputCls}
            value={timeout}
            placeholder="default"
            inputMode="numeric"
            onChange={(ev) => track(setTimeout)(ev.target.value)}
          />
        </Field>
      </div>
    </section>
  );
}

function RawEditor({
  initial,
  onSaved,
  onError,
}: {
  initial: string;
  onSaved: () => void;
  onError: (e: string) => void;
}) {
  const [text, setText] = useState(initial || '{\n  "mcpServers": {}\n}\n');
  const [saving, setSaving] = useState(false);

  return (
    <div className="mt-2">
      <textarea
        className={monoCls}
        rows={14}
        spellCheck={false}
        value={text}
        onChange={(ev) => setText(ev.target.value)}
      />
      <button
        className={`${primaryCls} mt-2`}
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          try {
            await api.saveMcpRaw(text);
            onSaved();
          } catch (e) {
            onError((e as Error).message);
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving && <LuRefreshCw className="h-4 w-4 animate-spin" />}
        Save file
      </button>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-fg-subtle">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-fg-faint">{hint}</span>}
    </label>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2">
      <input
        type="checkbox"
        className="mt-0.5 accent-accent"
        checked={checked}
        onChange={(ev) => onChange(ev.target.checked)}
      />
      <span className="min-w-0">
        <span className="block text-sm text-fg">{label}</span>
        {hint && <span className="block text-xs text-fg-faint">{hint}</span>}
      </span>
    </label>
  );
}
