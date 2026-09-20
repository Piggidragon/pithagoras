import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
const P = await import('../dist/projects.js');

const root = () => mkdtempSync(path.join(tmpdir(), 'projects-'));
const code = (fn) => { try { fn(); } catch (e) { return e instanceof P.ProjectError ? e.code : `other:${e.message}`; } return 'none'; };

test('the projects are the folders under the root, by name, without hidden ones or files', () => {
  const r = root();
  mkdirSync(path.join(r, 'zeta')); mkdirSync(path.join(r, 'alpha')); mkdirSync(path.join(r, '.hidden'));
  writeFileSync(path.join(r, 'a-file'), 'x');
  assert.deepEqual(P.listProjects(r).map((p) => p.name), ['alpha', 'zeta']);
  rmSync(r, { recursive: true });
});

test('a project is named like a folder and starts with its instructions', () => {
  const r = root();
  const p = P.createProject(r, 'Cool Project', '  Answer in German.  \n\n');
  assert.equal(p.name, 'cool-project');
  assert.equal(p.hasInstructions, true);
  assert.equal(readFileSync(path.join(r, 'cool-project', 'AGENTS.md'), 'utf8'), '  Answer in German.\n');
  assert.equal(P.readInstructions(r, 'cool-project'), '  Answer in German.\n');
  rmSync(r, { recursive: true });
});

test('a project without instructions has no file, and blank instructions remove it', () => {
  const r = root();
  const p = P.createProject(r, 'plain');
  assert.equal(p.hasInstructions, false);
  assert.equal(P.readInstructions(r, 'plain'), '');
  P.writeInstructions(r, 'plain', 'be brief');
  assert.equal(P.getProject(r, 'plain').hasInstructions, true);
  P.writeInstructions(r, 'plain', '   \n');
  assert.equal(P.getProject(r, 'plain').hasInstructions, false);
  rmSync(r, { recursive: true });
});

test('names that are taken, reserved or unusable are refused', () => {
  const r = root();
  P.createProject(r, 'one');
  assert.equal(code(() => P.createProject(r, 'One')), 'exists');
  // "home" is what chats start in, and would read as it.
  assert.equal(code(() => P.createProject(r, 'home')), 'invalid');
  assert.equal(code(() => P.createProject(r, 'Home')), 'invalid');
  assert.equal(code(() => P.createProject(r, '???')), 'invalid');
  assert.equal(code(() => P.createProject(r, '../escape')), 'none'); // becomes "escape": nothing to escape with
  assert.ok(!existsSync(path.join(path.dirname(r), 'escape')));
  rmSync(r, { recursive: true });
});

test('a name from outside cannot reach beyond the root', () => {
  const r = root();
  const outside = mkdtempSync(path.join(tmpdir(), 'outside-'));
  writeFileSync(path.join(outside, 'precious'), 'keep');
  symlinkSync(outside, path.join(r, 'link'));
  mkdirSync(path.join(r, 'real'));
  for (const bad of ['../x', 'a/b', '..', '.', '.hidden', 'a\\b', '']) {
    assert.equal(code(() => P.getProject(r, bad)), 'invalid', `getProject(${JSON.stringify(bad)})`);
    assert.equal(code(() => P.deleteProjectFolder(r, bad)), 'invalid', `deleteProjectFolder(${JSON.stringify(bad)})`);
  }
  // A symlink to somewhere else is not a project, so it is not deleted through.
  assert.equal(code(() => P.deleteProjectFolder(r, 'link')), 'invalid');
  assert.equal(code(() => P.writeInstructions(r, 'link', 'x')), 'invalid');
  assert.ok(existsSync(path.join(outside, 'precious')));
  assert.equal(code(() => P.getProject(r, 'nope')), 'missing');
  rmSync(r, { recursive: true }); rmSync(outside, { recursive: true });
});

test('deleting a project removes its folder', () => {
  const r = root();
  P.createProject(r, 'gone', 'x');
  writeFileSync(path.join(r, 'gone', 'work.txt'), 'abc');
  mkdirSync(path.join(r, 'gone', 'sub'));
  writeFileSync(path.join(r, 'gone', 'sub', 'deep.txt'), 'defg');
  const d = P.describeProject(r, 'gone');
  // AGENTS.md ("x\n"), work.txt and sub/deep.txt.
  assert.deepEqual(d, { files: 3, bytes: 2 + 3 + 4, complete: true });
  P.deleteProjectFolder(r, 'gone');
  assert.ok(!existsSync(path.join(r, 'gone')));
  rmSync(r, { recursive: true });
});

test('instructions have a size limit', () => {
  const r = root();
  P.createProject(r, 'big');
  assert.equal(code(() => P.writeInstructions(r, 'big', 'x'.repeat(100_001))), 'invalid');
  rmSync(r, { recursive: true });
});

test('a chat is named after its first line, briefly, and never after a command', () => {
  assert.equal(P.titleFrom('  Fix the login\nbug in auth.ts '), 'Fix the login');
  assert.equal(P.titleFrom('\n\n  second line only'), 'second line only');
  assert.equal(P.titleFrom('x'.repeat(80)), 'x'.repeat(47) + '…');
  assert.equal(P.titleFrom('/compact now'), undefined);
  assert.equal(P.titleFrom('   \n  '), undefined);
  assert.equal(P.NEW_CHAT_TITLE, 'New chat');
});
