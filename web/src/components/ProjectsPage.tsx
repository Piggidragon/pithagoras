import { useCallback, useEffect, useState } from "react";
import { LuFileText, LuFolderGit2, LuFolderKanban, LuPlus, LuTrash2 } from "react-icons/lu";
import { PageHeader } from "./PageHeader";
import { api, type Project, type Session } from "../api";
import { bytesLabel, slugify } from "../projects";
import { when } from "../time";
import { confirmDialog } from "./ConfirmDialog";
import { Modal } from "./Modal";
import { isEnter } from "../shortcuts";

/**
 * The folders chats work in.
 *
 * Projects are folders made on purpose, each with instructions of its own that
 * end up as the folder's AGENTS.md. Opening one opens its latest chat, or starts
 * one. Home, where "New" starts a chat, is not a project and is not listed.
 */
export function ProjectsPage({
  sessions,
  onOpenChat,
  onNewChat,
  onChanged,
}: {
  sessions: Session[];
  onOpenChat: (id: string) => void;
  /** Starts a chat in the folder and opens it. */
  onNewChat: (workspace: string) => Promise<void>;
  /** After something the chat list depends on changed, such as a project's chats going. */
  onChanged: () => void;
}) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [root, setRoot] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);

  const load = useCallback(() => {
    api
      .projects()
      .then((r) => {
        setProjects(r.projects);
        setRoot(r.root);
      })
      .catch((e) => setError((e as Error).message));
  }, []);
  // Also when the chats change: the counts and the "last active" are theirs.
  // The list is a new array on every poll, and a running chat changes its
  // timestamp on every one. What the server counts is only which chats there
  // are and where, so that is what is compared; "last active" is worked out
  // here from the list itself.
  const chats = sessions.map((s) => `${s.id}:${s.workspace}`).join("|");
  useEffect(load, [load, chats]);

  const attempt = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /** The project's newest chat, counting ones started in a subfolder. */
  const latestChat = (p: Project) =>
    sessions
      .filter((s) => s.workspace === p.path || s.workspace.startsWith(p.path + "/"))
      .reduce<Session | null>((best, s) => (!best || s.updated_at > best.updated_at ? s : best), null);

  const lastActive = (p: Project) => latestChat(p)?.updated_at ?? p.lastActive;

  const open = (p: Project) =>
    attempt(async () => {
      const latest = latestChat(p);
      if (latest) onOpenChat(latest.id);
      else await onNewChat(p.path);
    });

  const remove = (p: Project) =>
    attempt(async () => {
      const contents = await api.projectContents(p.name);
      const parts = [
        contents.sessions ? `${contents.sessions} chat${contents.sessions === 1 ? "" : "s"}` : "",
        contents.files
          ? `${contents.complete ? "" : "over "}${contents.files.toLocaleString()} file${contents.files === 1 ? "" : "s"} (${bytesLabel(contents.bytes)}) in its folder`
          : "",
      ].filter(Boolean);
      const ok = await confirmDialog({
        title: `Delete the project "${p.name}"?`,
        message: `${parts.length ? parts.join(" and ") + " go with it. " : "It is empty. "}This cannot be undone.`,
        confirmLabel: "Delete project",
        danger: true,
        deletes: true,
      });
      if (!ok) return;
      await api.deleteProject(p.name);
      onChanged();
      load();
    });

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto w-full max-w-3xl">
          <PageHeader
            icon={<LuFolderKanban />}
            title="Projects"
            description={
              <>
                New chats start in Home. A project is a folder of its own with instructions for the
                agent — saved as its AGENTS.md — for work that should stay together.
              </>
            }
            action={
              <button
                onClick={() => setCreating(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent/12 px-3 py-1.5 text-sm text-accent ring-1 ring-inset ring-accent/25 hover:bg-accent/20"
              >
                <LuPlus className="h-4 w-4" /> New project
              </button>
            }
          />

          {error && <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}

          {projects === null ? (
            <p className="py-12 text-center text-sm text-fg-subtle">Loading…</p>
          ) : (
            <ul className="mt-4 space-y-1">
              {projects.length === 0 && (
                <li className="py-12 text-center text-sm text-fg-subtle">
                  No projects yet. New chats start in Home; make a project for work that should stay together.
                </li>
              )}
              {projects.map((p) => (
                <li
                  key={p.path}
                  onClick={() => open(p)}
                  className="group flex cursor-pointer items-center gap-3 rounded-xl border border-line bg-raised/40 px-3 py-2.5 transition hover:bg-fg/5"
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-canvas text-fg-muted">
                    {p.isGit ? <LuFolderGit2 className="h-4 w-4" /> : <LuFolderKanban className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <p className="truncate text-sm text-fg">{p.name}</p>
                      {p.hasInstructions && (
                        <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">instructions</span>
                      )}
                    </div>
                    <p className="truncate font-mono text-[11px] text-fg-faint" title={p.path}>
                      {p.path}
                    </p>
                    <p className="truncate text-[11px] text-fg-faint">
                      {p.sessions} chat{p.sessions === 1 ? "" : "s"}
                      {lastActive(p) ? ` · last ${when(lastActive(p)!)}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        attempt(() => onNewChat(p.path));
                      }}
                      className="rounded p-1.5 text-fg-subtle hover:text-accent"
                      title="New chat here"
                      aria-label={`New chat in ${p.name}`}
                    >
                      <LuPlus className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(p);
                      }}
                      className="rounded p-1.5 text-fg-subtle hover:text-accent"
                      title="Instructions (AGENTS.md)"
                      aria-label={`Instructions for ${p.name}`}
                    >
                      <LuFileText className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(p);
                      }}
                      className="rounded p-1.5 text-fg-subtle hover:text-danger"
                      title="Delete project"
                      aria-label={`Delete ${p.name}`}
                    >
                      <LuTrash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {creating && (
        <NewProject
          root={root}
          onClose={() => setCreating(false)}
          onCreate={async (name, instructions) => {
            const project = await api.createProject(name, instructions);
            setCreating(false);
            load();
            // The dialog is gone by now, so a failure here is shown on the page:
            // the project exists, only its first chat did not open.
            try {
              await onNewChat(project.path);
            } catch (e) {
              setError(`"${project.name}" was created, but its chat did not open: ${(e as Error).message}`);
            }
          }}
        />
      )}
      {editing && (
        <Instructions
          project={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

const FIELD = "w-full rounded-lg border border-line bg-raised/60 px-3 py-2 text-sm outline-none placeholder:text-fg-faint focus:border-accent/60";

function NewProject({
  root,
  onClose,
  onCreate,
}: {
  /** Where the folder will be made, so the preview is the whole path. */
  root: string;
  onClose: () => void;
  onCreate: (name: string, instructions: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const slug = slugify(name);

  const submit = async () => {
    if (!slug || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(name.trim(), instructions);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New project"
      subtitle="A folder of its own, with instructions the agent follows in it"
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-2">
          {error && <p className="mr-auto text-xs text-danger">{error}</p>}
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-fg-muted hover:bg-fg/5">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!slug || busy}
            className="rounded-lg bg-accent/12 px-3 py-1.5 text-sm text-accent ring-1 ring-inset ring-accent/25 hover:bg-accent/20 disabled:opacity-40"
          >
            {busy ? "Creating…" : "Create and open"}
          </button>
        </div>
      }
    >
      <label className="block text-xs text-fg-muted">
        Name
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => isEnter(e) && submit()}
          placeholder="Cool Project"
          className={`${FIELD} mt-1`}
        />
      </label>
      {name.trim() && (
        <p className="mt-1 truncate font-mono text-[11px] text-fg-subtle">
          {slug ? `→ ${root ? `${root}/` : ""}${slug}` : "needs at least one letter or digit"}
        </p>
      )}
      <label className="mt-4 block text-xs text-fg-muted">
        Instructions <span className="text-fg-faint">(optional — saved as AGENTS.md)</span>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={8}
          placeholder="What this project is, and how the agent should work in it."
          className={`${FIELD} mt-1 resize-y font-mono text-xs`}
        />
      </label>
    </Modal>
  );
}

function Instructions({
  project,
  onClose,
  onSaved,
}: {
  project: Project;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .projectInstructions(project.name)
      .then((r) => {
        setText(r.text);
        setSaved(r.text);
      })
      .catch((e) => setError((e as Error).message));
  }, [project.name]);

  const save = async () => {
    if (text === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.setProjectInstructions(project.name, text);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Instructions · ${project.name}`}
      subtitle="Saved as AGENTS.md in the folder — edit it there too if you like"
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-2">
          {error && <p className="mr-auto text-xs text-danger">{error}</p>}
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-fg-muted hover:bg-fg/5">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={text === null || text === saved || busy}
            className="rounded-lg bg-accent/12 px-3 py-1.5 text-sm text-accent ring-1 ring-inset ring-accent/25 hover:bg-accent/20 disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      }
    >
      {text === null ? (
        <p className="py-8 text-center text-sm text-fg-subtle">{error ? "" : "Loading…"}</p>
      ) : (
        <>
          <textarea
            autoFocus
            aria-label="Project instructions"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={14}
            placeholder="What this project is, and how the agent should work in it."
            className={`${FIELD} resize-y font-mono text-xs`}
          />
          <p className="mt-2 text-[11px] text-fg-subtle">
            Chats started after saving pick this up. One already open does after <code>/reload</code>.
            Leave it empty to remove the file.
          </p>
        </>
      )}
    </Modal>
  );
}
