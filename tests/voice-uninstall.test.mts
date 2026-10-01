import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';

// Uninstalling the managed voice service, through the API, against a fake Docker daemon: the container and the volume it
// leaves, and the saved settings the install overwrote. No GPU, no image and no container of this machine is touched.
const dir = mkdtempSync(path.join(tmpdir(), 'voice-uninstall-'));
process.env.DATA_DIR = dir;
process.env.DOCKER_SOCKET = path.join(dir, 'docker.sock');
process.env.PORTAL_CONTAINER_NAME = 'portal-test';
// A host with neither nvidia-smi nor a GPU runtime for Docker: what is installed here is recognition alone, which needs no GPU.
process.env.NVIDIA_SMI = path.join(dir, 'no-such-nvidia-smi');
delete process.env.VOICE_GPU;
const NO_RUNTIME = 'could not select device driver "nvidia" with capabilities: [[gpu]]';
const CONTAINER = 'pithagoras-voice', VOLUME = 'pithagoras_voice-models';

let container: any = null;
let volumes = new Set<string>();
let images = new Set<string>(['ubuntu:22.04']);
// While set, a download of an image does not end: a setup that is under way.
let pullGate: Promise<void> | null = null;
let calls: { method: string; url: string }[] = [];
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const c of req) raw += c;
  const body = raw ? JSON.parse(raw) : undefined; const url = req.url!; const method = req.method!;
  calls.push({ method, url });
  res.setHeader('Content-Type', 'application/json');
  if (url === '/containers/portal-test/json') return res.end(JSON.stringify({ Id: 'portal-one', State: { Running: true } }));
  if (url === `/containers/${CONTAINER}/json`) { res.statusCode = container ? 200 : 404; return res.end(JSON.stringify(container)); }
  if (url.startsWith(`/containers/${CONTAINER}/logs`)) return res.end(JSON.stringify('services ready'));
  if (url.startsWith('/images/create')) {
    await pullGate;
    const q = new URL(url, 'http://docker').searchParams;
    images.add(`${q.get('fromImage')}:${q.get('tag')}`);
    return res.end('{"status":"Download complete"}\n');
  }
  if (url.startsWith('/images/')) { res.statusCode = images.has(decodeURIComponent(url.slice('/images/'.length, -'/json'.length))) ? 200 : 404; return res.end('{}'); }
  // The throwaway container that reads nvidia-smi: Docker has no GPU runtime here.
  if (url === '/containers/create') { res.statusCode = 500; return res.end(JSON.stringify({ message: NO_RUNTIME })); }
  if (url === '/volumes/create') { volumes.add(body.Name); return res.end('{}'); }
  if (method === 'DELETE' && url.startsWith('/volumes/')) {
    const name = url.slice('/volumes/'.length);
    if (!volumes.has(name)) { res.statusCode = 404; return res.end(JSON.stringify({ message: `get ${name}: no such volume` })); }
    // As Docker refuses it: a container still has it.
    if (container) { res.statusCode = 409; return res.end(JSON.stringify({ message: `volume is in use - [${CONTAINER}]` })); }
    volumes.delete(name); res.statusCode = 204; return res.end();
  }
  if (url.includes('/stop?')) container.State.Running = false;
  if (method === 'DELETE' && url === `/containers/${CONTAINER}`) { container = null; res.statusCode = 204; return res.end(); }
  if (url.startsWith(`/containers/create?name=${CONTAINER}`)) container = { Config: body, HostConfig: body.HostConfig, State: { Running: false } };
  if (url === `/containers/${CONTAINER}/start`) container.State.Running = true;
  res.end('{}');
});
await new Promise<void>(r => server.listen(process.env.DOCKER_SOCKET, r));
const { voiceRouter } = await import('../server/src/api/voice.js');
const { getDb } = await import('../server/src/db.js');
const voice = await import('../server/src/extensions/voice-service.js');
voice.hostReader.read = () => ({ totalMiB: 16384, freeMiB: 12000, threads: 8 });
const app = express(); app.use(express.json()); app.use('/api', voiceRouter());
const portal = app.listen(0, '127.0.0.1'); await new Promise<void>(r => portal.once('listening', r));
const base = `http://127.0.0.1:${(portal.address() as { port: number }).port}/api`;
// The services of the container answer as healthy; the portal's own API is reached as it is.
const oldFetch = globalThis.fetch;
globalThis.fetch = ((url: any, init?: any) => String(url).startsWith(base) ? oldFetch(url, init) : Promise.resolve(new Response('{}'))) as typeof fetch;
after(async () => {
  globalThis.fetch = oldFetch;
  await Promise.all([new Promise<void>(r => portal.close(() => r())), new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()))]);
  getDb().close(); rmSync(dir, { recursive: true, force: true });
});

const json = { 'Content-Type': 'application/json' };
const get = async (p: string) => (await oldFetch(`${base}${p}`)).json() as Promise<any>;
const post = (p: string, body?: unknown) => oldFetch(`${base}${p}`, { method: 'POST', headers: json, body: JSON.stringify(body ?? {}) });
const put = (body: object) => oldFetch(`${base}/voice`, { method: 'PUT', headers: json, body: JSON.stringify(body) });
const stored = (key: string) => (getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value;
const reset = () => {
  container = null; volumes = new Set(); images = new Set(['ubuntu:22.04']); pullGate = null; calls = [];
  getDb().prepare("DELETE FROM settings WHERE key IN ('voice', 'voice_before_managed', 'voice_setup_pending')").run();
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
/** Waits for a setup to end, then reads the status once more: that read is what connects the saved settings to a service that has come up. */
const settle = async () => { for (let n = 0; n < 300 && (await get('/voice/install')).busy; n++) await sleep(10); return get('/voice/install'); };
const RECOGNITION_ONLY = { tts: 'none', asr: 'whisper', asrModel: 'base' };
const install = async (choice: object = RECOGNITION_ONLY) => { assert.equal((await post('/voice/install', choice)).status, 200); return settle(); };
/** A voice container as the installer of an older portal made it, with nothing remembered of the settings it overwrote. */
const seedContainer = (running = true) => { container = { Config: { Labels: { 'pithagoras.addon': 'voice', 'pithagoras.voice-network': 'shared-v1' } }, HostConfig: { NetworkMode: 'container:portal-one' }, State: { Running: running } }; volumes.add(VOLUME); };
const removed = () => calls.filter(c => c.method === 'DELETE').map(c => c.url);

// A speech recognition server and a speech server the user runs themselves, with the model one of them is told to use.
const OWN = { enabled: true, whisperUrl: 'http://stt.example.test:9000/inference', breezeUrl: 'http://tts.example.test:9001/v1/audio/speech', instruction: 'A calm voice.', runtime: 'breeze', sttModel: 'my-model', voice: 'design', language: 'de' };
const MANAGED = { whisper: 'http://127.0.0.1:8188/inference', qwen: 'http://127.0.0.1:7862/v1/audio/transcriptions', speech: 'http://127.0.0.1:7862/v1/audio/speech' };
const DEFAULTS = { whisperUrl: 'http://127.0.0.1:8178/inference', breezeUrl: 'http://127.0.0.1:7860/v1/audio/speech' };
const fields = (c: any) => ({ enabled: c.enabled, runtime: c.runtime, whisperUrl: c.whisperUrl, breezeUrl: c.breezeUrl, sttModel: c.sttModel });

test('install overwrites the settings, and uninstall puts back exactly what they were: the container goes, the downloads stay', async () => {
  reset();
  assert.equal((await put({ ...OWN, vad: { positiveSpeechThreshold: 0.7, negativeSpeechThreshold: 0.3, minSpeechMs: 300, preSpeechPadMs: 200, redemptionMs: 800 } })).status, 200);
  const up = await install();
  assert.equal(up.state, 'running');
  // What the install does to the settings: the runtime is none for recognition alone, and the addresses are the managed service's.
  assert.deepEqual(fields(await get('/voice')), { enabled: true, runtime: 'none', whisperUrl: MANAGED.whisper, breezeUrl: '', sttModel: '' });
  calls = [];
  const answer = await post('/voice/uninstall');
  assert.deepEqual([answer.status, await answer.json()], [200, { ok: true }]);
  // A running container is stopped, then removed; the volume with the downloads is not touched.
  assert.deepEqual(calls.filter(c => c.method === 'POST' || c.method === 'DELETE').map(c => `${c.method} ${c.url}`), [`POST /containers/${CONTAINER}/stop?t=10`, `DELETE /containers/${CONTAINER}`]);
  assert.equal(container, null);
  assert.ok(volumes.has(VOLUME));
  const back = await get('/voice');
  assert.deepEqual(fields(back), { enabled: true, runtime: 'breeze', whisperUrl: OWN.whisperUrl, breezeUrl: OWN.breezeUrl, sttModel: 'my-model' });
  // The voice, the language and the speech detection are not what an install overwrites, and are as they were.
  assert.deepEqual([back.voice, back.language, back.instruction, back.vad.redemptionMs, back.managed], ['design', 'de', 'A calm voice.', 800, false]);
  // The page shows what a portal that never installed it shows, and Install works again.
  const state = await get('/voice/install');
  assert.deepEqual([state.available, state.state, state.busy, state.error], [true, 'absent', false, '']);
  assert.equal(stored('voice_before_managed'), undefined);
  assert.equal(stored('voice_setup_pending'), undefined);
  assert.equal((await install()).state, 'running');
  assert.deepEqual(fields(await get('/voice')), { enabled: true, runtime: 'none', whisperUrl: MANAGED.whisper, breezeUrl: '', sttModel: '' });
});

test('what was remembered is what there was before the first connect: a second connect, a rebuild and "Use installed voice" do not replace it', async () => {
  reset();
  assert.equal((await put(OWN)).status, 200);
  await install();
  assert.equal((await post('/voice/connect')).status, 200);
  // Rebuilt with other engines: recreated, then connected again.
  assert.equal((await install({ tts: 'none', asr: 'qwen3-asr', asrModel: '0.6b' })).state, 'running');
  assert.equal((await get('/voice')).whisperUrl, 'http://127.0.0.1:7863/v1/audio/transcriptions');
  assert.equal((await post('/voice/uninstall')).status, 200);
  assert.deepEqual(fields(await get('/voice')), { enabled: true, runtime: 'breeze', whisperUrl: OWN.whisperUrl, breezeUrl: OWN.breezeUrl, sttModel: 'my-model' });
});

test('what was set up after the install is the user\'s own and stays, and so is a service that was switched off', async () => {
  reset();
  assert.equal((await put(OWN)).status, 200);
  await install();
  // Their own speech servers again, saved over the managed ones: nothing there points at the service.
  const other = { ...OWN, whisperUrl: 'http://stt2.example.test:9000/inference', breezeUrl: 'http://tts2.example.test:9001/v1/audio/speech', sttModel: 'other-model' };
  assert.equal((await put(other)).status, 200);
  assert.equal((await post('/voice/uninstall')).status, 200);
  assert.deepEqual(fields(await get('/voice')), fields(other));
  assert.equal(stored('voice_before_managed'), undefined);
  // Voice switched off after the install is not switched on by the uninstall.
  reset();
  assert.equal((await put(OWN)).status, 200);
  await install();
  const off = await get('/voice');
  assert.equal((await put({ ...off, enabled: false })).status, 200);
  assert.equal((await post('/voice/uninstall')).status, 200);
  assert.deepEqual(fields(await get('/voice')), { ...fields(OWN), enabled: false });
});

test('a portal that had no voice set up is back to that: the defaults, with voice off', async () => {
  reset();
  assert.equal((await get('/voice')).enabled, false);
  await install();
  assert.equal((await get('/voice')).enabled, true);
  assert.equal((await post('/voice/uninstall')).status, 200);
  const back = await get('/voice');
  assert.deepEqual(fields(back), { enabled: false, runtime: 'breeze', whisperUrl: DEFAULTS.whisperUrl, breezeUrl: DEFAULTS.breezeUrl, sttModel: '' });
  assert.equal(back.managed, false);
});

test('a service installed before settings were remembered: only what points at it is reset, and every other address stays', async () => {
  // Speech and recognition both the managed service's: both go back to a portal with nothing set up, and voice is off.
  reset(); seedContainer();
  assert.equal((await put({ ...OWN, runtime: 'audio-cpp', whisperUrl: MANAGED.qwen, breezeUrl: MANAGED.speech, sttModel: 'qwen3-asr' })).status, 200);
  assert.equal((await post('/voice/uninstall')).status, 200);
  const both = await get('/voice');
  assert.deepEqual(fields(both), { enabled: false, runtime: 'breeze', whisperUrl: DEFAULTS.whisperUrl, breezeUrl: DEFAULTS.breezeUrl, sttModel: '' });
  assert.deepEqual([both.voice, both.language, both.instruction], ['design', 'de', 'A calm voice.']);
  // Recognition alone, with no speech address, is the managed service's as well.
  reset(); seedContainer();
  assert.equal((await put({ ...OWN, runtime: 'none', whisperUrl: MANAGED.whisper, breezeUrl: '', sttModel: '' })).status, 200);
  assert.equal((await post('/voice/uninstall')).status, 200);
  assert.deepEqual(fields(await get('/voice')), { enabled: false, runtime: 'breeze', whisperUrl: DEFAULTS.whisperUrl, breezeUrl: DEFAULTS.breezeUrl, sttModel: '' });
  // Their own speech server beside the managed recognition: it stays, with the runtime it is spoken to in.
  reset(); seedContainer();
  assert.equal((await put({ ...OWN, runtime: 'audio-cpp', whisperUrl: MANAGED.qwen, sttModel: 'qwen3-asr' })).status, 200);
  assert.equal((await post('/voice/uninstall')).status, 200);
  assert.deepEqual(fields(await get('/voice')), { enabled: false, runtime: 'audio-cpp', whisperUrl: DEFAULTS.whisperUrl, breezeUrl: OWN.breezeUrl, sttModel: '' });
  // And the other way round: their own recognition server stays beside the managed speech, which goes.
  reset(); seedContainer();
  assert.equal((await put({ ...OWN, runtime: 'audio-cpp', breezeUrl: MANAGED.speech })).status, 200);
  assert.equal((await post('/voice/uninstall')).status, 200);
  assert.deepEqual(fields(await get('/voice')), { enabled: false, runtime: 'breeze', whisperUrl: OWN.whisperUrl, breezeUrl: DEFAULTS.breezeUrl, sttModel: 'my-model' });
  // Nothing of the managed service in the settings: nothing is changed, not even voice being on.
  reset(); seedContainer();
  assert.equal((await put(OWN)).status, 200);
  assert.equal((await post('/voice/uninstall')).status, 200);
  assert.deepEqual(fields(await get('/voice')), fields(OWN));
});

test('the downloaded engines and models go when asked, after the container, and not otherwise', async () => {
  reset(); seedContainer(false);
  assert.equal((await post('/voice/uninstall', { removeData: false })).status, 200);
  assert.deepEqual(removed(), [`/containers/${CONTAINER}`]);
  assert.ok(volumes.has(VOLUME));
  // The container is stopped already: nothing to stop. The volume is deleted once nothing has it.
  assert.ok(!calls.some(c => c.url.includes('/stop?')));
  calls = [];
  assert.equal((await post('/voice/uninstall', { removeData: true })).status, 200);
  assert.deepEqual(removed(), [`/volumes/${VOLUME}`]);
  assert.equal(volumes.has(VOLUME), false);
  // With the container still there, the volume is deleted after it.
  reset(); seedContainer();
  assert.equal((await post('/voice/uninstall', { removeData: true })).status, 200);
  assert.deepEqual(removed(), [`/containers/${CONTAINER}`, `/volumes/${VOLUME}`]);
  assert.equal(volumes.size, 0);
  assert.equal((await get('/voice/install')).state, 'absent');
});

test('uninstalling what is not installed is harmless, and the choice to delete the downloads still applies', async () => {
  reset();
  assert.equal((await put(OWN)).status, 200);
  const before = await get('/voice');
  for (const body of [{}, { removeData: true }]) {
    const answer = await post('/voice/uninstall', body);
    assert.deepEqual([answer.status, await answer.json()], [200, { ok: true }]);
  }
  // Nothing to stop or remove; a volume that is not there is not an error either.
  assert.deepEqual(removed(), [`/volumes/${VOLUME}`]);
  assert.deepEqual(await get('/voice'), before);
  assert.equal(stored('voice_before_managed'), undefined);
  // A container that was removed by hand, with the settings left pointing at it: they are put right.
  reset();
  assert.equal((await put({ ...OWN, runtime: 'audio-cpp', whisperUrl: MANAGED.qwen, breezeUrl: MANAGED.speech, sttModel: 'qwen3-asr' })).status, 200);
  assert.equal((await post('/voice/uninstall')).status, 200);
  assert.deepEqual(fields(await get('/voice')), { enabled: false, runtime: 'breeze', whisperUrl: DEFAULTS.whisperUrl, breezeUrl: DEFAULTS.breezeUrl, sttModel: '' });
});

test('a container that the portal did not make is left alone, with the settings as they are', async () => {
  reset();
  container = { Config: { Labels: {} }, HostConfig: {}, State: { Running: true } };
  assert.equal((await put({ ...OWN, runtime: 'audio-cpp', whisperUrl: MANAGED.qwen, breezeUrl: MANAGED.speech })).status, 200);
  const answer = await post('/voice/uninstall', { removeData: true });
  assert.equal(answer.status, 400);
  assert.match((await answer.json()).error, /not a managed voice add-on/);
  assert.deepEqual(removed(), []);
  assert.deepEqual(calls.filter(c => c.method === 'POST'), []);
  assert.equal((await get('/voice')).whisperUrl, MANAGED.qwen);
});

test('nothing is uninstalled while a setup is under way, and a choice that is not yes or no is refused', async () => {
  reset();
  assert.equal((await put(OWN)).status, 200);
  let release!: () => void;
  pullGate = new Promise<void>(r => { release = r; });
  images.clear();
  assert.equal((await post('/voice/install', RECOGNITION_ONLY)).status, 200);
  const early = await post('/voice/uninstall');
  assert.equal(early.status, 400);
  assert.match((await early.json()).error, /Wait for voice setup to finish/);
  release();
  assert.equal((await settle()).state, 'running');
  // The setup went on as it was: the settings are connected, and the container is there.
  assert.equal((await get('/voice')).whisperUrl, MANAGED.whisper);
  for (const removeData of ['yes', 1, 'false']) {
    const refused = await post('/voice/uninstall', { removeData });
    assert.equal(refused.status, 400, JSON.stringify(removeData));
    assert.match((await refused.json()).error, /removeData must be true or false/);
  }
  assert.ok(container);
  assert.equal((await post('/voice/uninstall')).status, 200);
});
