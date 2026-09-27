import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// A home of its own: who commits, what a new repository's branch is called,
// and no config of the person running the tests.
const home = mkdtempSync(path.join(tmpdir(), "pithagoras-git-"));
process.env.HOME = home;
process.env.GIT_CONFIG_GLOBAL = path.join(home, ".gitconfig");
process.env.GIT_CONFIG_NOSYSTEM = "1";
writeFileSync(process.env.GIT_CONFIG_GLOBAL, "[user]\n\tname = Tester\n\temail = t@example.com\n[init]\n\tdefaultBranch = main\n");
// A gh of our own, first on the PATH: it writes down what it was asked and answers as GitHub would.
const bin = path.join(home, "bin");
mkdirSync(bin);
const ghLog = path.join(home, "gh.log");
writeFileSync(
  path.join(bin, "gh"),
  `#!/bin/sh
input=$(cat)
printf '%s\\n' "$*" >> "${ghLog}"
printf 'STDIN:%s\\n' "$input" >> "${ghLog}"
case "$1 $2" in
  "repo view") echo '{"nameWithOwner":"me/demo","url":"https://github.com/me/demo","defaultBranchRef":{"name":"main"}}' ;;
  "pr create") echo "https://github.com/me/demo/pull/7" ;;
  "pr list") echo '[{"number":7,"title":"Add a thing","state":"OPEN"}]' ;;
  "pr view") if [ -z "$3" ] || [ "$3" = "--json" ]; then echo "no pull requests found for branch \\"main\\"" >&2; exit 1; fi; echo '{"number":'"$3"',"title":"Add a thing"}' ;;
  *) echo "unknown: $*" >&2; exit 1 ;;
esac
`,
);
chmodSync(path.join(bin, "gh"), 0o755);
process.env.PATH = `${bin}:${process.env.PATH}`;

const g = await import("../dist/git.js");

const sh = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" });
let n = 0;
/** A repository with one commit: a.txt and "b c.txt". */
function repo() {
  const dir = path.join(home, `repo${++n}`);
  mkdirSync(dir);
  sh(dir, "init", "-q");
  writeFileSync(path.join(dir, "a.txt"), "one\ntwo\nthree\n");
  writeFileSync(path.join(dir, "b c.txt"), "spaced\n");
  sh(dir, "add", "-A");
  sh(dir, "commit", "-qm", "first");
  return dir;
}
const open = async (dir) => (await g.findRepo(dir));

test("what changed: staged and not, new files, renames and names with spaces, with their line counts", async () => {
  const dir = repo();
  writeFileSync(path.join(dir, "a.txt"), "one\n2\nthree\nfour\n");
  sh(dir, "mv", "b c.txt", "d e.txt");
  writeFileSync(path.join(dir, "new file.md"), "hello\n");
  writeFileSync(path.join(dir, "staged.txt"), "x\n");
  sh(dir, "add", "staged.txt");

  const s = await g.status(await open(dir));
  assert.equal(s.branch, "main");
  assert.equal(s.operation, null);
  const by = Object.fromEntries(s.files.map((f) => [f.path, f]));
  assert.deepEqual({ x: by["a.txt"].x, y: by["a.txt"].y, unstaged: by["a.txt"].unstaged }, { x: ".", y: "M", unstaged: { added: 2, removed: 1, binary: false } });
  assert.equal(by["d e.txt"].kind, "renamed");
  assert.equal(by["d e.txt"].from, "b c.txt");
  assert.equal(by["new file.md"].kind, "untracked");
  assert.deepEqual(by["staged.txt"].staged, { added: 1, removed: 0, binary: false });
});

test("diffs of one file: in the tree, in the index, and a new one — and nothing outside what changed", async () => {
  const dir = repo();
  const r = await open(dir);
  writeFileSync(path.join(dir, "a.txt"), "one\nTWO\nthree\n");
  writeFileSync(path.join(dir, "fresh.txt"), "brand new\n");
  assert.match((await g.diff(r, { of: "unstaged", path: "a.txt" })).diff, /^-two\n\+TWO$/m);
  sh(dir, "add", "a.txt");
  assert.equal((await g.diff(r, { of: "unstaged", path: "a.txt" })).diff, "");
  assert.match((await g.diff(r, { of: "staged", path: "a.txt" })).diff, /^\+TWO$/m);
  assert.match((await g.diff(r, { of: "untracked", path: "fresh.txt" })).diff, /^\+brand new$/m);

  // --no-index would show any file at all: only what git lists as new is shown.
  await assert.rejects(g.diff(r, { of: "untracked", path: "a.txt" }), { status: 404 });
  await assert.rejects(g.diff(r, { of: "untracked", path: "../../etc/passwd" }), { status: 400 });
  await assert.rejects(g.diff(r, { of: "unstaged", path: "/etc/passwd" }), { status: 400 });
  // A path is a path, not a pattern: "*.txt" is no file here.
  assert.equal((await g.diff(r, { of: "staged", path: "*.txt" })).diff, "");
});

test("looking does not run what the repository's config would: no fsmonitor, external diff or text conversion", async () => {
  const dir = repo();
  const marker = path.join(home, `ran${n}`);
  const script = path.join(home, `evil${n}.sh`);
  writeFileSync(script, `#!/bin/sh\ntouch ${marker}\n`);
  chmodSync(script, 0o755);
  sh(dir, "config", "core.fsmonitor", script);
  sh(dir, "config", "diff.external", script);
  sh(dir, "config", "diff.conv.textconv", script);
  writeFileSync(path.join(dir, ".gitattributes"), "*.txt diff=conv\n");
  writeFileSync(path.join(dir, "a.txt"), "changed\n");
  const r = await open(dir);
  await g.status(r);
  await g.diff(r, { of: "unstaged", path: "a.txt" });
  assert.equal(existsSync(marker), false);
});

test("stage, unstage, discard and commit — before the first commit as well", async () => {
  const dir = path.join(home, `empty${++n}`);
  mkdirSync(dir);
  sh(dir, "init", "-q");
  const r = await open(dir);
  writeFileSync(path.join(dir, "x.txt"), "x\n");
  writeFileSync(path.join(dir, "y.txt"), "y\n");
  await g.stage(r, ["x.txt"]);
  assert.equal((await g.status(r)).files.find((f) => f.path === "x.txt").x, "A");
  // No HEAD to reset to yet.
  await g.unstage(r, ["x.txt"]);
  assert.equal((await g.status(r)).files.find((f) => f.path === "x.txt").kind, "untracked");
  await g.stage(r, [], true);
  const { sha } = await g.commit(r, "Start");
  assert.match(sha, /^[0-9a-f]{40}$/);
  assert.equal((await g.status(r)).files.length, 0);
  await assert.rejects(g.commit(r, "   "), { status: 400 });

  // Discard: a changed file goes back, a new one goes away.
  writeFileSync(path.join(dir, "x.txt"), "changed\n");
  writeFileSync(path.join(dir, "junk.txt"), "junk\n");
  await g.discard(r, ["x.txt", "junk.txt"]);
  assert.equal(readFileSync(path.join(dir, "x.txt"), "utf8"), "x\n");
  assert.equal(existsSync(path.join(dir, "junk.txt")), false);

  // Amend keeps the message when none is given.
  writeFileSync(path.join(dir, "z.txt"), "z\n");
  await g.stage(r, ["z.txt"]);
  await g.commit(r, "", true);
  const [last] = await g.log(r, {});
  assert.equal(last.subject, "Start");
  assert.equal((await g.commitDetail(r, last.sha)).files.length, 3);
});

test("history and one commit's files, the first one against nothing", async () => {
  const dir = repo();
  const r = await open(dir);
  writeFileSync(path.join(dir, "a.txt"), "one\n");
  sh(dir, "commit", "-qam", "Shorten a\n\nWith a body.");
  const commits = await g.log(r, {});
  assert.deepEqual(commits.map((c) => c.subject), ["Shorten a", "first"]);
  assert.ok(commits[0].refs.some((ref) => ref.includes("main")));
  const detail = await g.commitDetail(r, commits[0].sha);
  assert.equal(detail.message, "Shorten a\n\nWith a body.");
  assert.deepEqual(detail.files.map((f) => [f.path, f.status, f.added, f.removed]), [["a.txt", "M", 0, 2]]);
  const first = await g.commitDetail(r, commits[1].sha);
  assert.deepEqual(first.files.map((f) => f.status), ["A", "A"]);
  assert.match((await g.diff(r, { of: "commit", sha: commits[0].sha, path: "a.txt" })).diff, /^-two$/m);
  await assert.rejects(g.commitDetail(r, "--output=/tmp/x"), { status: 400 });
  assert.deepEqual((await g.log(r, { skip: 1, limit: 1 })).map((c) => c.subject), ["first"]);
});

test("branches: made, switched, pushed with an upstream, fetched and pulled, compared with the base, deleted", async () => {
  const remote = path.join(home, `remote${++n}.git`);
  execFileSync("git", ["init", "-q", "--bare", remote]);
  const dir = repo();
  sh(dir, "remote", "add", "origin", remote);
  sh(dir, "push", "-q", "-u", "origin", "main");
  const r = await open(dir);

  await g.createBranch(r, "feature/x");
  assert.equal((await g.status(r)).branch, "feature/x");
  await assert.rejects(g.createBranch(r, "bad..name"), { status: 400 });
  await assert.rejects(g.createBranch(r, "-f"), { status: 400 });
  writeFileSync(path.join(dir, "feature.txt"), "f\n");
  await g.stage(r, [], true);
  await g.commit(r, "Add feature");

  // Not on the remote yet: published, and followed from then on.
  await g.push(r);
  let s = await g.status(r);
  assert.equal(s.upstream, "origin/feature/x");
  assert.equal(s.ahead, 0);

  const comparison = await g.compare(r);
  assert.equal(comparison.base, "origin/main");
  assert.deepEqual(comparison.commits.map((c) => c.subject), ["Add feature"]);
  assert.deepEqual(comparison.files.map((f) => [f.path, f.status]), [["feature.txt", "A"]]);
  assert.match((await g.diff(r, { of: "range", base: "origin/main", path: "feature.txt" })).diff, /^\+f$/m);

  // Somebody else pushes to main; fetch sees it, pull fast-forwards.
  const other = path.join(home, `other${n}`);
  execFileSync("git", ["clone", "-q", remote, other]);
  writeFileSync(path.join(other, "a.txt"), "theirs\n");
  sh(other, "commit", "-qam", "Theirs");
  sh(other, "push", "-q", "origin", "main");
  await g.switchBranch(r, "main");
  await g.fetch(r);
  s = await g.status(r);
  assert.equal(s.behind, 1);
  await g.pull(r);
  assert.equal(readFileSync(path.join(dir, "a.txt"), "utf8"), "theirs\n");

  // A remote branch checked out gets a local one following it.
  sh(other, "switch", "-qc", "theirs/topic");
  sh(other, "push", "-q", "origin", "theirs/topic");
  await g.fetch(r);
  const list = await g.branches(r);
  assert.ok(list.some((b) => b.remote && b.name === "origin/theirs/topic"));
  assert.ok(!list.some((b) => b.name === "origin/HEAD" || b.name === "origin"));
  await g.switchBranch(r, "origin/theirs/topic", true);
  s = await g.status(r);
  assert.equal(s.branch, "theirs/topic");
  assert.equal(s.upstream, "origin/theirs/topic");

  await g.switchBranch(r, "main");
  await g.deleteBranch(r, "theirs/topic");
  assert.ok(!(await g.branches(r)).some((b) => !b.remote && b.name === "theirs/topic"));
});

test("a merge that stopped on a conflict is shown as one, and can be given up", async () => {
  const dir = repo();
  const r = await open(dir);
  sh(dir, "switch", "-qc", "side");
  writeFileSync(path.join(dir, "a.txt"), "side\n");
  sh(dir, "commit", "-qam", "side");
  sh(dir, "switch", "-q", "main");
  writeFileSync(path.join(dir, "a.txt"), "main\n");
  sh(dir, "commit", "-qam", "main");
  try {
    sh(dir, "merge", "-q", "side");
  } catch {
    // The conflict.
  }
  const s = await g.status(r);
  assert.equal(s.operation, "merge");
  assert.equal(s.files.find((f) => f.path === "a.txt").kind, "conflict");
  await g.abortOperation(r);
  assert.equal((await g.status(r)).operation, null);
});

test("stashes: put away with new files, listed, shown and brought back", async () => {
  const dir = repo();
  const r = await open(dir);
  writeFileSync(path.join(dir, "a.txt"), "wip\n");
  writeFileSync(path.join(dir, "new.txt"), "new\n");
  await g.stashPush(r, "half done");
  assert.equal((await g.status(r)).files.length, 0);
  const [stash] = await g.stashes(r);
  assert.equal(stash.ref, "stash@{0}");
  assert.match(stash.message, /half done/);
  assert.match((await g.diff(r, { of: "stash", stash: "stash@{0}" })).diff, /^\+wip$/m);
  await assert.rejects(g.stashDo(r, "pop", "stash@{0}; rm -rf /"), { status: 400 });
  await g.stashDo(r, "pop", "stash@{0}");
  assert.equal(readFileSync(path.join(dir, "new.txt"), "utf8"), "new\n");
});

test("a remote is shown without the login its URL may carry", () => {
  assert.deepEqual(g.describeRemote("https://me:ghp_secret@github.com/me/demo.git"), { address: "github.com/me/demo", web: "https://github.com/me/demo" });
  assert.deepEqual(g.describeRemote("git@github.com:me/demo.git"), { address: "github.com:me/demo", web: "https://github.com/me/demo" });
  assert.deepEqual(g.describeRemote("ssh://git@gitlab.example.com:2222/a/b.git"), { address: "gitlab.example.com:2222/a/b", web: "https://gitlab.example.com/a/b" });
  assert.equal(g.describeRemote("/srv/git/demo.git").web, undefined);
});

test("pull requests go through gh: a branch not on GitHub is pushed first, the body goes in on stdin", async () => {
  const remote = path.join(home, `remote${++n}.git`);
  execFileSync("git", ["init", "-q", "--bare", remote]);
  const dir = repo();
  sh(dir, "remote", "add", "origin", remote);
  sh(dir, "push", "-q", "-u", "origin", "main");
  const r = await open(dir);
  const state = await g.ghState(r, true);
  assert.deepEqual({ installed: state.installed, repo: state.repo, defaultBranch: state.defaultBranch }, { installed: true, repo: "me/demo", defaultBranch: "main" });
  assert.equal(await g.pullRequest(r), null, "no pull request for this branch is an answer, not an error");

  await g.createBranch(r, "topic");
  writeFileSync(path.join(dir, "t.txt"), "t\n");
  await g.stage(r, [], true);
  await g.commit(r, "Topic");
  writeFileSync(ghLog, "");
  const { url } = await g.createPull(r, { title: "Add topic", body: "Why:\n- because; $(rm -rf /)", base: "main", draft: true });
  assert.equal(url, "https://github.com/me/demo/pull/7");
  assert.equal((await g.status(r)).upstream, "origin/topic", "pushed before gh was asked");
  const asked = readFileSync(ghLog, "utf8");
  assert.match(asked, /^pr create --title Add topic --body-file - --head topic --base main --draft$/m);
  assert.match(asked, /STDIN:Why:\n- because; \$\(rm -rf \/\)/);
  assert.deepEqual(await g.pulls(r), [{ number: 7, title: "Add a thing", state: "OPEN" }]);
  await assert.rejects(g.pullRequest(r, "7; ls"), { status: 400 });
});

test("without gh, pull requests say how to get them", async () => {
  const dir = repo();
  const r = await open(dir);
  const saved = process.env.PATH;
  // A PATH with git on it and nothing else.
  const only = path.join(home, `nogh${n}`);
  mkdirSync(only);
  symlinkSync(execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim(), path.join(only, "git"));
  process.env.PATH = only;
  try {
    const state = await g.ghState(r, true);
    assert.equal(state.installed, false);
    assert.match(state.note, /Install the GitHub CLI/);
    await assert.rejects(g.pulls(r), { status: 409 });
  } finally {
    process.env.PATH = saved;
  }
});

test("a folder in no repository is said to be in none, and can be made one", async () => {
  const dir = path.join(home, `plain${++n}`);
  mkdirSync(dir);
  assert.equal(await g.findRepo(dir), null);
  await g.initRepo(dir);
  const r = await g.findRepo(dir);
  assert.equal(r.root, dir);
  assert.equal(r.prefix, "");
  mkdirSync(path.join(dir, "sub"));
  assert.equal((await g.findRepo(path.join(dir, "sub"))).prefix, "sub");
});
