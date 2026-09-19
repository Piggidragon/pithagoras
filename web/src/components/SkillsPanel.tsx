import { useEffect, useState } from "react";
import {
  LuCheck,
  LuChevronLeft,
  LuChevronRight,
  LuCircleAlert,
  LuLock,
  LuPlus,
  LuRefreshCw,
  LuDownload,
  LuGithub,
  LuTrash2,
  LuTriangleAlert,
  LuWrench,
} from "react-icons/lu";
import { api, type FoundSkill, type Skill, type SkillDiagnostic } from "../api";
import { confirmDialog } from "./ConfirmDialog";

const inputCls =
  "w-full rounded-lg border border-line bg-raised/60 px-3 py-2 text-sm outline-none transition placeholder:text-fg-faint focus:border-accent/60";
const btnCls =
  "inline-flex items-center gap-1.5 rounded-lg bg-fg/5 px-3 py-2 text-sm text-fg transition hover:bg-fg/10 disabled:opacity-40";
const primaryCls =
  "inline-flex items-center gap-1.5 rounded-lg bg-accent/12 px-3 py-2 text-sm text-accent ring-1 ring-inset ring-accent/25 transition hover:bg-accent/20 disabled:opacity-40";

/**
 * Skills the agent can reach for.
 *
 * The list is pi's own, so it matches what the model is actually offered —
 * including anything a package brought with it. Those are read-only here: a
 * package's skill belongs to the package, and editing it in place would be
 * silently undone by the next update.
 */
export function SkillsPanel({ onError }: { onError: (e: string) => void }) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [diagnostics, setDiagnostics] = useState<SkillDiagnostic[]>([]);
  const [root, setRoot] = useState("");
  const [loading, setLoading] = useState(true);
  const [openName, setOpenName] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);

  const load = async () => {
    try {
      const r = await api.skills();
      setSkills(r.skills);
      setDiagnostics(r.diagnostics ?? []);
      setRoot(r.root);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const open = skills.find((s) => s.name === openName);
  if (open) {
    return <SkillDetail skill={open} onBack={() => setOpenName(null)} onError={onError} onChanged={load} />;
  }

  const mine = skills.filter((s) => s.editable);
  const theirs = skills.filter((s) => !s.editable);

  return (
    <>
      <section className="mb-6 rounded-xl border border-line bg-raised/40 p-3">
        <p className="text-xs text-fg-subtle">
          A skill is a set of instructions the agent pulls in when its description matches what is
          being asked. Every session sees them, so they are a good place for a procedure you would
          otherwise repeat. Switching one off stops pi loading it at all, rather than hiding it
          here.
        </p>
        <p className="mt-1.5 truncate font-mono text-[11px] text-fg-faint">{root}</p>
      </section>

      {diagnostics.length > 0 && (
        <ul className="mb-5 space-y-1">
          {diagnostics.map((d, i) => (
            <li
              key={i}
              className="flex items-start gap-2 rounded-lg border border-warn/25 bg-warn/10 px-3 py-2 text-xs text-warn/90"
            >
              <LuCircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div className="min-w-0">
                <p>{d.message}</p>
                {d.path && <p className="truncate font-mono text-[10px] opacity-70">{d.path}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}

      <section className="mb-6">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">
            Yours{mine.length ? ` (${mine.length})` : ""}
          </h3>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setImporting(!importing);
                setAdding(false);
              }}
              className="text-[11px] text-accent hover:text-accent"
            >
              {importing ? "Cancel" : "Import from GitHub"}
            </button>
            <button
              onClick={() => {
                setAdding(!adding);
                setImporting(false);
              }}
              className="text-[11px] text-accent hover:text-accent"
            >
              {adding ? "Cancel" : "+ New"}
            </button>
          </div>
        </div>

        {importing && (
          <ImportSkills
            onCancel={() => setImporting(false)}
            onError={onError}
            onDone={async () => {
              setImporting(false);
              await load();
            }}
          />
        )}

        {adding && (
          <NewSkill
            onCancel={() => setAdding(false)}
            onError={onError}
            onCreated={async (name) => {
              setAdding(false);
              await load();
              setOpenName(name);
            }}
          />
        )}

        {loading ? (
          <p className="mt-2 text-sm text-fg-subtle">Loading…</p>
        ) : mine.length === 0 ? (
          <div className="mt-2 rounded-xl border border-dashed border-line px-3 py-6 text-center text-sm text-fg-subtle">
            None yet.
            <p className="mt-1 text-xs text-fg-faint">
              How you like releases cut, the shape of a good commit message, the steps for a
              deploy — anything you have explained more than twice.
            </p>
          </div>
        ) : (
          <ul className="mt-2 space-y-1">
            {mine.map((s) => (
              <SkillRow
                key={s.name}
                skill={s}
                onOpen={() => setOpenName(s.name)}
                onToggle={async (enabled) => {
                  try {
                    await api.setSkillEnabled(s.name, enabled);
                    await load();
                  } catch (e) {
                    onError((e as Error).message);
                  }
                }}
              />
            ))}
          </ul>
        )}
      </section>

      {theirs.length > 0 && (
        <section className="mb-6">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">
            Built in and from packages ({theirs.length})
          </h3>
          <ul className="mt-2 space-y-1">
            {theirs.map((s) => (
              <SkillRow key={s.name} skill={s} onOpen={() => setOpenName(s.name)} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function SkillRow({
  skill: s,
  onOpen,
  onToggle,
}: {
  skill: Skill;
  onOpen: () => void;
  onToggle?: (enabled: boolean) => void;
}) {
  return (
    <li
      className={`flex items-center gap-2.5 rounded-xl border border-line bg-raised/40 px-3 py-2.5 transition hover:bg-fg/5 ${
        s.enabled ? "" : "opacity-60"
      }`}
    >
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
        {s.broken ? (
          <LuCircleAlert className="h-3.5 w-3.5 shrink-0 text-warn" />
        ) : s.editable ? (
          <LuWrench className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
        ) : (
          <LuLock className="h-3.5 w-3.5 shrink-0 text-fg-faint" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-fg">
            {s.name}
            {!s.enabled && (
              <span className="ml-1.5 rounded bg-fg/5 px-1 py-0.5 text-[10px] text-fg-subtle">
                off
              </span>
            )}
            {s.manualOnly && (
              <span className="ml-1.5 rounded bg-fg/5 px-1 py-0.5 text-[10px] text-fg-subtle">
                /skill only
              </span>
            )}
          </p>
          <p className="line-clamp-2 text-[11px] text-fg-subtle">
            {s.broken ? (
              <span className="text-warn/90">not loading — see the warning above</span>
            ) : (
              s.description
            )}
          </p>
          {s.source && (
            <p className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-fg-faint">
              <LuGithub className="h-2.5 w-2.5 shrink-0" />
              {s.source.spec}
            </p>
          )}
        </div>
      </button>

      {onToggle ? (
        <button
          onClick={() => onToggle(!s.enabled)}
          title={s.enabled ? "Disable — pi stops loading it" : "Enable"}
          className={`relative h-5 w-9 shrink-0 rounded-full transition ${
            s.enabled ? "bg-accent" : "bg-raised"
          }`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
              s.enabled ? "left-[1.125rem]" : "left-0.5"
            }`}
          />
        </button>
      ) : (
        <LuChevronRight className="h-4 w-4 shrink-0 text-fg-faint" />
      )}
    </li>
  );
}

function NewSkill({
  onCancel,
  onCreated,
  onError,
}: {
  onCancel: () => void;
  onCreated: (name: string) => Promise<void>;
  onError: (e: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const r = await api.createSkill(name, description);
      await onCreated(r.name);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 space-y-3 rounded-xl border border-line bg-raised/40 p-3">
      <label className="block">
        <span className="text-xs text-fg-muted">Name</span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="cut-a-release"
          className={`${inputCls} mt-1 font-mono text-xs`}
        />
      </label>
      <label className="block">
        <span className="text-xs text-fg-muted">When to use it</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Use when cutting a release: version bump, changelog, tag and push."
          className={`${inputCls} mt-1 resize-y text-xs leading-relaxed`}
        />
        <p className="mt-1 text-[11px] text-fg-faint">
          This is the only part the model reads when deciding whether the skill applies. Say when,
          not what.
        </p>
      </label>
      <div className="flex items-center gap-2">
        <button disabled={!name.trim() || !description.trim() || busy} onClick={create} className={primaryCls}>
          {busy ? <LuRefreshCw className="h-4 w-4 animate-spin" /> : <LuPlus className="h-4 w-4" />}
          Create
        </button>
        <button onClick={onCancel} className={btnCls}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function SkillDetail({
  skill: s,
  onBack,
  onError,
  onChanged,
}: {
  skill: Skill;
  onBack: () => void;
  onError: (e: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(s.content);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => setDraft(s.content), [s.name, s.content]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-fg-subtle transition hover:text-fg-muted"
      >
        <LuChevronLeft className="h-3.5 w-3.5" /> Skills
      </button>

      <div className="mb-5 flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
          {s.editable ? <LuWrench className="h-4 w-4" /> : <LuLock className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium text-fg">{s.name}</h3>
          <p className="text-xs text-fg-subtle">
            {s.broken ? (
              <span className="text-warn/90">
                pi cannot parse this, so the agent is not seeing it. Fix the frontmatter below.
              </span>
            ) : (
              s.description
            )}
          </p>
          <p className="mt-0.5 truncate font-mono text-[10px] text-fg-faint">{s.path}</p>
        </div>
        {s.editable && (
          <button
            onClick={() => act(() => api.setSkillEnabled(s.name, !s.enabled))}
            disabled={busy}
            title={s.enabled ? "Disable" : "Enable"}
            className={`relative mt-1 h-5 w-9 shrink-0 rounded-full transition disabled:opacity-40 ${
              s.enabled ? "bg-accent" : "bg-raised"
            }`}
          >
            <span
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                s.enabled ? "left-[1.125rem]" : "left-0.5"
              }`}
            />
          </button>
        )}
      </div>

      {!s.enabled && (
        <p className="mb-4 rounded-lg border border-line bg-raised/40 px-3 py-2 text-[11px] text-fg-subtle">
          Switched off. pi is not loading this, so the agent cannot see or use it.
        </p>
      )}

      {s.editable ? (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={18}
            spellCheck={false}
            className="w-full resize-y rounded-lg border border-line bg-raised/60 px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-accent/60"
          />
          <p className="mt-1 text-[11px] text-fg-faint">
            The frontmatter at the top is what pi reads — changing <code>name</code> renames the
            skill, and <code>description</code> is what the model matches against.
          </p>

          {s.source && (
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-line bg-raised/40 px-3 py-2 text-[11px] text-fg-subtle">
              <LuGithub className="h-3.5 w-3.5 shrink-0 text-fg-faint" />
              <span className="min-w-0 flex-1 truncate">
                Imported from <span className="font-mono">{s.source.spec}</span>
              </span>
              <button
                onClick={() => act(() => api.updateSkill(s.name))}
                disabled={busy}
                className="shrink-0 text-accent hover:text-accent disabled:opacity-40"
                title="Re-import, replacing local edits"
              >
                Update
              </button>
            </div>
          )}

          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() =>
                act(async () => {
                  await api.saveSkill(s.name, draft);
                  setSaved(true);
                  setTimeout(() => setSaved(false), 2000);
                })
              }
              disabled={busy || draft === s.content}
              className={primaryCls}
            >
              {busy ? (
                <LuRefreshCw className="h-4 w-4 animate-spin" />
              ) : saved ? (
                <LuCheck className="h-4 w-4" />
              ) : null}
              {saved ? "Saved" : "Save"}
            </button>
            <button
              onClick={async () => {
                if (
                  await confirmDialog({
                    title: `Delete the skill "${s.name}"?`,
                    confirmLabel: "Delete",
                    danger: true,
                  })
                ) {
                  act(async () => {
                    await api.deleteSkill(s.name);
                    onBack();
                  });
                }
              }}
              disabled={busy}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-fg-subtle transition hover:bg-danger/10 hover:text-danger disabled:opacity-40"
            >
              <LuTrash2 className="h-3.5 w-3.5" /> Delete
            </button>
          </div>
        </>
      ) : (
        <div className="flex items-start gap-2 rounded-xl border border-line bg-raised/40 px-3 py-2 text-xs text-fg-subtle">
          <LuLock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-faint" />
          <p>
            This skill came with a package. Editing it here would be undone by the next update, so
            it is read-only — change it by removing or replacing the package in Extensions.
          </p>
        </div>
      )}
    </>
  );
}

/**
 * Taking skills out of a repository.
 *
 * The repository is inspected before anything is written, so you can see what
 * is in there and what you already have — a repo of twenty skills should not be
 * an all-or-nothing decision, and neither should it quietly replace one you
 * have edited.
 */
function ImportSkills({
  onCancel,
  onDone,
  onError,
}: {
  onCancel: () => void;
  onDone: () => Promise<void>;
  onError: (e: string) => void;
}) {
  const [spec, setSpec] = useState("");
  const [found, setFound] = useState<FoundSkill[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<null | "look" | "import">(null);

  const look = async () => {
    setBusy("look");
    setFound(null);
    try {
      const r = await api.previewSkillImport(spec.trim());
      setFound(r.found);
      // Everything you do not already have, which is the common intent.
      setChosen(new Set(r.found.filter((f) => !f.installed).map((f) => f.name)));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const doImport = async () => {
    setBusy("import");
    try {
      // Overwrite is implied: anything already installed is only in the list
      // because it was ticked deliberately.
      await api.importSkills(spec.trim(), [...chosen], true);
      await onDone();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const toggle = (name: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });

  return (
    <div className="mt-2 space-y-3 rounded-xl border border-line bg-raised/40 p-3">
      <div className="flex gap-2">
        <input
          autoFocus
          value={spec}
          onChange={(e) => setSpec(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && spec.trim() && look()}
          placeholder="anthropics/skills"
          className={`${inputCls} font-mono text-xs`}
        />
        <button disabled={!spec.trim() || busy !== null} onClick={look} className={btnCls}>
          {busy === "look" ? <LuRefreshCw className="h-4 w-4 animate-spin" /> : "Look"}
        </button>
      </div>
      <p className="text-[11px] text-fg-faint">
        <code>user/repo</code>, <code>user/repo#branch</code>, a subdirectory like{" "}
        <code>user/repo/skills/pdf</code>, or a GitHub URL pasted from the address bar.
      </p>

      {found && (
        <>
          <div className="flex items-baseline justify-between">
            <p className="text-xs text-fg-muted">
              {found.length} skill{found.length === 1 ? "" : "s"} found
              {found.some((f) => f.installed) &&
                ` · ${found.filter((f) => f.installed).length} already installed`}
            </p>
            <button
              onClick={() =>
                setChosen(
                  chosen.size === found.length ? new Set() : new Set(found.map((f) => f.name))
                )
              }
              className="text-[11px] text-fg-subtle hover:text-fg-muted"
            >
              {chosen.size === found.length ? "none" : "all"}
            </button>
          </div>

          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {found.map((f) => (
              <li key={f.name}>
                <button
                  onClick={() => toggle(f.name)}
                  className={`flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition ${
                    chosen.has(f.name)
                      ? "border-accent/30 bg-accent/10"
                      : "border-line bg-raised/40 hover:bg-fg/5"
                  }`}
                >
                  <span
                    className={`mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center rounded border ${
                      chosen.has(f.name)
                        ? "border-accent/60 bg-accent/25 text-accent"
                        : "border-white/20"
                    }`}
                  >
                    {chosen.has(f.name) && <LuCheck className="h-2.5 w-2.5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-fg">
                      {f.name}
                      {f.installed && (
                        <span className="ml-1.5 rounded bg-warn/12 px-1 py-0.5 text-[10px] text-warn">
                          installed
                        </span>
                      )}
                    </p>
                    {f.description && (
                      <p className="line-clamp-2 text-[11px] text-fg-subtle">{f.description}</p>
                    )}
                    <p className="truncate font-mono text-[10px] text-fg-faint">{f.from}</p>
                  </div>
                </button>
              </li>
            ))}
          </ul>

          {[...chosen].some((n) => found.find((f) => f.name === n)?.installed) && (
            <p className="flex items-start gap-1.5 text-[11px] text-warn/90">
              <LuTriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
              A ticked skill you already have will be replaced, including any edits you made to it.
            </p>
          )}

          <div className="flex items-center gap-2">
            <button disabled={!chosen.size || busy !== null} onClick={doImport} className={primaryCls}>
              {busy === "import" ? (
                <LuRefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <LuDownload className="h-4 w-4" />
              )}
              Import {chosen.size || ""}
            </button>
            <button onClick={onCancel} className={btnCls}>
              Cancel
            </button>
          </div>
        </>
      )}

      <p className="flex items-start gap-1.5 border-t border-line pt-2 text-[11px] text-fg-faint">
        <LuTriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
        Nothing is executed by an import — a skill is markdown. But it is markdown the agent will
        follow, so take them from somewhere you would take instructions from.
      </p>
    </div>
  );
}
