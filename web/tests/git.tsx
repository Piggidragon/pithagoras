// Development-only fixture: the Git panel on a repository kept in the page, without a server.
// Open /tests/git.html to see it; ?gh=off for a machine without gh, ?repo=none for a folder in no repository.
// What the panel asked for is in window.gitCalls; window.agentWrote() changes a file the way the agent would.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles';
import { GIT_TABS, GitPanel, type GitTab } from '../src/components/git/GitPanel';
import { ConfirmHost } from '../src/components/ConfirmDialog';

const params = new URLSearchParams(location.search);
const now = Math.floor(Date.now() / 1000);
const calls: { method: string; url: string; body?: any }[] = [];
(window as any).gitCalls = calls;

type File = { path: string; from?: string; x: string; y: string; kind: string; staged?: any; unstaged?: any };
const repo = {
  branch: 'feature/login',
  head: 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0',
  upstream: 'origin/feature/login' as string | null,
  ahead: 2,
  behind: 0,
  stashes: 1,
  operation: null as string | null,
  files: [
    { path: 'src/auth/login.ts', x: 'M', y: '.', kind: 'changed', staged: { added: 12, removed: 3, binary: false } },
    { path: 'src/auth/session.ts', x: '.', y: 'M', kind: 'changed', unstaged: { added: 4, removed: 4, binary: false } },
    { path: 'README.md', x: '.', y: 'M', kind: 'changed', unstaged: { added: 1, removed: 0, binary: false } },
    { path: 'docs/login flow.md', x: '?', y: '?', kind: 'untracked' },
  ] as File[],
};
const commits = [
  { sha: 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0', short: 'a1b2c3d', parents: ['b'], author: 'Ada', email: 'ada@example.com', date: now - 600, refs: ['HEAD -> feature/login', 'origin/feature/login'], subject: 'Check the password before the session is made' },
  { sha: 'b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0a1', short: 'b2c3d4e', parents: ['c'], author: 'Ada', email: 'ada@example.com', date: now - 7200, refs: [], subject: 'Add the login form' },
  { sha: 'c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0a1b2', short: 'c3d4e5f', parents: [], author: 'Grace', email: 'grace@example.com', date: now - 86400 * 3, refs: ['origin/main', 'main'], subject: 'Start' },
];
const diffOf = (path: string) =>
  `diff --git a/${path} b/${path}\nindex 1..2 100644\n--- a/${path}\n+++ b/${path}\n@@ -10,6 +10,8 @@ export function login(user: User) {\n   const hash = await digest(user.password);\n-  if (hash === stored) return true;\n+  if (!stored) throw new Error("no password set");\n+  if (timingSafeEqual(hash, stored)) {\n+    return makeSession(user);\n+  }\n   return false;\n }\n`;
const branches = [
  { name: 'feature/login', remote: false, sha: 'a1b2c3d', upstream: 'origin/feature/login', ahead: 2, behind: 0, gone: false, current: true, date: now - 600, subject: 'Check the password before the session is made' },
  { name: 'main', remote: false, sha: 'c3d4e5f', upstream: 'origin/main', ahead: 0, behind: 3, gone: false, current: false, date: now - 86400 * 3, subject: 'Start' },
  { name: 'old/experiment', remote: false, sha: 'd4e5f6a', upstream: 'origin/old/experiment', ahead: 0, behind: 0, gone: true, current: false, date: now - 86400 * 40, subject: 'Try another store' },
  { name: 'origin/main', remote: true, sha: 'e5f6a7b', upstream: null, ahead: 0, behind: 0, gone: false, current: false, date: now - 3600, subject: 'Release 1.2' },
  { name: 'origin/feature/signup', remote: true, sha: 'f6a7b8c', upstream: null, ahead: 0, behind: 0, gone: false, current: false, date: now - 5000, subject: 'Signup page' },
];
const gh = params.get('gh') === 'off'
  ? { installed: false, authed: false, repo: null, url: null, defaultBranch: null, note: 'Install the GitHub CLI (gh) to see and open pull requests here' }
  : { installed: true, authed: true, repo: 'me/app', url: 'https://github.com/me/app', defaultBranch: 'main' };
const pulls = [
  { number: 41, title: 'Login with a password', author: { login: 'ada' }, headRefName: 'feature/login', baseRefName: 'main', isDraft: false, state: 'OPEN', updatedAt: new Date(Date.now() - 3600_000).toISOString(), url: 'https://github.com/me/app/pull/41', reviewDecision: 'REVIEW_REQUIRED', additions: 40, deletions: 6 },
  { number: 38, title: 'Dark mode for the settings', author: { login: 'grace' }, headRefName: 'feature/dark', baseRefName: 'main', isDraft: true, state: 'OPEN', updatedAt: new Date(Date.now() - 86400_000).toISOString(), url: 'https://github.com/me/app/pull/38' },
];

const realFetch = window.fetch;
window.fetch = (async (input: any, init?: any) => {
  const url = String(input);
  if (!url.startsWith('/api/sessions/s/git')) return realFetch(input, init);
  const method = init?.method ?? 'GET';
  const body = init?.body ? JSON.parse(init.body) : undefined;
  calls.push({ method, url, body });
  const reply = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  const path = url.replace('/api/sessions/s/git', '').split('?')[0];
  const q = new URLSearchParams(url.split('?')[1] ?? '');
  if (params.get('repo') === 'none' && path === '') return reply({ repo: false, folder: '/work/notes' });
  if (path === '') return reply({ repo: true, root: '/work/app', prefix: '', ...repo, truncated: false, remotes: [{ name: 'origin', address: 'github.com:me/app', web: 'https://github.com/me/app' }], gh });
  if (path === '/diff') return reply({ diff: diffOf(q.get('path') ?? 'x'), truncated: false });
  if (path === '/stage') {
    for (const f of repo.files) if (body.all || body.paths.includes(f.path)) Object.assign(f, { x: f.kind === 'untracked' ? 'A' : 'M', y: '.', kind: 'changed', staged: f.unstaged ?? { added: 1, removed: 0, binary: false }, unstaged: undefined });
    return reply({ ok: true });
  }
  if (path === '/unstage') {
    for (const f of repo.files) if (body.all || body.paths.includes(f.path)) Object.assign(f, { x: '.', y: 'M', unstaged: f.staged, staged: undefined });
    return reply({ ok: true });
  }
  if (path === '/discard') {
    repo.files = repo.files.filter((f) => !body.paths.includes(f.path) || f.x !== '.');
    return reply({ ok: true });
  }
  if (path === '/commit') {
    repo.files = repo.files.filter((f) => f.x === '.' || f.kind === 'untracked');
    repo.ahead++;
    return reply({ sha: 'f'.repeat(40) });
  }
  if (path === '/push') {
    if (params.get('push') === 'fail') return reply({ error: 'failed to push some refs to github.com:me/app\nUpdates were rejected because the remote contains work that you do not have locally.' }, 409);
    repo.ahead = 0;
    return reply({ said: 'To github.com:me/app\n   a1b2c3d..f000000  feature/login -> feature/login' });
  }
  if (path === '/log') return reply({ commits });
  if (path.startsWith('/commits/')) {
    const c = commits.find((x) => x.sha === path.slice(9))!;
    return reply({ ...c, committer: c.author, message: `${c.subject}\n\nWith a body that explains why.`, files: [{ path: 'src/auth/login.ts', status: 'M', added: 12, removed: 3, binary: false }, { path: 'src/auth/new.ts', status: 'A', added: 30, removed: 0, binary: false }] });
  }
  if (path === '/branches' && method === 'GET') return reply({ branches });
  if (path === '/branches' && method === 'POST') {
    repo.branch = body.name;
    return reply({ ok: true });
  }
  if (path === '/switch') {
    repo.branch = body.remote ? body.name.split('/').slice(1).join('/') : body.name;
    return reply({ ok: true });
  }
  if (path === '/stashes') return reply({ stashes: [{ ref: 'stash@{0}', date: now - 4000, message: 'On feature/login: half a refactor' }] });
  if (path === '/compare') return reply({ comparison: { base: 'origin/main', head: repo.branch, mergeBase: 'c3d4e5f', commits: commits.slice(0, 2), files: [{ path: 'src/auth/login.ts', status: 'M', added: 12, removed: 3, binary: false }] } });
  if (path === '/pulls' && method === 'GET') return reply({ pulls });
  if (path === '/pulls/current') return reply({ pull: repo.branch === 'feature/login' ? { ...pulls[0], body: '' } : null });
  if (path === '/pulls' && method === 'POST') return reply({ url: 'https://github.com/me/app/pull/42' });
  if (/^\/pulls\/\d+$/.test(path)) {
    const p = pulls.find((x) => String(x.number) === path.slice(7)) ?? { ...pulls[0], number: 42, title: 'New', headRefName: repo.branch };
    return reply({ pull: { ...p, body: 'Adds **login** with a password.\n\n- checks the hash in constant time', mergeable: 'MERGEABLE', statusCheckRollup: [{ name: 'test', conclusion: 'SUCCESS', status: 'COMPLETED' }, { name: 'lint', status: 'IN_PROGRESS' }], commits: [{ oid: commits[0].sha, messageHeadline: commits[0].subject }], comments: [{ author: { login: 'grace' }, body: 'Looks good — one question about the hash.', createdAt: new Date(Date.now() - 1800_000).toISOString() }], reviews: [] } });
  }
  if (/^\/pulls\/\d+\/diff$/.test(path)) return reply({ diff: diffOf('src/auth/login.ts') + diffOf('src/auth/session.ts'), truncated: false });
  if (/^\/pulls\/\d+\/(merge|comment|review|checkout)$/.test(path)) return reply({ ok: true, said: '' });
  return reply({ ok: true });
}) as typeof fetch;

function Fixture() {
  const [tab, setTab] = useState<GitTab>((params.get('tab') as GitTab) ?? 'changes');
  const [activity, setActivity] = useState(0);
  const [opened, setOpened] = useState<string[]>([]);
  (window as any).agentWrote = (path: string) => {
    repo.files.push({ path, x: '?', y: '?', kind: 'untracked' });
    setActivity((n) => n + 1);
  };
  return (
    <div className="bg-canvas text-fg" style={{ height: '100vh', display: 'flex', flexDirection: 'column', maxWidth: 520 }}>
      <div className="chat-tabs" role="tablist" aria-label="Git" style={{ padding: 6 }}>
        {GIT_TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 bg-surface">
        <GitPanel sessionId="s" tab={tab} onTab={setTab} activity={activity} onOpenFile={(p) => setOpened((o) => [...o, p])} />
      </div>
      <output data-testid="opened">{opened.join(',')}</output>
      <ConfirmHost />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
