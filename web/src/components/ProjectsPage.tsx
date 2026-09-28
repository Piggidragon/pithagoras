import { useCallback, useEffect, useState } from "react";
import { LuFileText, LuFolderGit2, LuFolderKanban, LuPlus, LuTrash2 } from "react-icons/lu";
import { PageHeader } from "./PageHeader";
import { RowsSkeleton } from "./Skeleton";
import { api, type Project, type Session } from "../api";
import { bytesLabel, slugify } from "../projects";
import { within } from "../session-folders";
import { when } from "../time";
import { confirmDialog } from "./ConfirmDialog";
import { Modal } from "./Modal";
import { isEnter } from "../shortcuts";
import { t, tp, tx } from "../i18n";

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
      .filter((s) => within(p.path, s.workspace))
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
        contents.sessions ? tp(contents.sessions, "{n} chat", "{n} chats") : "",
        contents.files
          ? contents.complete
            ? tp(contents.files, "{n} file ({size}) in its folder", "{n} files ({size}) in its folder", { size: bytesLabel(contents.bytes) })
            : tp(contents.files, "over {n} file ({size}) in its folder", "over {n} files ({size}) in its folder", { size: bytesLabel(contents.bytes) })
          : "",
      ].filter(Boolean);
      const routines = contents.routines ?? [];
      // They stay, with their history, but have nowhere left to run.
      const names = routines.map((r) => `"${r}"`).join(", ");
      const stranded =
        routines.length === 0
          ? ""
          : routines.length === 1
            ? ` ${t("The routine {names} runs here: it is switched off until it is given another place, and keeps its history.", { names })}`
            : ` ${t("The routines {names} run here: they are switched off until they are given another place, and keep their history.", { names })}`;
      const going = parts.length === 2
        ? t("{first} and {second} go with it.", { first: parts[0], second: parts[1] })
        : parts.length === 1
          ? t("{what} goes with it.", { what: parts[0] })
          : t("It is empty.");
      const ok = await confirmDialog({
        title: t("Delete the project \"{name}\"?", { name: p.name }),
        message: `${going} ${t("This cannot be undone.")}${stranded}`,
        confirmLabel: t("Delete project"),
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
            title={t("Projects")}
            description={
              <>
                {t("New chats start in Home. A project is a folder of its own with instructions for the agent — saved as its AGENTS.md — for work that should stay together.")}
              </>
            }
            action={
              <button
                onClick={() => setCreating(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent/12 px-3 py-1.5 text-sm text-accent ring-1 ring-inset ring-accent/25 hover:bg-accent/20"
              >
                <LuPlus className="h-4 w-4" /> {t("New project")}
              </button>
            }
          />

          {error && <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}

          {projects === null ? (
            <RowsSkeleton />
          ) : (
            <ul className="stagger-in mt-4 space-y-1">
              {projects.length === 0 && (
                <li className="py-12 text-center text-sm text-fg-subtle">
                  {t("No projects yet. New chats start in Home; make a project for work that should stay together.")}
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
                        <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">{t("instructions")}</span>
                      )}
                    </div>
                    <p className="truncate font-mono text-[11px] text-fg-faint" title={p.path}>
                      {p.path}
                    </p>
                    <p className="truncate text-[11px] text-fg-faint">
                      {tp(p.sessions, "{n} chat", "{n} chats")}
                      {lastActive(p) ? ` · ${t("last {when}", { when: when(lastActive(p)!) })}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        attempt(() => onNewChat(p.path));
                      }}
                      className="rounded p-1.5 text-fg-subtle hover:text-accent"
                      title={t("New chat here")}
                      aria-label={t("New chat in {name}", { name: p.name })}
                    >
                      <LuPlus className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(p);
                      }}
                      className="rounded p-1.5 text-fg-subtle hover:text-accent"
                      title={t("Instructions (AGENTS.md)")}
                      aria-label={t("Instructions for {name}", { name: p.name })}
                    >
                      <LuFileText className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(p);
                      }}
                      className="rounded p-1.5 text-fg-subtle hover:text-danger"
                      title={t("Delete project")}
                      aria-label={t("Delete {name}", { name: p.name })}
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
            // The chats' folders have one more, even if its chat does not open.
            onChanged();
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
      title={t("New project")}
      subtitle={t("A folder of its own, with instructions the agent follows in it")}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-2">
          {error && <p className="mr-auto text-xs text-danger">{error}</p>}
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-fg-muted hover:bg-fg/5">
            {t("Cancel")}
          </button>
          <button
            onClick={submit}
            disabled={!slug || busy}
            className="rounded-lg bg-accent/12 px-3 py-1.5 text-sm text-accent ring-1 ring-inset ring-accent/25 hover:bg-accent/20 disabled:opacity-40"
          >
            {busy ? t("Creating…") : t("Create and open")}
          </button>
        </div>
      }
    >
      <label className="block text-xs text-fg-muted">
        {t("Name")}
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => isEnter(e) && submit()}
          placeholder={t("Cool Project")}
          className={`${FIELD} mt-1`}
        />
      </label>
      {name.trim() && (
        <p className="mt-1 truncate font-mono text-[11px] text-fg-subtle">
          {slug ? `→ ${root ? `${root}/` : ""}${slug}` : t("needs at least one letter or digit")}
        </p>
      )}
      <label className="mt-4 block text-xs text-fg-muted">
        {t("Instructions")} <span className="text-fg-faint">{t("(optional — saved as AGENTS.md)")}</span>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={8}
          placeholder={t("What this project is, and how the agent should work in it.")}
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
      title={t("Instructions · {name}", { name: project.name })}
      subtitle={t("Saved as AGENTS.md in the folder — edit it there too if you like")}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-2">
          {error && <p className="mr-auto text-xs text-danger">{error}</p>}
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-fg-muted hover:bg-fg/5">
            {t("Cancel")}
          </button>
          <button
            onClick={save}
            disabled={text === null || text === saved || busy}
            className="rounded-lg bg-accent/12 px-3 py-1.5 text-sm text-accent ring-1 ring-inset ring-accent/25 hover:bg-accent/20 disabled:opacity-40"
          >
            {busy ? t("Saving…") : t("Save")}
          </button>
        </div>
      }
    >
      {text === null ? (
        <p className="py-8 text-center text-sm text-fg-subtle">{error ? "" : t("Loading…")}</p>
      ) : (
        <>
          <textarea
            autoFocus
            aria-label={t("Project instructions")}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={14}
            placeholder={t("What this project is, and how the agent should work in it.")}
            className={`${FIELD} resize-y font-mono text-xs`}
          />
          <p className="mt-2 text-[11px] text-fg-subtle">
            {tx("Chats started after saving pick this up. One already open does after {command}. Leave it empty to remove the file.", { command: <code>/reload</code> })}
          </p>
        </>
      )}
    </Modal>
  );
}
