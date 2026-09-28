import { useEffect, useState, type FormEvent } from "react";
import { LuCheck, LuChevronDown, LuChevronRight, LuGitBranchPlus, LuTrash2 } from "react-icons/lu";
import { gitApi, type Branch } from "../../git-api";
import { confirmDialog } from "../ConfirmDialog";
import { ago, ErrorNote, IconButton, Quiet, SectionHead, TextButton } from "./bits";
import { useGit } from "./context";
import { t } from "../../i18n";

/** The branches here and on the remotes: switched to, made, deleted. */
export function Branches() {
  const { id, repo, act, busy } = useGit();
  const [list, setList] = useState<Branch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [name, setName] = useState("");
  const [remotesOpen, setRemotesOpen] = useState(false);

  useEffect(() => {
    let gone = false;
    gitApi.branches(id).then(
      (r) => !gone && setList(r.branches),
      (e) => !gone && setError((e as Error).message),
    );
    return () => {
      gone = true;
    };
    // Again whenever something moved: a switch, a fetch, a push. A delete takes its row out itself.
  }, [id, repo.head, repo.branch, repo.upstream, repo.ahead, repo.behind]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const wanted = name.trim();
    if (!wanted) return;
    if (await act(`Making ${wanted}`, () => gitApi.createBranch(id, wanted))) setName("");
  };

  const remove = async (b: Branch) => {
    if (!(await confirmDialog({ title: `Delete the branch ${b.name}?`, message: "Only the branch here — not on the remote.", confirmLabel: "Delete", danger: true }))) return;
    const refused = await gitApi.deleteBranch(id, b.name).then(
      () => null,
      (e) => (e as Error).message,
    );
    if (refused === null) return setList((l) => l?.filter((x) => x.remote || x.name !== b.name) ?? l);
    // Not merged anywhere: its commits go with it, so that is asked separately.
    if (!/not fully merged/i.test(refused)) return setError(refused);
    const sure = await confirmDialog({
      title: `${b.name} is not merged`,
      message: "Its commits are on no other branch. Deleting it loses them unless you have their hashes.",
      confirmLabel: "Delete anyway",
      danger: true,
    });
    if (sure) await act(`Deleting ${b.name}`, () => gitApi.deleteBranch(id, b.name, true));
  };

  if (error) return <ErrorNote onClose={() => setError(null)}>{error}</ErrorNote>;
  if (!list) return <Quiet>{t("Loading…")}</Quiet>;
  const match = (b: Branch) => !filter || b.name.toLowerCase().includes(filter.toLowerCase());
  const local = list.filter((b) => !b.remote && match(b));
  const remote = list.filter((b) => b.remote && match(b));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <form onSubmit={create} className="flex shrink-0 items-center gap-1.5 border-b border-line px-2 py-1.5">
        <LuGitBranchPlus aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-faint" />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={`New branch from ${repo.branch ?? "here"}`}
          aria-label={t("Name of the new branch")}
          spellCheck={false}
          className="min-w-0 flex-1 rounded border border-line bg-canvas px-1.5 py-0.5 font-mono text-xs text-fg outline-none focus:border-accent/60"
        />
        <TextButton type="submit" primary disabled={!name.trim() || !!busy}>
          {t("Create")}
        </TextButton>
      </form>
      {list.length > 8 && (
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("Filter")}
          aria-label={t("Filter the branches")}
          className="mx-2 my-1.5 shrink-0 rounded border border-line bg-canvas px-1.5 py-0.5 text-xs text-fg outline-none focus:border-accent/60"
        />
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <SectionHead title={t("Here")} count={local.length} />
        {local.map((b) => (
          <BranchRow key={b.name} branch={b} onSwitch={() => void act(`Switching to ${b.name}`, () => gitApi.switch(id, b.name))} onDelete={() => void remove(b)} />
        ))}
        {remote.length > 0 && (
          <>
            <button
              type="button"
              aria-expanded={remotesOpen || !!filter}
              onClick={() => setRemotesOpen((v) => !v)}
              className="sticky top-0 flex w-full items-center gap-1 border-b border-line/60 bg-surface/95 px-3 py-1 text-left text-[11px] font-medium uppercase tracking-wide text-fg-subtle"
            >
              {remotesOpen || filter ? <LuChevronDown aria-hidden className="h-3 w-3" /> : <LuChevronRight aria-hidden className="h-3 w-3" />}
              {t("On the remote")}
              <span className="rounded-full bg-fg/8 px-1.5 text-[10px] normal-case">{remote.length}</span>
            </button>
            {(remotesOpen || filter) &&
              remote.map((b) => (
                <BranchRow
                  key={b.name}
                  branch={b}
                  onSwitch={() => void act(`Checking out ${b.name}`, () => gitApi.switch(id, b.name, true))}
                />
              ))}
          </>
        )}
      </div>
    </div>
  );
}

function BranchRow({ branch: b, onSwitch, onDelete }: { branch: Branch; onSwitch: () => void; onDelete?: () => void }) {
  const { busy } = useGit();
  return (
    <div className="group flex items-center gap-1 px-2 transition hover:bg-fg/5 focus-within:bg-fg/5">
      <button
        type="button"
        onClick={onSwitch}
        disabled={b.current || !!busy}
        title={b.current ? t("Checked out") : b.remote ? `Check out ${b.name}, as a local branch following it` : `Switch to ${b.name}`}
        className="flex min-w-0 flex-1 flex-col gap-0.5 py-1 text-left disabled:cursor-default"
      >
        <span className="flex min-w-0 items-center gap-1">
          {b.current ? <LuCheck aria-label={t("Checked out")} className="h-3 w-3 shrink-0 text-accent" /> : <span className="w-3 shrink-0" />}
          <span className={`min-w-0 truncate font-mono text-xs ${b.current ? "font-semibold text-fg" : "text-fg"}`}>{b.name}</span>
          {(b.ahead > 0 || b.behind > 0) && (
            <span className="shrink-0 font-mono text-[10px]">
              {b.ahead > 0 && <span className="text-accent">↑{b.ahead}</span>}
              {b.behind > 0 && <span className="text-warn">↓{b.behind}</span>}
            </span>
          )}
          {b.gone && (
            <span className="shrink-0 rounded px-1 text-[10px] text-warn ring-1 ring-inset ring-warn/30" title={t("Its branch on the remote was deleted")}>
              {t("gone")}
            </span>
          )}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 pl-4 text-[10.5px] text-fg-faint">
          <span className="min-w-0 flex-1 truncate">{b.subject}</span>
          <span className="shrink-0">{ago(b.date)}</span>
        </span>
      </button>
      {onDelete && !b.current && (
        <div className="shrink-0 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100">
          <IconButton label={`Delete ${b.name}`} danger disabled={!!busy} onClick={onDelete}>
            <LuTrash2 aria-hidden className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      )}
    </div>
  );
}
