import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dataDir = mkdtempSync(join(tmpdir(), 'pithagoras-audit-'));
process.env.DATA_DIR = dataDir;

const { default: express } = await import('express');
const { peopleRouter } = await import('../dist/api/people.js');
const { recordAudit, listAudit, clearAudit, getDb, AUDIT_KEEP } = await import('../dist/db.js');

const app = express();
app.use(express.json());
app.use('/api', peopleRouter());
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}/api`;
test.after(() => { server.close(); getDb().close(); rmSync(dataDir, { recursive: true, force: true }); });

const entries = () => fetch(`${base}/audit`).then((r) => r.json()).then((r) => r.entries);

test('DELETE /api/audit removes every entry, says how many, and leaves only a note that it did', async () => {
  clearAudit();
  recordAudit({ kind: 'refused', tool: 'bash', subject: 'rm -rf /' });
  recordAudit({ kind: 'stranger', reason: 'unknown sender' });
  assert.equal((await entries()).length, 2);
  const r = await fetch(`${base}/audit`, { method: 'DELETE' });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { removed: 2 });
  const left = await entries();
  assert.deepEqual(left.map((e) => [e.kind, e.reason]), [['cleared', '2']]);
});

test('with ?through, entries recorded after that id survive the clear', async () => {
  clearAudit();
  recordAudit({ kind: 'refused', subject: 'seen' });
  const [seen] = await entries();
  recordAudit({ kind: 'refused', subject: 'recorded while asking' });
  const r = await fetch(`${base}/audit?through=${seen.id}`, { method: 'DELETE' });
  assert.deepEqual(await r.json(), { removed: 1 });
  const left = await entries();
  assert.deepEqual(left.map((e) => e.kind), ['cleared', 'refused']);
  assert.equal(left[1].subject, 'recorded while asking');
});

test('clearing an empty log removes nothing', async () => {
  clearAudit();
  const r = await fetch(`${base}/audit`, { method: 'DELETE' });
  assert.deepEqual(await r.json(), { removed: 0 });
});

test('the log keeps recording after a clear, and still keeps only the newest entries', () => {
  clearAudit();
  for (let i = 0; i < AUDIT_KEEP + 5; i++) recordAudit({ kind: 'browsed', subject: String(i) });
  const all = listAudit(AUDIT_KEEP + 10);
  assert.equal(all.length, AUDIT_KEEP);
  assert.equal(all[0].subject, String(AUDIT_KEEP + 4));
});
