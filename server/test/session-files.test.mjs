import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
const { removeSessionFiles } = await import('../dist/session-files.js');

const root = () => mkdtempSync(path.join(tmpdir(), 'session-files-'));

test("a session's folder and the conversation in it are removed, and only that one", () => {
  const r = root();
  mkdirSync(path.join(r, 'abc123'));
  writeFileSync(path.join(r, 'abc123', '2026-09-19_x.jsonl'), '{}');
  mkdirSync(path.join(r, 'other'));
  writeFileSync(path.join(r, 'other', 'keep.jsonl'), '{}');
  assert.equal(removeSessionFiles(r, 'abc123'), true);
  assert.equal(existsSync(path.join(r, 'abc123')), false);
  assert.equal(existsSync(path.join(r, 'other', 'keep.jsonl')), true);
  rmSync(r, { recursive: true });
});

test('a session that never wrote anything is not an error', () => {
  const r = root();
  assert.equal(removeSessionFiles(r, 'never-started'), false);
  rmSync(r, { recursive: true });
});

test('nothing outside the root can be reached through an id', () => {
  const r = root(); const outside = root();
  writeFileSync(path.join(outside, 'precious'), 'x');
  for (const id of ['..', '.', '', '../' + path.basename(outside), 'a/b', 'a\\b', '/etc', 'x\0y', '.hidden']) {
    assert.throws(() => removeSessionFiles(r, id), /not a session id/, JSON.stringify(id));
  }
  assert.equal(existsSync(path.join(outside, 'precious')), true);
  rmSync(r, { recursive: true }); rmSync(outside, { recursive: true });
});

test('a link in the place of the folder is removed as a link, and what it pointed at stays', () => {
  const r = root(); const outside = root();
  writeFileSync(path.join(outside, 'precious'), 'x');
  symlinkSync(outside, path.join(r, 'linked'));
  assert.equal(removeSessionFiles(r, 'linked'), true);
  assert.equal(existsSync(path.join(r, 'linked')), false);
  assert.equal(readFileSync(path.join(outside, 'precious'), 'utf8'), 'x');
  rmSync(r, { recursive: true }); rmSync(outside, { recursive: true });
});
