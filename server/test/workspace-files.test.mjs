import assert from 'node:assert/strict';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
const files = await import('../dist/workspace-files.js');
const { FileError, baseDir, listDir, readText, writeText, removeEntry, resolveInside, downloadPath, MAX_EDIT_BYTES } = files;

/** A folder to work in, and one beside it that nothing may reach. */
function setup() {
  const top = mkdtempSync(path.join(tmpdir(), 'wsfiles-'));
  const dir = path.join(top, 'work');
  const outside = path.join(top, 'outside');
  mkdirSync(dir); mkdirSync(outside);
  writeFileSync(path.join(outside, 'secret'), 'top secret');
  return { top, dir, outside, base: baseDir(dir), done: () => rmSync(top, { recursive: true, force: true }) };
}
const code = (fn) => { try { fn(); } catch (e) { return e instanceof FileError ? e.code : `other:${e.message}`; } return 'none'; };

test('a folder is listed with folders first, and .git is left out', () => {
  const { dir, base, done } = setup();
  mkdirSync(path.join(dir, 'src')); mkdirSync(path.join(dir, '.git'));
  writeFileSync(path.join(dir, 'b.txt'), 'bb'); writeFileSync(path.join(dir, 'a.txt'), 'a');
  const list = listDir(base, '');
  assert.deepEqual(list.entries.map((e) => [e.name, e.type]), [['src', 'dir'], ['a.txt', 'file'], ['b.txt', 'file']]);
  assert.equal(list.entries[2].size, 2);
  assert.equal(list.truncated, false);
  done();
});

test('a nested folder is listed by its path, and an empty one is empty', () => {
  const { dir, base, done } = setup();
  mkdirSync(path.join(dir, 'a', 'b'), { recursive: true });
  writeFileSync(path.join(dir, 'a', 'b', 'x.md'), '# x');
  assert.equal(listDir(base, 'a/b').path, path.join('a', 'b'));
  assert.equal(listDir(base, 'a/b').entries.length, 1);
  mkdirSync(path.join(dir, 'empty'));
  assert.deepEqual(listDir(base, 'empty').entries, []);
  done();
});

test('nothing outside the folder can be reached by a path', () => {
  const { base, outside, done } = setup();
  for (const p of ['..', '../outside', '../outside/secret', '/etc/passwd', 'a/../../outside', path.join(outside, 'secret'), 'x\0y']) {
    assert.match(code(() => readText(base, p)), /invalid|missing/, JSON.stringify(p));
    assert.match(code(() => listDir(base, p)), /invalid|missing/, JSON.stringify(p));
    assert.match(code(() => writeText(base, p, 'x')), /invalid|missing/, JSON.stringify(p));
    assert.match(code(() => removeEntry(base, p)), /invalid|missing/, JSON.stringify(p));
  }
  assert.equal(readFileSync(path.join(outside, 'secret'), 'utf8'), 'top secret');
  done();
});

test('an absolute-looking path is taken as inside the folder, not as the root of the disk', () => {
  const { dir, base, done } = setup();
  writeFileSync(path.join(dir, 'a.txt'), 'inside');
  assert.equal(readText(base, '/a.txt').content, 'inside');
  done();
});

test('a link that leads out is refused for every operation, and what it points at is untouched', () => {
  const { dir, base, outside, done } = setup();
  symlinkSync(outside, path.join(dir, 'escape'));
  symlinkSync(path.join(outside, 'secret'), path.join(dir, 'peek'));
  for (const p of ['escape', 'escape/secret', 'peek']) {
    assert.equal(code(() => readText(base, p)), 'invalid', p);
    assert.equal(code(() => writeText(base, p, 'x')), 'invalid', p);
  }
  assert.equal(code(() => writeText(base, 'escape/new.txt', 'x')), 'invalid');
  assert.equal(existsSync(path.join(outside, 'new.txt')), false);
  assert.equal(readFileSync(path.join(outside, 'secret'), 'utf8'), 'top secret');
  done();
});

test('a link to nowhere is refused rather than written through', () => {
  const { dir, base, outside, done } = setup();
  symlinkSync(path.join(outside, 'not-yet'), path.join(dir, 'dangling'));
  assert.equal(code(() => writeText(base, 'dangling', 'planted')), 'invalid');
  assert.equal(existsSync(path.join(outside, 'not-yet')), false);
  done();
});

test('links are listed as what they lead to when that is inside, and as links when it is not', () => {
  const { dir, base, outside, done } = setup();
  writeFileSync(path.join(dir, 'real.txt'), 'real'); mkdirSync(path.join(dir, 'sub'));
  symlinkSync(path.join(dir, 'real.txt'), path.join(dir, 'to-file'));
  symlinkSync(path.join(dir, 'sub'), path.join(dir, 'to-dir'));
  symlinkSync(outside, path.join(dir, 'out'));
  symlinkSync(path.join(dir, 'missing'), path.join(dir, 'broken'));
  const type = Object.fromEntries(listDir(base, '').entries.map((e) => [e.name, e.type]));
  assert.deepEqual(type, { sub: 'dir', 'to-dir': 'dir', out: 'link', broken: 'link', 'real.txt': 'file', 'to-file': 'file' });
  assert.equal(readText(base, 'to-file').content, 'real');
  done();
});

test('a link to something inside the folder can be read', () => {
  const { dir, base, done } = setup();
  mkdirSync(path.join(dir, 'sub')); writeFileSync(path.join(dir, 'sub', 'a.txt'), 'in sub');
  symlinkSync(path.join(dir, 'sub'), path.join(dir, 'alias'));
  assert.equal(readText(base, 'alias/a.txt').content, 'in sub');
  done();
});

test('text is read with its size and time; binary and large files are only described', () => {
  const { dir, base, done } = setup();
  writeFileSync(path.join(dir, 'a.txt'), 'héllo');
  const text = readText(base, 'a.txt');
  assert.equal(text.binary, false); assert.equal(text.content, 'héllo'); assert.equal(text.size, 6);
  assert.equal(text.mtime, statSync(path.join(dir, 'a.txt')).mtimeMs);
  writeFileSync(path.join(dir, 'b.bin'), Buffer.from([1, 2, 0, 3]));
  assert.deepEqual({ ...readText(base, 'b.bin'), mtime: 0 }, { binary: true, size: 4, mtime: 0 });
  writeFileSync(path.join(dir, 'big.txt'), 'x'.repeat(MAX_EDIT_BYTES + 1));
  assert.equal(readText(base, 'big.txt').binary, true);
  assert.equal('content' in readText(base, 'big.txt'), false);
  done();
});

test('a folder, and a file that is not there, are not read as files', () => {
  const { dir, base, done } = setup();
  mkdirSync(path.join(dir, 'sub'));
  assert.equal(code(() => readText(base, 'sub')), 'invalid');
  assert.equal(code(() => readText(base, 'nope.txt')), 'missing');
  assert.equal(code(() => listDir(base, 'nope')), 'missing');
  writeFileSync(path.join(dir, 'a.txt'), 'x');
  assert.equal(code(() => listDir(base, 'a.txt')), 'invalid');
  done();
});

test('a save replaces the text, and can make a file in a folder that is there', () => {
  const { dir, base, done } = setup();
  writeFileSync(path.join(dir, 'a.txt'), 'a long first version');
  const saved = writeText(base, 'a.txt', 'short');
  assert.equal(readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'short');
  assert.equal(saved.size, 5);
  mkdirSync(path.join(dir, 'sub'));
  writeText(base, 'sub/new.txt', 'made');
  assert.equal(readFileSync(path.join(dir, 'sub', 'new.txt'), 'utf8'), 'made');
  assert.equal(code(() => writeText(base, 'no/such/dir.txt', 'x')), 'missing');
  assert.equal(code(() => writeText(base, 'sub', 'x')), 'invalid');
  done();
});

test('a save over a file that changed since it was opened is refused, and one over a file that did not goes through', () => {
  const { dir, base, done } = setup();
  const file = path.join(dir, 'a.txt');
  writeFileSync(file, 'v1');
  const opened = readText(base, 'a.txt').mtime;
  // The agent writes in between, a while later.
  writeFileSync(file, 'the agent was here'); utimesSync(file, new Date(), new Date(Date.now() + 60_000));
  assert.equal(code(() => writeText(base, 'a.txt', 'mine', opened)), 'conflict');
  assert.equal(readFileSync(file, 'utf8'), 'the agent was here');
  const now = readText(base, 'a.txt').mtime;
  writeText(base, 'a.txt', 'mine', now);
  assert.equal(readFileSync(file, 'utf8'), 'mine');
  done();
});

test('a file too large to edit is refused, and a file with a second name is left alone', () => {
  const { dir, base, outside, done } = setup();
  assert.equal(code(() => writeText(base, 'big.txt', 'x'.repeat(MAX_EDIT_BYTES + 1))), 'too_large');
  linkSync(path.join(outside, 'secret'), path.join(dir, 'twin'));
  assert.equal(code(() => writeText(base, 'twin', 'overwritten')), 'invalid');
  assert.equal(readFileSync(path.join(outside, 'secret'), 'utf8'), 'top secret');
  done();
});

test('a folder is removed with what is in it; a link goes, and what it led to stays', () => {
  const { dir, base, outside, done } = setup();
  mkdirSync(path.join(dir, 'sub')); writeFileSync(path.join(dir, 'sub', 'a.txt'), 'x');
  removeEntry(base, 'sub');
  assert.equal(existsSync(path.join(dir, 'sub')), false);
  symlinkSync(outside, path.join(dir, 'escape'));
  removeEntry(base, 'escape');
  assert.equal(existsSync(path.join(dir, 'escape')), false);
  assert.equal(readFileSync(path.join(outside, 'secret'), 'utf8'), 'top secret');
  symlinkSync(path.join(dir, 'gone'), path.join(dir, 'broken'));
  removeEntry(base, 'broken');
  assert.equal(code(() => removeEntry(base, 'broken')), 'missing');
  done();
});

test('the folder itself cannot be removed, however it is spelled', () => {
  const { dir, base, done } = setup();
  for (const p of ['', '.', './', '/', 'sub/..']) {
    assert.match(code(() => removeEntry(base, p)), /invalid|missing/, JSON.stringify(p));
  }
  assert.equal(existsSync(dir), true);
  done();
});

test('a download is the checked path of a plain file, and nothing else', () => {
  const { dir, base, outside, done } = setup();
  writeFileSync(path.join(dir, 'a.txt'), 'x'); mkdirSync(path.join(dir, 'sub'));
  assert.equal(downloadPath(base, 'a.txt'), path.join(base, 'a.txt'));
  assert.equal(code(() => downloadPath(base, 'sub')), 'invalid');
  assert.equal(code(() => downloadPath(base, 'gone')), 'missing');
  symlinkSync(path.join(outside, 'secret'), path.join(dir, 'peek'));
  assert.equal(code(() => downloadPath(base, 'peek')), 'invalid');
  done();
});

test('a folder that is itself a link is followed once, up front, and checked against where it leads', () => {
  const { top, outside, done } = setup();
  const linked = path.join(top, 'linked');
  symlinkSync(outside, linked);
  // The chat's folder is what its link leads to; from there nothing else is reachable.
  const base = baseDir(linked);
  assert.equal(base, realpathSync(outside));
  assert.equal(code(() => readText(base, '../work')), 'invalid');
  assert.equal(readText(base, 'secret').content, 'top secret');
  assert.equal(code(() => baseDir(path.join(top, 'no-such-folder'))), 'missing');
  done();
});

test('resolveInside returns the canonical path, so what is used is what was checked', () => {
  const { dir, base, done } = setup();
  mkdirSync(path.join(dir, 'sub'));
  symlinkSync(path.join(dir, 'sub'), path.join(dir, 'alias'));
  assert.equal(resolveInside(base, 'alias'), path.join(base, 'sub'));
  done();
});

test('a folder with more entries than the cap is cut off and says so', () => {
  const { dir, base, done } = setup();
  for (let i = 0; i < files.MAX_ENTRIES + 5; i++) writeFileSync(path.join(dir, `f${i}`), '');
  const list = listDir(base, '');
  assert.equal(list.entries.length, files.MAX_ENTRIES);
  assert.equal(list.truncated, true);
  done();
});
