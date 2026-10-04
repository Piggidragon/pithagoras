import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// How the browser, Understory and the voice service start, stop and remove their containers and download their images,
// against a fake Docker daemon: one set of rules for all three, since each of them used to carry its own. Nothing of
// this machine's Docker is touched.
const dir = mkdtempSync(path.join(tmpdir(), 'docker-lifecycle-'));
process.env.DATA_DIR = dir;
process.env.DOCKER_SOCKET = path.join(dir, 'docker.sock');
process.env.PORTAL_CONTAINER_NAME = 'portal-test';

type Box = { running: boolean; labels: Record<string, string> };
let boxes = new Map<string, Box>();
let images = new Set<string>();
let calls: string[] = [];
// A verb Docker refuses, with what it says, or nothing to say.
let refuse: Record<string, { status: number; message?: string }> = {};
// While set, a download does not end, after it has said its first line: an image that is on its way.
let pullGate: Promise<void> | null = null;
let pullError: string | null = null;
const noSuch = (name: string) => JSON.stringify({ message: `No such container: ${name}` });

const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const c of req) raw += c;
  const body = raw ? JSON.parse(raw) : undefined; const url = req.url!; const method = req.method!;
  calls.push(`${method} ${url}`);
  res.setHeader('Content-Type', 'application/json');
  const verb = url.match(/^\/containers\/([^/?]+)\/(start|stop)/);
  const refused = verb && refuse[verb[2]] || method === 'DELETE' && url.startsWith('/containers/') && refuse.remove;
  if (refused) { res.statusCode = refused.status; return res.end(refused.message ? JSON.stringify({ message: refused.message }) : ''); }
  if (url === '/containers/portal-test/json') return res.end(JSON.stringify({ Id: 'portal-one', State: { Running: true } }));
  if (url.startsWith('/images/create')) {
    const q = new URL(url, 'http://docker').searchParams;
    res.write('{"status":"Pulling fs layer"}\n');
    await pullGate;
    if (pullError) return res.end(`{"error":${JSON.stringify(pullError)}}\n`);
    images.add(`${q.get('fromImage')}:${q.get('tag')}`);
    return res.end('{"status":"Download complete"}\n');
  }
  if (url.startsWith('/images/')) { res.statusCode = images.has(decodeURIComponent(url.slice('/images/'.length, -'/json'.length))) ? 200 : 404; return res.end('{}'); }
  if (url === '/volumes/create') return res.end('{}');
  if (url.startsWith('/volumes/')) { res.statusCode = 204; return res.end(); }
  if (url === '/_ping') return res.end('OK');
  const create = url.match(/^\/containers\/create\?name=(.+)$/);
  if (create) { boxes.set(create[1], { running: false, labels: body.Labels ?? {} }); res.statusCode = 201; return res.end(JSON.stringify({ Id: 'new-one' })); }
  const named = url.match(/^\/containers\/([^/?]+)(?:\/(json|start|stop|logs))?/);
  const name = named?.[1] ?? '', box = boxes.get(name);
  if (!named || !box) { res.statusCode = 404; return res.end(noSuch(name)); }
  if (method === 'DELETE') { boxes.delete(name); res.statusCode = 204; return res.end(); }
  if (named[2] === 'json') return res.end(JSON.stringify({ Id: `${name}-id`, State: { Running: box.running }, Config: { Labels: box.labels }, HostConfig: { NetworkMode: 'container:portal-one' } }));
  if (named[2] === 'logs') return res.end('""');
  if (named[2] === 'start' || named[2] === 'stop') {
    const on = named[2] === 'start';
    // What Docker answers when it is as asked already.
    if (box.running === on) { res.statusCode = 304; return res.end(); }
    box.running = on; res.statusCode = 204; return res.end();
  }
  res.end('{}');
});
await new Promise<void>(r => server.listen(process.env.DOCKER_SOCKET, r));
const browser = await import('../server/src/extensions/browser-service.js');
const understory = await import('../server/src/extensions/understory-service.js');
const voice = await import('../server/src/extensions/voice-service.js');
const { getDb } = await import('../server/src/db.js');
after(async () => {
  await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
  getDb().close(); rmSync(dir, { recursive: true, force: true });
});

const reset = () => { boxes = new Map(); images = new Set(); calls = []; refuse = {}; pullGate = null; pullError = null; };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const until = async (done: () => boolean | Promise<boolean>) => { for (let n = 0; n < 300 && !(await done()); n++) await sleep(10); };
// A container as each add-on makes it: the labels they check for, and the voice service's own network, so that it is as it wants it.
const LABELS: Record<string, Record<string, string>> = { 'pithagoras-browser': {}, 'pithagoras-understory': { 'pithagoras.addon': 'understory' }, 'pithagoras-voice': { 'pithagoras.addon': 'voice', 'pithagoras.voice-network': 'shared-v1' } };
const seed = (name: string, running: boolean) => boxes.set(name, { running, labels: LABELS[name] });
const gate = () => { let open!: () => void; pullGate = new Promise<void>(r => (open = r)); return open; };

// The three, by the same name for what they have the same of: the add-ons that are driven by calls.
const BROWSER = browser.CONTAINER, UNDERSTORY = understory.CONTAINER, VOICE = voice.CONTAINER;
const stoppers: [string, string, () => Promise<void>][] = [
  ['browser', BROWSER, () => browser.stop()],
  ['understory', UNDERSTORY, () => understory.stop()],
  ['voice', VOICE, () => voice.stop()],
];
test('stopping a container that was removed by hand is as good as stopped, in all three', async () => {
  for (const [what, name, stop] of stoppers) {
    reset();
    await stop();
    assert.deepEqual(calls.filter(c => c.startsWith('POST')), [`POST /containers/${name}/stop?t=10`], `${what}: asked once, and not an error`);
  }
});

test('stopping one that is stopped already, and starting one that is running already, is as asked in all three', async () => {
  for (const [what, name, stop] of stoppers) {
    reset(); seed(name, false);
    await stop();
    assert.equal(boxes.get(name)!.running, false, `${what}: stopped one stays stopped`);
  }
  reset(); seed(BROWSER, true);
  await browser.start();
  seed(UNDERSTORY, true);
  await understory.start();
  assert.deepEqual([boxes.get(BROWSER)!.running, boxes.get(UNDERSTORY)!.running], [true, true]);
});

test('a running container is stopped, then it is as stopped, in all three', async () => {
  for (const [what, name, stop] of stoppers) {
    reset(); seed(name, true);
    await stop();
    assert.equal(boxes.get(name)!.running, false, what);
  }
});

test('what Docker refuses is an error in its own words, or in the verb\'s where it has none, in all three', async () => {
  for (const [what, name, stop] of stoppers) {
    reset(); seed(name, true);
    refuse = { stop: { status: 500, message: 'the daemon is busy' } };
    await assert.rejects(stop(), /the daemon is busy/, what);
  }
  for (const [what, name, stop] of stoppers.slice(0, 2)) {
    reset(); seed(name, true);
    refuse = { stop: { status: 500 } };
    await assert.rejects(stop(), /Stop failed \(500\)/, what);
  }
  reset(); seed(BROWSER, false); refuse = { start: { status: 500 } };
  await assert.rejects(browser.start(), /Start failed \(500\)/);
  reset(); seed(UNDERSTORY, false); refuse = { start: { status: 500, message: 'no space left' } };
  await assert.rejects(understory.start(), /no space left/);
  reset(); seed(BROWSER, true); refuse = { remove: { status: 500, message: 'removal is in progress' } };
  await assert.rejects(browser.remove(), /removal is in progress/);
  reset(); seed(UNDERSTORY, true); refuse = { remove: { status: 409 } };
  await assert.rejects(understory.remove(), /Remove failed \(409\)/);
});

test('removing a container: a running one is stopped first, one that is stopped or gone is not an error', async () => {
  const removers: [string, string, () => Promise<void>][] = [['browser', BROWSER, () => browser.remove()], ['understory', UNDERSTORY, () => understory.remove()]];
  for (const [what, name, remove] of removers) {
    reset(); seed(name, true);
    await remove();
    assert.deepEqual(calls.filter(c => c.startsWith('POST') || c.startsWith('DELETE')), [`POST /containers/${name}/stop?t=10`, `DELETE /containers/${name}?force=true`], `${what}: running`);
    assert.equal(boxes.has(name), false);
    reset(); seed(name, false);
    await remove();
    assert.deepEqual(calls.filter(c => c.startsWith('POST') || c.startsWith('DELETE')), [`DELETE /containers/${name}?force=true`], `${what}: stopped`);
    reset();
    await remove();
    assert.equal(boxes.size, 0, `${what}: gone`);
  }
  // The same removal under the voice service, which also asks whether the container is its own first.
  reset(); seed(VOICE, true);
  await voice.uninstall();
  assert.deepEqual(calls.filter(c => c.startsWith('POST') || c.startsWith('DELETE')), [`POST /containers/${VOICE}/stop?t=10`, `DELETE /containers/${VOICE}?force=true`]);
  // Docker answering "no such container" to the removal, because it went in the meantime, is a removal.
  reset(); seed(BROWSER, true);
  const base = server.listeners('request')[0] as (...a: unknown[]) => unknown;
  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    if (req.method === 'DELETE') { boxes.delete(BROWSER); res.statusCode = 404; res.end(noSuch(BROWSER)); return; }
    base(req, res);
  });
  try { await browser.remove(); } finally { server.removeAllListeners('request'); server.on('request', base as never); }
});

test('an image that is not there is downloaded with the daemon\'s lines shown, then done, by the browser and by Understory', async () => {
  reset(); browser.saveConfig({ password: 'secret' });
  // The gate is opened whatever the checks say, so that a failing one is reported and not waited on.
  let open = gate();
  try {
    const installing = browser.install();
    await until(() => browser.pullState().line === 'Pulling fs layer');
    assert.deepEqual(browser.pullState(), { active: true, line: 'Pulling fs layer' });
    open(); await installing;
  } finally { open(); }
  assert.deepEqual(browser.pullState(), { active: false, line: 'done' });
  assert.deepEqual([boxes.get(BROWSER)?.running, images.has('lscr.io/linuxserver/chromium:latest')], [true, true]);

  reset();
  open = gate();
  try {
    const installing = understory.install();
    await until(async () => (await understory.status()).pulling.line === 'Pulling fs layer');
    assert.deepEqual((await understory.status()).pulling, { active: true, line: 'Pulling fs layer' });
    open(); await installing;
  } finally { open(); }
  assert.deepEqual((await understory.status()).pulling, { active: false, line: 'done' });
  assert.equal(boxes.get(UNDERSTORY)?.running, true);

  // An image that is there is not downloaded again, and what was said of the last download is left as it was.
  calls = [];
  await understory.install();
  assert.equal(calls.some(c => c.startsWith('POST /images/create')), false);
  assert.deepEqual((await understory.status()).pulling, { active: false, line: 'done' });
});

test('a download that fails is said, and the install does not go on, by the browser and by Understory', async () => {
  reset(); browser.saveConfig({ password: 'secret' });
  pullError = 'pull access denied';
  const open = gate(); open();
  await assert.rejects(browser.install(), /pull access denied/);
  assert.deepEqual(browser.pullState(), { active: false, line: '', error: 'pull access denied' });
  assert.equal(boxes.size, 0);
  await assert.rejects(understory.install(), /pull access denied/);
  assert.deepEqual((await understory.status()).pulling, { active: false, line: '', error: 'pull access denied' });
  assert.equal(boxes.size, 0);
});

test('the voice service shows what the daemon says of an image on its way, and starts the container once it is there', async () => {
  reset();
  // Made by an older install, with the image gone: a start downloads it again, and keeps what the container has.
  seed(VOICE, false);
  const open = gate();
  try {
    await voice.install();
    await until(async () => (await voice.status()).progress === 'Pulling fs layer');
    const shown = await voice.status();
    assert.deepEqual([shown.busy, shown.progress], [true, 'Pulling fs layer']);
  } finally { open(); }
  await until(async () => !(await voice.status()).busy);
  assert.equal((await voice.status()).error, '');
  assert.equal(boxes.get(VOICE)?.running, true);
});

test('a download that fails ends the voice setup with what Docker said', async () => {
  reset(); seed(VOICE, false);
  pullError = 'toomanyrequests: rate limit';
  const open = gate(); open();
  await voice.install();
  await until(async () => !(await voice.status()).busy);
  assert.match((await voice.status()).error, /rate limit/);
  assert.equal(boxes.get(VOICE)?.running, false);
});
