import { useEffect, useMemo, useState, type FormEvent } from "react";
import { LuCircleCheck, LuCircleDot, LuCircleX, LuExternalLink, LuGitCompareArrows, LuGitMerge, LuGitPullRequest, LuLoader } from "react-icons/lu";
import { Streamdown } from "streamdown";
import { gitApi, type Check, type Comparison, type PullDetail, type PullSummary } from "../../git-api";
import { parseDiff, type DiffFile } from "../../git-diff";
import { confirmDialog } from "../ConfirmDialog";
import { Counts, ErrorNote, Letter, Quiet, SectionHead, splitPath, TextButton } from "./bits";
import { useGit } from "./context";
import { when } from "../../time";
import { t } from "../../i18n";


/** Where a pull request is: open, draft, merged or closed. */
function StateBadge({ pull }: { pull: Pick<PullSummary, "state" | "isDraft"> }) {
  const state = pull.isDraft && pull.state === "OPEN" ? "DRAFT" : pull.state;
  const look: Record<string, string> = {
    OPEN: "text-ok ring-ok/30",
    DRAFT: "text-fg-subtle ring-line",
    MERGED: "text-accent ring-accent/30",
    CLOSED: "text-danger ring-danger/30",
  };
  return <span className={`shrink-0 rounded px-1 text-[10px] ring-1 ring-inset ${look[state] ?? "text-fg-subtle ring-line"}`}>{state.toLowerCase()}</span>;
}

/**
 * Pull requests, through gh: the one for the branch checked out (or a way to
 * open it), and the repository's list. Without gh, or signed out, it says so —
 * and the branch can still be compared with its base, which is most of what a
 * pull request is for before anybody else looks at it.
 */
export function Pulls() {
  const { id, repo, show } = useGit();
  const gh = repo.gh;
  const [state, setState] = useState("open");
  const [list, setList] = useState<PullSummary[] | null>(null);
  const [current, setCurrent] = useState<PullDetail | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  // Bumped when a pull request is opened here: nothing on this disk moved, and
  // both lists would go on offering to open it.
  const [opened, setOpened] = useState(0);

  useEffect(() => {
    if (!gh?.repo) return;
    let gone = false;
    setList(null);
    setError(null);
    gitApi.pulls(id, state).then(
      (r) => !gone && setList(r.pulls),
      (e) => !gone && setError((e as Error).message),
    );
    return () => {
      gone = true;
    };
  }, [id, gh?.repo, state, repo.head, opened]);

  useEffect(() => {
    if (!gh?.repo) return;
    let gone = false;
    gitApi.currentPull(id).then(
      (r) => !gone && setCurrent(r.pull),
      () => !gone && setCurrent(null),
    );
    return () => {
      gone = true;
    };
  }, [id, gh?.repo, repo.branch, repo.head, opened]);

  const onDefault = !repo.branch || repo.branch === gh?.defaultBranch;
  const web = repo.remotes.find((r) => r.name === "origin")?.web ?? repo.remotes[0]?.web;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <button
        type="button"
        onClick={() => show({ kind: "compare" })}
        className="flex w-full items-center gap-1.5 border-b border-line px-3 py-1.5 text-left text-[11px] text-fg-subtle transition hover:bg-fg/5 hover:text-fg"
      >
        <LuGitCompareArrows aria-hidden className="h-3.5 w-3.5" />
        {t("Compare")} {repo.branch ?? t("HEAD")} {t("with its base")}
      </button>
      {!gh ? (
        <Quiet>{t("Asking GitHub…")}</Quiet>
      ) : !gh.repo ? (
        <div className="px-3 py-3 text-xs text-fg-subtle">
          <p>{gh.note ?? t("Pull requests need gh and a repository on GitHub.")}</p>
          {web && (
            <a href={web} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-accent hover:underline">
              {t("Open the repository on the web")} <LuExternalLink aria-hidden className="h-3 w-3" />
            </a>
          )}
        </div>
      ) : (
        <>
          <SectionHead title={t("This branch")} />
          {current === undefined ? (
            <Quiet>{t("Loading…")}</Quiet>
          ) : current ? (
            <PullRow pull={current} />
          ) : onDefault ? (
            <Quiet>{t("On")} {repo.branch ?? t("no branch")} {t("— switch to a branch of your own to open a pull request from it.")}</Quiet>
          ) : (
            <OpenPull
              onOpened={(n) => {
                setOpened((k) => k + 1);
                if (n) show({ kind: "pull", n });
              }}
            />
          )}
          <SectionHead title={t("Pull requests")}>
            <select value={state} onChange={(e) => setState(e.target.value)} aria-label={t("Which pull requests")} className="rounded border border-line bg-canvas px-1 py-0.5 text-[11px] text-fg">
              <option value="open">{t("Open")}</option>
              <option value="merged">{t("Merged")}</option>
              <option value="closed">{t("Closed")}</option>
              <option value="all">{t("All")}</option>
            </select>
          </SectionHead>
          {error && <ErrorNote onClose={() => setError(null)}>{error}</ErrorNote>}
          {!list && !error && <Quiet>{t("Loading…")}</Quiet>}
          {list && !list.length && <Quiet>None.</Quiet>}
          {list?.map((p) => <PullRow key={p.number} pull={p} />)}
        </>
      )}
    </div>
  );
}

function PullRow({ pull: p }: { pull: PullSummary }) {
  const { show } = useGit();
  return (
    <button type="button" onClick={() => show({ kind: "pull", n: p.number })} className="flex w-full flex-col gap-0.5 border-b border-line/50 px-3 py-1.5 text-left transition hover:bg-fg/5">
      <span className="flex min-w-0 items-center gap-1.5">
        <LuGitPullRequest aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-faint" />
        <span className="min-w-0 flex-1 truncate text-xs text-fg">{p.title}</span>
        <StateBadge pull={p} />
      </span>
      <span className="flex min-w-0 items-center gap-1.5 pl-5 text-[10.5px] text-fg-faint">
        <span className="shrink-0">#{p.number}</span>
        <span className="min-w-0 truncate font-mono">
          {p.headRefName} → {p.baseRefName}
        </span>
        {p.author && <span className="shrink-0">{p.author.login}</span>}
        {p.reviewDecision && <span className="shrink-0">{p.reviewDecision.toLowerCase().replace(/_/g, " ")}</span>}
        <span className="ml-auto shrink-0">{when(p.updatedAt)}</span>
      </span>
    </button>
  );
}

/** Open a pull request for the branch checked out: pushed first if it is not on GitHub yet. */
/** `onOpened` is told of every pull request opened, with its number where gh's answer gave one. */
function OpenPull({ onOpened }: { onOpened: (n?: number) => void }) {
  const { id, repo, act, busy } = useGit();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const defaultBranch = repo.gh?.defaultBranch ?? null;
  // Where the default branch is in this clone: on the remote that is the
  // repository — in a fork's clone not origin, which is the fork.
  const baseRef = repo.gh?.baseRef ?? null;
  const [base, setBase] = useState(defaultBranch ?? "");
  const [unfilled, setUnfilled] = useState<string | null>(null);
  const [draft, setDraft] = useState(false);
  const [comparison, setComparison] = useState<Comparison | null>(null);

  // Filled in from what the branch adds: one commit is its own title; several are listed.
  useEffect(() => {
    if (!open) return;
    setUnfilled(null);
    gitApi.compare(id, baseRef ?? undefined).then(
      (r) => {
        const c = r.comparison;
        setComparison(c);
        if (!c) return setUnfilled("Nothing to compare the branch with, so nothing is filled in.");
        setTitle((t) => t || (c.commits.length === 1 ? c.commits[0].subject : (repo.branch ?? "").replace(/^[^/]+\//, "").replace(/[-_]/g, " ")));
        setBody((b) => b || (c.commits.length > 1 ? c.commits.map((x) => `- ${x.subject}`).reverse().join("\n") : ""));
      },
      (e) => setUnfilled(`Not filled in: ${(e as Error).message}`),
    );
  }, [open, id, baseRef, repo.branch]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    let url = "";
    const ok = await act(repo.upstream ? "Opening the pull request" : "Pushing, and opening the pull request", async () => {
      url = (await gitApi.createPull(id, { title, body, base: base || undefined, draft })).url;
    });
    const n = Number(/\/pull\/(\d+)/.exec(url)?.[1]);
    if (ok) onOpened(n || undefined);
  };

  if (!open) {
    return (
      <div className="px-3 py-2">
        <TextButton primary onClick={() => setOpen(true)}>
          <LuGitPullRequest aria-hidden className="h-3.5 w-3.5" /> {t("Open a pull request for")} {repo.branch}
        </TextButton>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-1.5 border-b border-line px-3 py-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t("Title")}
        aria-label={t("Title of the pull request")}
        className="rounded border border-line bg-canvas px-2 py-1 text-xs text-fg outline-none focus:border-accent/60"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={5}
        placeholder={t("What it does, and why (Markdown)")}
        aria-label={t("Description of the pull request")}
        className="resize-y rounded border border-line bg-canvas px-2 py-1 text-xs text-fg outline-none focus:border-accent/60"
      />
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-fg-subtle">
        <label className="flex items-center gap-1">
          {t("into")}
          <input value={base} onChange={(e) => setBase(e.target.value)} aria-label={t("Base branch")} spellCheck={false} className="w-28 rounded border border-line bg-canvas px-1 py-0.5 font-mono text-[11px] text-fg" />
        </label>
        <label className="flex cursor-pointer items-center gap-1">
          <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} className="h-3 w-3 accent-accent" />
          {t("Draft")}
        </label>
        {comparison && (
          <span className="text-fg-faint">
            {comparison.commits.length} {comparison.commits.length === 1 ? t("commit") : t("commits")}, {comparison.files.length} {comparison.files.length === 1 ? t("file") : t("files")}
          </span>
        )}
        <span className="ml-auto" />
        <TextButton onClick={() => setOpen(false)}>{t("Cancel")}</TextButton>
        <TextButton type="submit" primary disabled={!title.trim() || !!busy}>
          {repo.upstream ? t("Open") : t("Push and open")}
        </TextButton>
      </div>
      {unfilled && <p className="text-[10.5px] text-fg-faint">{unfilled}</p>}
      {repo.files.length > 0 && <p className="text-[10.5px] text-warn">{repo.files.length} {t("changed files are not committed — they are not part of it.")}</p>}
    </form>
  );
}

function CheckIcon({ check }: { check: Check }) {
  const result = (check.conclusion || check.state || check.status || "").toUpperCase();
  if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(result)) return <LuCircleCheck aria-label={t("Passed")} className="h-3.5 w-3.5 shrink-0 text-ok" />;
  if (["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(result)) return <LuCircleX aria-label={t("Failed")} className="h-3.5 w-3.5 shrink-0 text-danger" />;
  if (["IN_PROGRESS", "QUEUED", "PENDING", "EXPECTED", "WAITING", "REQUESTED"].includes(result)) return <LuLoader aria-label={t("Running")} className="h-3.5 w-3.5 shrink-0 animate-spin text-warn" />;
  return <LuCircleDot aria-label={result.toLowerCase()} className="h-3.5 w-3.5 shrink-0 text-fg-faint" />;
}

const Markdown = ({ children }: { children: string }) => (
  <div className="md text-xs leading-relaxed text-fg [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-xs [&_h1]:font-semibold [&_h2]:font-semibold">
    <Streamdown shikiTheme={["github-light", "github-dark"]}>{children}</Streamdown>
  </div>
);

/** One pull request: what it is, its checks, its files, what was said — and what can be done with it. */
export function PullView({ n }: { n: number }) {
  const { id, repo, act, busy, show } = useGit();
  const [pull, setPull] = useState<PullDetail | null>(null);
  const [files, setFiles] = useState<{ files: DiffFile[]; truncated: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<"merge" | "squash" | "rebase">("squash");
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [reply, setReply] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let gone = false;
    gitApi.pullDetail(id, n).then(
      (r) => !gone && setPull(r.pull),
      (e) => !gone && setError((e as Error).message),
    );
    gitApi.pullDiff(id, n).then(
      (r) => !gone && setFiles({ files: parseDiff(r.diff), truncated: r.truncated }),
      () => !gone && setFiles({ files: [], truncated: false }),
    );
    return () => {
      gone = true;
    };
  }, [id, n, tick]);

  const conversation = useMemo(() => {
    if (!pull) return [];
    const said = [
      ...(pull.comments ?? []).map((c) => ({ who: c.author?.login ?? "someone", body: c.body, at: c.createdAt, state: "" })),
      ...(pull.reviews ?? []).filter((r) => r.body || r.state !== "COMMENTED").map((r) => ({ who: r.author?.login ?? "someone", body: r.body, at: r.submittedAt, state: r.state })),
    ];
    return said.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }, [pull]);

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!pull) return <Quiet>{t("Loading…")}</Quiet>;
  const open = pull.state === "OPEN";
  const checks = pull.statusCheckRollup ?? [];
  const here = repo.branch === pull.headRefName;
  const after = () => setTick((t) => t + 1);

  const merge = async () => {
    const ok = await confirmDialog({
      title: `Merge #${pull.number}?`,
      message: `${method === "squash" ? "Squashed into one commit" : method === "rebase" ? "Rebased" : "With a merge commit"} on ${pull.baseRefName}, on GitHub.${deleteBranch ? ` ${pull.headRefName} is deleted afterwards.` : ""}`,
      confirmLabel: "Merge",
    });
    if (ok && (await act(`Merging #${pull.number}`, () => gitApi.mergePull(id, pull.number, method, deleteBranch)))) after();
  };

  const review = async (action: "approve" | "request-changes" | "comment") => {
    const label = action === "approve" ? "Approving" : action === "request-changes" ? "Asking for changes" : "Commenting";
    if (await act(label, () => (action === "comment" ? gitApi.commentPull(id, pull.number, reply) : gitApi.reviewPull(id, pull.number, action, reply)))) {
      setReply("");
      after();
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="border-b border-line px-3 py-2">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 text-sm font-medium text-fg">
            {pull.title} <span className="font-normal text-fg-faint">#{pull.number}</span>
          </p>
          <StateBadge pull={pull} />
          <a href={pull.url} target="_blank" rel="noreferrer" title={t("Open on GitHub")} aria-label={t("Open on GitHub")} className="shrink-0 rounded p-0.5 text-fg-faint hover:text-fg">
            <LuExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
        <p className="mt-1 text-[10.5px] text-fg-faint">
          {pull.author?.login} {t("wants")} <span className="font-mono">{pull.headRefName}</span> {t("in")} <span className="font-mono">{pull.baseRefName}</span>
          {pull.additions !== undefined && (
            <>
              {" · "}
              <Counts added={pull.additions} removed={pull.deletions ?? 0} />
            </>
          )}
          {pull.reviewDecision && ` · ${pull.reviewDecision.toLowerCase().replace(/_/g, " ")}`}
          {pull.mergeable === "CONFLICTING" && <span className="text-danger"> {t("· has conflicts")}</span>}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {!here && open && (
            <TextButton disabled={!!busy} onClick={() => void act(`Checking out #${pull.number}`, () => gitApi.checkoutPull(id, pull.number))} title={t("Check its branch out here, to try it or work on it")}>
              {t("Check out")}
            </TextButton>
          )}
          {open && (
            <>
              <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)} aria-label={t("How to merge")} className="rounded border border-line bg-canvas px-1 py-0.5 text-[11px] text-fg">
                <option value="squash">{t("Squash")}</option>
                <option value="merge">{t("Merge commit")}</option>
                <option value="rebase">{t("Rebase")}</option>
              </select>
              <label className="flex cursor-pointer items-center gap-1 text-[11px] text-fg-subtle">
                <input type="checkbox" checked={deleteBranch} onChange={(e) => setDeleteBranch(e.target.checked)} className="h-3 w-3 accent-accent" />
                {t("delete branch")}
              </label>
              <TextButton primary disabled={!!busy || pull.isDraft} onClick={() => void merge()} title={pull.isDraft ? t("A draft is not merged — mark it ready on GitHub first") : undefined}>
                <LuGitMerge aria-hidden className="h-3.5 w-3.5" /> {t("Merge")}
              </TextButton>
            </>
          )}
        </div>
      </div>

      {checks.length > 0 && (
        <>
          <SectionHead title={t("Checks")} count={checks.length} />
          <ul className="py-0.5">
            {checks.map((c, i) => (
              <li key={i} className="flex items-center gap-1.5 px-3 py-0.5 text-xs">
                <CheckIcon check={c} />
                <span className="min-w-0 flex-1 truncate text-fg-muted">{c.name ?? c.context}</span>
                {(c.detailsUrl || c.targetUrl) && (
                  <a href={c.detailsUrl || c.targetUrl} target="_blank" rel="noreferrer" className="shrink-0 text-[10.5px] text-fg-faint hover:text-fg hover:underline">
                    {t("details")}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {pull.body?.trim() && (
        <div className="border-b border-line px-3 py-2">
          <Markdown>{pull.body}</Markdown>
        </div>
      )}

      <SectionHead title={t("Files")} count={files?.files.length ?? pull.changedFiles} />
      {!files ? (
        <Quiet>{t("Loading…")}</Quiet>
      ) : (
        <ul>
          {files.files.map((f) => {
            const { dir, name } = splitPath(f.path);
            const letter = f.status === "added" ? "A" : f.status === "deleted" ? "D" : f.status === "renamed" ? "R" : "M";
            return (
              <li key={f.path}>
                <button type="button" onClick={() => show({ kind: "parsed", title: f.path, file: f, truncated: files.truncated })} className="flex w-full items-center gap-1.5 px-2 py-1 text-left transition hover:bg-fg/5">
                  <Letter letter={letter} />
                  <span className="min-w-0 truncate text-xs text-fg">{name}</span>
                  <span className="min-w-0 flex-1 truncate text-[10.5px] text-fg-faint">{dir}</span>
                  <Counts added={f.added} removed={f.removed} binary={f.binary} />
                </button>
              </li>
            );
          })}
          {files.truncated && <Quiet>{t("Too large to show whole — the last files are missing.")}</Quiet>}
        </ul>
      )}

      {(pull.commits?.length ?? 0) > 0 && (
        <>
          <SectionHead title={t("Commits")} count={pull.commits!.length} />
          <ul>
            {pull.commits!.map((c) => (
              <li key={c.oid} className="flex items-baseline gap-1.5 px-3 py-0.5 text-xs">
                <span className="shrink-0 font-mono text-[10.5px] text-fg-faint">{c.oid.slice(0, 7)}</span>
                <span className="min-w-0 truncate text-fg-muted">{c.messageHeadline}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <SectionHead title={t("Conversation")} count={conversation.length} />
      {conversation.map((c, i) => (
        <div key={i} className="border-b border-line/50 px-3 py-2">
          <p className="mb-1 text-[10.5px] text-fg-faint">
            <span className="font-medium text-fg-subtle">{c.who}</span>
            {c.state === "APPROVED" && <span className="text-ok"> {t("approved")}</span>}
            {c.state === "CHANGES_REQUESTED" && <span className="text-danger"> {t("asked for changes")}</span>}
            {" · "}
            {when(c.at)}
          </p>
          {c.body && <Markdown>{c.body}</Markdown>}
        </div>
      ))}
      <div className="px-3 py-2">
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={3}
          placeholder={t("Write a comment (Markdown)")}
          aria-label={t("Comment on the pull request")}
          className="w-full resize-y rounded border border-line bg-canvas px-2 py-1 text-xs text-fg outline-none focus:border-accent/60"
        />
        <div className="mt-1 flex flex-wrap items-center justify-end gap-1.5">
          {open && (
            <>
              <TextButton disabled={!!busy || !reply.trim()} onClick={() => void review("request-changes")}>
                {t("Request changes")}
              </TextButton>
              <TextButton disabled={!!busy} onClick={() => void review("approve")}>
                {t("Approve")}
              </TextButton>
            </>
          )}
          <TextButton primary disabled={!!busy || !reply.trim()} onClick={() => void review("comment")}>
            {t("Comment")}
          </TextButton>
        </div>
      </div>
    </div>
  );
}
