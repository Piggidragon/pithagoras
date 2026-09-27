import { createContext, useContext } from "react";
import type { DiffOf, GitState } from "../../git-api";
import type { DiffFile } from "../../git-diff";

export type Repo = Extract<GitState, { repo: true }>;

/** What the panel shows over its tab, one on top of another: Back goes to the one below. */
export type View =
  | { kind: "diff"; title: string; what: DiffOf; path: string }
  /** A file out of a diff already loaded — a pull request's, which comes whole. */
  | { kind: "parsed"; title: string; file: DiffFile; truncated?: boolean }
  | { kind: "commit"; sha: string }
  | { kind: "compare"; base?: string }
  | { kind: "pull"; n: number };

export interface GitCtx {
  id: string;
  repo: Repo;
  reload: () => Promise<void>;
  /**
   * Do something to the repository: one thing at a time, named while it runs,
   * what it failed with shown, and the state read again after. True when it worked.
   */
  act: (label: string, step: () => Promise<unknown>) => Promise<boolean>;
  busy: string | null;
  show: (view: View) => void;
  /** Open a file (by its path in the repository) in the Files panel, where it is in the chat's folder. */
  openFile?: (path: string) => void;
}

export const Ctx = createContext<GitCtx | null>(null);

export function useGit(): GitCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useGit outside the Git panel");
  return ctx;
}
