import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LuArrowDown, LuArrowLeft, LuArrowUp, LuCloudDownload, LuGitBranch, LuRefreshCw } from "react-icons/lu";
import { gitApi, type GhState, type GitState } from "../../git-api";
import { Branches } from "./Branches";
import { Changes } from "./Changes";
import { Ctx, useGit, type GitCtx, type View } from "./context";
import { ErrorNote, Quiet, TextButton } from "./bits";
import { History } from "./History";
import { Pulls } from "./Pulls";
import { ViewHost } from "./views";

export type GitTab = "changes" | "history" | "branches" | "pulls";
export const GIT_TABS: { id: GitTab; label: string }[] = [
  { id: "changes", label: "Changes" },
  { id: "history", label: "History" },
  { id: "branches", label: "Branches" },
  { id: "pulls", label: "Pull requests" },
];

/** While the agent works, what it commits or checks out from the shell is noticed this often. */
const WHILE_RUNNING_MS = 8000;

/**
 * Git for the chat's folder, in the page: what changed and its diffs, staging
 * and committing, the history, branches, pushing and pulling — and pull
 * requests, through gh where it is installed and signed in.
 *
 * A panel of its own beside Files and the terminal rather than a part of
 * Files: it is a different question ("what did we change, and where does it
 * go") with more to it than a file list has room for. It watches the agent the
 * way Files does — a file it wrote, or the end of its turn, reads the state
 * again — so what it shows is what is there.
 *
 * What it drills into — a diff, a commit, a pull request — goes on top of the
 * tab, with a way back, rather than beside it: the panel is often a third of
 * the screen, and a list beside a diff leaves room for neither.
 */
export function GitPanel({
  sessionId,
  tab,
  onTab,
  activity,
  running,
  onOpenFile,
  onCount,
}: {
  sessionId: string;
  tab: GitTab;
  onTab: (tab: GitTab) => void;
  /** Bumped whenever the agent reads or writes a file. */
  activity?: number;
  running?: boolean;
  /** Open a file, by its path in the chat's folder, in Files. */
  onOpenFile?: (path: string) => void;
  /** How many files have changed, for the tab. */
  onCount?: (n: number) => void;
}) {
  const [state, setState] = useState<GitState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [stack, setStack] = useState<View[]>([]);
  const [gh, setGh] = useState<GhState | null>(null);
  const asked = useRef(0);

  // Whether pull requests can be had: asked apart, since it asks GitHub, and
  // what is on this disk is not held back while it answers. Again on Refresh.
  const askGh = useCallback(
    (fresh = false) =>
      gitApi.gh(sessionId, fresh).then(setGh, (e) =>
        setGh({ installed: true, authed: false, repo: null, url: null, defaultBranch: null, note: (e as Error).message }),
      ),
    [sessionId],
  );
  const isRepo = state?.repo === true;
  useEffect(() => {
    if (isRepo) void askGh();
  }, [isRepo, askGh]);

  const reload = useCallback(
    async () => {
      const ask = ++asked.current;
      try {
        const next = await gitApi.state(sessionId);
        if (ask !== asked.current) return;
        setState(next);
        setLoadError(null);
      } catch (e) {
        if (ask !== asked.current) return;
        setLoadError((e as Error).message);
      }
    },
    [sessionId],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  // The agent wrote something: read it again, once it has stopped for a moment.
  useEffect(() => {
    if (!activity) return;
    const t = setTimeout(() => void reload(), 600);
    return () => clearTimeout(t);
  }, [activity, reload]);

  // Its turn ended — a commit it made from the shell is no file activity — and while it works, now and then.
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running) void reload();
    wasRunning.current = running;
    if (!running) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, WHILE_RUNNING_MS);
    return () => clearInterval(t);
  }, [running, reload]);

  // Back to the page after a while elsewhere: whatever happened meanwhile.
  useEffect(() => {
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reload]);

  const count = state?.repo ? state.files.length : 0;
  useEffect(() => onCount?.(count), [count, onCount]);

  // Another tab is another place: what was open over this one is left behind.
  useEffect(() => setStack([]), [tab]);

  const act = useCallback(
    async (label: string, step: () => Promise<unknown>) => {
      if (busy) return false;
      setBusy(label);
      setError(null);
      setSaid(null);
      try {
        const result = (await step()) as { said?: string } | undefined;
        if (result && typeof result === "object" && typeof result.said === "string" && result.said.trim()) setSaid(result.said.trim());
        return true;
      } catch (e) {
        setError((e as Error).message);
        return false;
      } finally {
        setBusy(null);
        await reload();
      }
    },
    [busy, reload],
  );

  const ctx: GitCtx | null = useMemo(() => {
    if (!state?.repo) return null;
    const prefix = state.prefix ? `${state.prefix}/` : "";
    return {
      id: sessionId,
      repo: { ...state, gh },
      reload: () => reload(),
      act,
      busy,
      show: (view) => setStack((s) => [...s, view]),
      // Files shows the chat's folder; a file of the repository outside it is not there to open.
      openFile: onOpenFile ? (p) => (p.startsWith(prefix) ? onOpenFile(p.slice(prefix.length)) : undefined) : undefined,
    };
  }, [state, gh, sessionId, reload, act, busy, onOpenFile]);

  if (!state) {
    return loadError ? <ErrorNote>{loadError}</ErrorNote> : <Quiet>Loading…</Quiet>;
  }

  if (!state.repo) {
    return (
      <div className="flex flex-col items-start gap-2 p-3 text-xs text-fg-subtle">
        <p>This chat's folder is not in a git repository.</p>
        <TextButton primary disabled={!!busy} onClick={() => void act("Making a repository", () => gitApi.init(sessionId))}>
          Make it one (git init)
        </TextButton>
        {error && <ErrorNote onClose={() => setError(null)}>{error}</ErrorNote>}
      </div>
    );
  }

  const top = stack[stack.length - 1];
  return (
    <Ctx.Provider value={ctx}>
      <div className="flex h-full min-h-0 flex-col text-sm" data-git-tab={tab}>
        <BranchBar onBranches={() => onTab("branches")} onRefresh={() => void act("Refreshing", () => Promise.all([reload(), askGh(true)]))} />
        {state.operation && <Operation />}
        {busy && (
          <p role="status" className="shrink-0 border-b border-line bg-accent/5 px-3 py-1 text-[11px] text-accent">
            {busy}…
          </p>
        )}
        {error && <ErrorNote onClose={() => setError(null)}>{error}</ErrorNote>}
        {said && (
          <p role="status" className="mx-2 mt-2 flex items-start gap-1 rounded-lg bg-fg/5 px-2 py-1.5 font-mono text-[11px] text-fg-subtle">
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{said}</span>
            <button type="button" onClick={() => setSaid(null)} aria-label="Dismiss" className="shrink-0 rounded px-1 hover:text-fg">
              ✕
            </button>
          </p>
        )}
        {top ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <button
              type="button"
              onClick={() => setStack((s) => s.slice(0, -1))}
              className="flex shrink-0 items-center gap-1 border-b border-line px-3 py-1 text-left text-[11px] text-fg-subtle transition hover:bg-fg/5 hover:text-fg"
            >
              <LuArrowLeft aria-hidden className="h-3 w-3" /> Back
            </button>
            <ViewHost key={stack.length} view={top} onDone={() => setStack((s) => s.slice(0, -1))} />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {tab === "changes" && <Changes />}
            {tab === "history" && <History />}
            {tab === "branches" && <Branches />}
            {tab === "pulls" && <Pulls />}
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}

/** Where the repository is: the branch, how far it is from its upstream, and the ways to bring the two together. */
function BranchBar({ onBranches, onRefresh }: { onBranches: () => void; onRefresh: () => void }) {
  const { id, repo, act, busy } = useGit();
  const hasRemote = repo.remotes.length > 0;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line px-2 py-1.5 text-xs">
      <button
        type="button"
        onClick={onBranches}
        title={repo.branch ? `On ${repo.branch} — branches` : "Not on a branch — branches"}
        className="flex min-w-0 max-w-[60%] items-center gap-1 rounded px-1.5 py-0.5 text-fg transition hover:bg-fg/5"
      >
        <LuGitBranch aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
        <span className="truncate font-mono text-[11.5px]">{repo.branch ?? `detached at ${repo.head?.slice(0, 7) ?? "nothing"}`}</span>
      </button>
      {repo.upstream ? (
        <span className="shrink-0 font-mono text-[10.5px] text-fg-faint" title={`Following ${repo.upstream}: ${repo.ahead} to push, ${repo.behind} to pull`}>
          {repo.ahead > 0 && <span className="text-accent">↑{repo.ahead} </span>}
          {repo.behind > 0 && <span className="text-warn">↓{repo.behind} </span>}
          {!repo.ahead && !repo.behind && "✓ "}
          {repo.upstream}
        </span>
      ) : (
        repo.branch && hasRemote && <span className="shrink-0 text-[10.5px] text-fg-faint">not on the remote yet</span>
      )}
      <div className="ml-auto flex items-center gap-0.5">
        {hasRemote && (
          <>
            <BarButton label="Fetch — see what is new on the remote" disabled={!!busy} onClick={() => void act("Fetching", () => gitApi.fetch(id))}>
              <LuCloudDownload aria-hidden className="h-3.5 w-3.5" />
            </BarButton>
            <BarButton label={`Pull${repo.behind ? ` ${repo.behind}` : ""} — fast-forward only`} disabled={!!busy || !repo.upstream} onClick={() => void act("Pulling", () => gitApi.pull(id))}>
              <LuArrowDown aria-hidden className="h-3.5 w-3.5" />
              {repo.behind > 0 && <span className="text-[10px]">{repo.behind}</span>}
            </BarButton>
            <BarButton
              label={repo.upstream ? `Push${repo.ahead ? ` ${repo.ahead}` : ""}` : "Publish this branch to the remote"}
              disabled={!!busy || !repo.branch || (!!repo.upstream && !repo.ahead)}
              onClick={() => void act(repo.upstream ? "Pushing" : "Publishing", () => gitApi.push(id))}
            >
              <LuArrowUp aria-hidden className="h-3.5 w-3.5" />
              {repo.upstream ? repo.ahead > 0 && <span className="text-[10px]">{repo.ahead}</span> : <span className="text-[10px]">Publish</span>}
            </BarButton>
          </>
        )}
        <BarButton label="Refresh" disabled={!!busy} onClick={onRefresh}>
          <LuRefreshCw aria-hidden className={`h-3.5 w-3.5 ${busy === "Refreshing" ? "animate-spin" : ""}`} />
        </BarButton>
      </div>
    </div>
  );
}

function BarButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="flex shrink-0 items-center gap-0.5 rounded px-1.5 py-1 text-fg-subtle transition hover:bg-fg/5 hover:text-fg disabled:opacity-35"
    >
      {children}
    </button>
  );
}

/** A merge or rebase that stopped half way, and the two ways out of it. */
function Operation() {
  const { id, repo, act, busy } = useGit();
  const conflicts = repo.files.filter((f) => f.kind === "conflict").length;
  const name = repo.operation === "cherry-pick" ? "Cherry-picking" : repo.operation === "revert" ? "Reverting" : repo.operation === "rebase" ? "Rebasing" : "Merging";
  return (
    <div role="status" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-warn/10 px-3 py-1.5 text-xs text-warn">
      <span className="min-w-0 flex-1">
        {name} —{" "}
        {conflicts ? `${conflicts} ${conflicts === 1 ? "file is" : "files are"} in conflict. Resolve and stage them, then continue.` : "ready to continue."}
      </span>
      <TextButton disabled={!!busy || conflicts > 0} onClick={() => void act("Continuing", () => gitApi.continue(id))}>
        Continue
      </TextButton>
      <TextButton danger disabled={!!busy} onClick={() => void act(`Giving up the ${repo.operation}`, () => gitApi.abort(id))}>
        Abort
      </TextButton>
    </div>
  );
}
