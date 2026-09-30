import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dataDir = mkdtempSync(join(tmpdir(), 'pithagoras-audit-'));
process.env.DATA_DIR = dataDir;

const { recordAudit, listAudit, clearAudit, getDb } = await import('../dist/db.js');
test.after(() => { getDb().close(); rmSync(dataDir, { recursive: true, force: true }); });

test('clearing the audit log removes every entry, and says how many', () => {
  recordAudit({ kind: 'refused', tool: 'bash', subject: 'rm -rf /' });
  recordAudit({ kind: 'stranger', reason: 'unknown sender' });
  assert.equal(listAudit().length, 2);
  assert.equal(clearAudit(), 2);
  assert.deepEqual(listAudit(), []);
});

test('clearing an empty log removes nothing, and the log keeps recording afterwards', () => {
  assert.equal(clearAudit(), 0);
  recordAudit({ kind: 'browsed', subject: 'https://example.com' });
  assert.equal(listAudit().length, 1);
});
