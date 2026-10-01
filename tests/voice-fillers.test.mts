import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
const dir = mkdtempSync(join(tmpdir(), 'pithagoras-fillers-'));
process.env.DATA_DIR = dir;
process.env.DOCKER_SOCKET = join(dir, 'no-docker.sock');
const { voiceRouter, pcmWav } = await import('../server/src/api/voice.js');
const { FillerStore, FILLERS } = await import('../server/src/voice-fillers.js');
const { getDb } = await import('../server/src/db.js');
const seconds = (n: number) => Buffer.alloc(Math.round(n * 24000) * 2, 1);
const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
const KEY = 'a'.repeat(40);

test('the clips are made once, one after another, and kept: a later start finds them', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fillers-'));
  const made: string[] = [];
  const render = async (text: string) => { made.push(text); return seconds(1); };
  const store = new FillerStore(() => root, async () => {});
  assert.deepEqual(await store.status(KEY, render), { clips: [], rendering: true });
  while ((await store.status(KEY, render)).rendering) await tick(5);
  // A portal that was restarted has only the disk to go by.
  const again = new FillerStore(() => root, async () => {});
  assert.deepEqual(await again.status(KEY, render), { clips: FILLERS.map((_, i) => i), rendering: false });
  assert.deepEqual(made, FILLERS.map(f => f.text));
  assert.equal((await again.read(KEY, 1))?.length, seconds(1).length);
  rmSync(root, { recursive: true, force: true });
});

test('a clip that comes out too long or empty is the runtime saying it twice or nothing: thrown away, and not tried again', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fillers-'));
  let made = 0;
  const render = async (text: string) => { made++; return text === FILLERS[0].text ? seconds(FILLERS[0].longest * 2) : text === FILLERS[1].text ? Buffer.alloc(0) : seconds(1.2); };
  const store = new FillerStore(() => root, async () => {});
  await store.status(KEY, render);
  let status = await store.status(KEY, render);
  while (status.rendering) { await tick(5); status = await store.status(KEY, render); }
  assert.deepEqual(status.clips, FILLERS.map((_, i) => i).slice(2));
  assert.equal(await store.read(KEY, 0), undefined);
  await store.status(KEY, render);
  assert.equal(made, FILLERS.length);
  rmSync(root, { recursive: true, force: true });
});

test('a clip is only made when nothing live is being said, so that it never holds the runtime against the answer', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fillers-'));
  let live = true; const started: string[] = [];
  const store = new FillerStore(() => root, async () => { while (live) await tick(5); });
  const render = async (text: string) => { started.push(text); return seconds(1); };
  await store.status(KEY, render);
  await tick(40);
  assert.deepEqual(started, []);
  live = false;
  while ((await store.status(KEY, render)).rendering) await tick(5);
  assert.deepEqual(started, FILLERS.map(f => f.text));
  rmSync(root, { recursive: true, force: true });
});

test('a failure is told once and not tried again at once; after a while it is', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fillers-'));
  let now = 0, calls = 0; const warned: string[] = [];
  const store = new FillerStore(() => root, async () => {}, message => warned.push(message), () => now);
  const render = async () => { calls++; throw new Error('runtime down'); };
  await store.status(KEY, render); await tick(10);
  assert.deepEqual(await store.status(KEY, render), { clips: [], rendering: false });
  assert.deepEqual(warned, ['runtime down']); assert.equal(calls, 1);
  now = 61_000;
  await store.status(KEY, render); await tick(10);
  assert.equal(calls, 2);
  rmSync(root, { recursive: true, force: true });
});

test('another voice drops the clips of the old one, and a key or number that is not one reads nothing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fillers-'));
  const store = new FillerStore(() => root, async () => {});
  const other = 'b'.repeat(40);
  for (const key of [KEY, other]) { while ((await store.status(key, async () => seconds(1))).rendering) await tick(5); }
  assert.deepEqual(readdirSync(root), [other]);
  assert.equal(await store.read('../../etc', 0), undefined);
  assert.equal(await store.read(other, -1), undefined);
  assert.equal(await store.read(other, FILLERS.length), undefined);
  assert.equal(await store.read(other, 0.5), undefined);
  await assert.rejects(store.status('../x', async () => seconds(1)));
  rmSync(root, { recursive: true, force: true });
});

// The same through the portal's own routes, against a Chatterbox that answers as it does.
const heard: { input: string; language: string }[] = [];
let slow: (() => void) | undefined; let hold = false; let long = '';
const upstream = express();
upstream.post('/v1/audio/speech', express.json({ limit: '5mb' }), async (req, res) => {
  const wav = (n: number) => res.set({ 'Content-Type': 'audio/wav' }).send(pcmWav(seconds(n)));
  if (req.body.input === 'live speech') { hold = true; await new Promise<void>(resolve => { slow = resolve; }); hold = false; return wav(1); }
  heard.push({ input: req.body.input, language: req.body.language });
  wav(req.body.input === long ? 6 : 1.2);
});
const backend = upstream.listen(0, '127.0.0.1'); await new Promise<void>(r => backend.once('listening', r));
const port = (backend.address() as { port: number }).port;
const app = express(); app.use(express.json()); app.use('/api', voiceRouter());
const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
after(async () => {
  await Promise.all([new Promise<void>(r => server.close(() => r())), new Promise<void>(r => backend.close(() => r()))]);
  getDb().close(); rmSync(dir, { recursive: true, force: true });
});
mkdirSync(join(dir, 'voices')); writeFileSync(join(dir, 'voices/aria.wav'), pcmWav(Buffer.alloc(32))); writeFileSync(join(dir, 'voices/aria.txt'), 'The reference words.');
getDb().prepare("INSERT INTO sessions (id,title,workspace,executor,status,created_at,updated_at) VALUES ('s','Voice','/tmp','host','idle','now','now')").run();
const save = (extra: object = {}) => fetch(`${base}/voice`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true, whisperUrl: `http://127.0.0.1:${port}/inference`, breezeUrl: `http://127.0.0.1:${port}/v1/audio/speech`, instruction: 'A calm voice.', runtime: 'chatterbox', voice: 'aria', language: 'de', ...extra }) });
const fillers = async () => (await fetch(`${base}/sessions/s/voice/fillers`)).json() as Promise<{ key: string; clips: number[]; rendering: boolean }>;
const ready = async () => { let status = await fillers(); while (status.rendering) { await tick(10); status = await fillers(); } return status; };

test('the portal makes the fillers in the voice and language set, from the same text whatever the language, and serves them as PCM', async () => {
  assert.equal((await save({ language: 'de' })).status, 200);
  const german = await ready();
  assert.deepEqual(german.clips, FILLERS.map((_, i) => i));
  assert.deepEqual(heard.map(h => h.input), FILLERS.map(f => f.text));
  assert.ok(heard.every(h => h.language === 'de'));
  const clip = await fetch(`${base}/sessions/s/voice/fillers/${german.key}/2`);
  assert.equal(clip.headers.get('content-type'), 'audio/pcm'); assert.equal(clip.headers.get('x-sample-rate'), '24000');
  assert.equal((await clip.arrayBuffer()).byteLength, seconds(1.2).length);
  // Another language: another voice for the portal, said from the same words.
  heard.length = 0;
  assert.equal((await save({ language: 'ko' })).status, 200);
  const korean = await ready();
  assert.notEqual(korean.key, german.key);
  assert.deepEqual(heard.map(h => h.input), FILLERS.map(f => f.text));
  assert.ok(heard.every(h => h.language === 'ko'));
  // Asking again is not making again.
  heard.length = 0; await ready(); await fillers();
  assert.deepEqual(heard, []);
  assert.equal((await fetch(`${base}/sessions/s/voice/fillers/${german.key}/0`)).status, 404);
  assert.equal((await fetch(`${base}/sessions/s/voice/fillers/${korean.key}/99`)).status, 404);
  assert.equal((await fetch(`${base}/sessions/s/voice/fillers/..%2F..%2Fx/0`)).status, 404);
});

test('a render that comes out as a run-on is not offered', async () => {
  long = FILLERS[3].text;
  assert.equal((await save({ language: 'fr' })).status, 200);
  const status = await ready();
  assert.deepEqual(status.clips, [0, 1, 2, 4]);
  long = '';
});

test('while live speech is being made, no filler is started; the answer comes first', async () => {
  assert.equal((await save({ language: 'it' })).status, 200);
  heard.length = 0;
  const speaking = fetch(`${base}/sessions/s/voice/speech`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"text":"live speech"}' });
  while (!hold) await tick(5);
  try {
    await fillers(); await tick(600);
    assert.deepEqual(heard, []);
  } finally { slow!(); }
  assert.equal((await speaking).status, 200);
  const status = await ready();
  assert.equal(status.clips.length, FILLERS.length);
});

test('a portal with status speech off, or with no speech synthesis, makes and offers nothing', async () => {
  heard.length = 0;
  process.env.VOICE_STATUS_SPEECH = 'false';
  try {
    assert.equal((await save({ language: 'es' })).status, 200);
    assert.deepEqual(await fillers(), { key: '', clips: [], rendering: false });
  } finally { delete process.env.VOICE_STATUS_SPEECH; }
  assert.equal((await save({ language: 'es', runtime: 'none', breezeUrl: '', voice: 'design' })).status, 200);
  assert.deepEqual(await fillers(), { key: '', clips: [], rendering: false });
  assert.deepEqual(heard, []);
});

test('a voice that cannot speak has no fillers, and says why', async () => {
  rmSync(join(dir, 'voices/aria.wav'));
  assert.equal((await save({ language: 'pl' })).status, 200);
  const status = await fillers() as { clips: number[]; error?: string };
  assert.deepEqual(status.clips, []); assert.match(status.error ?? '', /Aria/);
});
