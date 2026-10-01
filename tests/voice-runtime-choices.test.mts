import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// The managed service against a fake Docker daemon and a fake nvidia-smi: what is
// asked of Docker for each choice, how the GPU is read and what is refused. No
// GPU, no image and no container is touched.
const dir = mkdtempSync(path.join(tmpdir(), 'voice-choices-'));
process.env.DOCKER_SOCKET = path.join(dir, 'docker.sock');
process.env.PORTAL_CONTAINER_NAME = 'portal-test';
delete process.env.VOICE_GPU;
delete process.env.VOICE_VRAM_RESERVE_MIB;
const smi = path.join(dir, 'nvidia-smi');
const smiOutput = path.join(dir, 'smi-output');
writeFileSync(smi, `#!/bin/sh\ncat "${smiOutput}"\n`);
chmodSync(smi, 0o755);
const noDevices = path.join(dir, 'nvidia-smi-no-devices');
writeFileSync(noDevices, '#!/bin/sh\necho "No devices were found" >&2\nexit 6\n');
chmodSync(noDevices, 0o755);
/** What the host's nvidia-smi prints, or null for a host that has none. */
const hostGpus = (output: string | null) => {
  if (output === null) process.env.NVIDIA_SMI = path.join(dir, 'no-such-nvidia-smi');
  else { process.env.NVIDIA_SMI = smi; writeFileSync(smiOutput, output); }
};

let container: any = null;
let portalId = 'portal-one';
let dockerGpus: string | null = null;   // what nvidia-smi inside the CUDA image prints; null: no GPU runtime
let imageThere = true;
// How Docker fails a container that wants a GPU on a host that has none for it: the daemon's own words.
const NO_RUNTIME = 'could not select device driver "nvidia" with capabilities: [[gpu]]';
let noGpuRuntime = false;               // making the container works, starting one that wants a GPU does not
let probeError: string | null = null;   // an unrelated failure of the probe container
let hangUp = false;                     // the daemon drops the probe's connection
let calls: { method: string; url: string; body: any }[] = [];
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const c of req) raw += c;
  const body = raw ? JSON.parse(raw) : undefined; const url = req.url!; const method = req.method!;
  calls.push({ method, url, body });
  res.setHeader('Content-Type', 'application/json');
  if (url === '/containers/portal-test/json') return res.end(JSON.stringify({ Id: portalId, State: { Running: true } }));
  if (url === '/containers/pithagoras-voice/json') { res.statusCode = container ? 200 : 404; return res.end(JSON.stringify(container)); }
  if (url.startsWith('/containers/pithagoras-voice/logs')) return res.end(JSON.stringify('services ready'));
  if (url.startsWith('/images/')) { res.statusCode = imageThere ? 200 : 404; return res.end('{}'); }
  // The throwaway container that reads nvidia-smi inside the image.
  if (url === '/containers/create') {
    if (hangUp) return req.socket.destroy();
    if (probeError) { res.statusCode = 500; return res.end(JSON.stringify({ message: probeError })); }
    if (dockerGpus === null) { res.statusCode = 500; return res.end(JSON.stringify({ message: NO_RUNTIME })); }
    return res.end(JSON.stringify({ Id: 'probe-1' }));
  }
  if ((url === '/containers/probe-1/start' || url === '/containers/pithagoras-voice/start') && noGpuRuntime) { res.statusCode = 500; return res.end(JSON.stringify({ message: NO_RUNTIME })); }
  if (url === '/containers/probe-1/wait') return res.end(JSON.stringify({ StatusCode: 0 }));
  if (url.startsWith('/containers/probe-1/logs')) return res.end(dockerGpus ?? '');
  if (url.includes('/stop?')) container.State.Running = false;
  if (method === 'DELETE' && url === '/containers/pithagoras-voice') container = null;
  if (url.startsWith('/containers/create?name=pithagoras-voice')) container = { Config: body, HostConfig: body.HostConfig, State: { Running: false } };
  if (url === '/containers/pithagoras-voice/start') container.State.Running = true;
  res.end('{}');
});
await new Promise<void>(r => server.listen(process.env.DOCKER_SOCKET, r));
const oldFetch = globalThis.fetch;
let unhealthy: string[] = [];
globalThis.fetch = (async (url: any) => new Response('{}', { status: unhealthy.some(u => String(url).includes(u)) ? 503 : 200 })) as typeof fetch;
after(async () => {
  globalThis.fetch = oldFetch;
  await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
  rmSync(dir, { recursive: true, force: true });
});
const voice = await import('../server/src/extensions/voice-service.js');
const { DEFAULT_CHOICE } = await import('../server/src/voice-engines.js');
const { NO_GPU_MESSAGE } = await import('../server/src/voice-gpu.js');

const reset = () => { portalId = 'portal-one'; container = null; dockerGpus = null; imageThere = true; noGpuRuntime = false; probeError = null; hangUp = false; calls = []; unhealthy = []; delete process.env.VOICE_GPU; delete process.env.VOICE_VRAM_RESERVE_MIB; };
const settle = async () => { for (let n = 0; n < 200 && (await voice.status()).busy; n++) await new Promise(r => setTimeout(r, 10)); };
const created = () => calls.filter(c => c.url === '/containers/create?name=pithagoras-voice');
const GPU = (index: number, total: number, free: number) => `${index}, Test GPU ${index}, ${total}, ${free}\n`;
const env = (spec: any) => Object.fromEntries(spec.Env.map((e: string) => [e.slice(0, e.indexOf('=')), e.slice(e.indexOf('=') + 1)]));

test('a first install without a choice takes what the GPU check suggests, and says so in the setup log', async () => {
  reset(); hostGpus(GPU(0, 12288, 11000));
  await voice.install();
  await settle();
  assert.equal(created().length, 1);
  const spec = created()[0].body;
  assert.deepEqual(env(spec).VOICE_ASR, 'qwen3-asr');
  assert.deepEqual([env(spec).VOICE_TTS, env(spec).VOICE_ASR_MODEL], ['breeze', '1.7b']);
  assert.equal(spec.Labels['pithagoras.voice-recipe'], 'breeze+qwen3-asr:1.7b');
  assert.match(env(spec).VOICE_PLAN, /^Detected Test GPU 0 \(12\.0 GiB, 10\.7 GiB free\): Breeze speech with Qwen3-ASR 1\.7B needs about 7\.0 GiB, which fits\.$/);
  // One card: Docker's own pick, as it has always been.
  assert.deepEqual(spec.HostConfig.DeviceRequests, [{ Driver: 'nvidia', Count: 1, Capabilities: [['gpu']] }]);
  assert.equal(calls.some(c => c.url === '/containers/create'), false, 'the host had nvidia-smi: no probe container');
  assert.deepEqual(JSON.parse(env(spec).VOICE_SERVER_CONFIG).models.map((m: any) => m.id), ['breeze', 'qwen3-asr']);
  // Ready needs only the audio.cpp process: there is no Whisper.
  unhealthy = [':8188'];
  container.State.Running = true;
  const state = await voice.status();
  assert.deepEqual([state.state, state.choice], ['running', { tts: 'breeze', asr: 'qwen3-asr', asrModel: '1.7b' }]);
});

test('a portal without nvidia-smi reads the GPUs in a throwaway container, and names the one with the most room', async () => {
  reset(); hostGpus(null);
  dockerGpus = GPU(0, 8192, 1000) + GPU(1, 12288, 12000);
  await voice.install({ tts: 'chatterbox', asr: 'qwen3-asr', asrModel: '0.6b' });
  await settle();
  const probe = calls.find(c => c.url === '/containers/create')!.body;
  assert.deepEqual(probe.Cmd.slice(0, 1), ['nvidia-smi']);
  assert.deepEqual(probe.HostConfig.DeviceRequests, [{ Driver: 'nvidia', Count: -1, Capabilities: [['gpu']] }], 'all of them, to choose among');
  assert.ok(calls.some(c => c.method === 'DELETE' && c.url.startsWith('/containers/probe-1')), 'the probe container is removed again');
  assert.equal(calls.some(c => c.url.includes('/images/create')), false, 'the check never pulls an image of its own');
  const spec = created()[0].body;
  assert.deepEqual(spec.HostConfig.DeviceRequests, [{ Driver: 'nvidia', DeviceIDs: ['1'], Capabilities: [['gpu']] }]);
  assert.equal(spec.Labels['pithagoras.voice-recipe'], 'chatterbox+qwen3-asr:0.6b');
  assert.match(env(spec).VOICE_PLAN, /^Detected Test GPU 1 /);
});

test('VOICE_GPU picks the card and VOICE_VRAM_RESERVE_MIB keeps memory on it free', async () => {
  reset(); hostGpus(GPU(0, 8192, 6500) + GPU(1, 12288, 12000));
  process.env.VOICE_GPU = '0';
  await voice.install();
  await settle();
  assert.deepEqual(created()[0].body.HostConfig.DeviceRequests[0].DeviceIDs, ['0']);
  assert.equal(created()[0].body.Labels['pithagoras.voice-recipe'], 'breeze+qwen3-asr:0.6b', '6.5 GB free holds Breeze and the small model, not the large one');
  reset(); hostGpus(GPU(0, 8192, 8000));
  // Without the reserve 8 GB holds the large model too.
  process.env.VOICE_VRAM_RESERVE_MIB = '2500';
  await voice.install();
  await settle();
  assert.equal(created()[0].body.Labels['pithagoras.voice-recipe'], 'breeze+whisper:base', 'room is kept for something else');
  const hardware = await voice.hardware();
  assert.deepEqual([hardware.reserveMiB, hardware.selected, hardware.suggestion], [2500, 0, DEFAULT_CHOICE]);
});

test('a choice the GPU cannot hold is refused with what would fit, and nothing is created', async () => {
  reset(); hostGpus(GPU(0, 6144, 6000));
  await voice.install({ tts: 'breeze', asr: 'qwen3-asr', asrModel: '1.7b' });
  await settle();
  const state = await voice.status();
  assert.match(state.error, /Breeze speech with Qwen3-ASR 1\.7B needs about 7\.0 GiB of GPU memory, but Test GPU 0 \(6\.0 GiB, 5\.9 GiB free\) has less\. Breeze speech with Qwen3-ASR 0\.6B would fit\./);
  assert.equal(state.state, 'absent');
  assert.equal(created().length, 0);
  // The refusal is not sticky: the next attempt starts clean.
  await voice.install({ tts: 'breeze', asr: 'qwen3-asr', asrModel: '0.6b' });
  await settle();
  assert.equal((await voice.status()).error, '');
  assert.equal(created().length, 1);
});

test('where the GPU cannot be told, the choice is installed unchecked and Docker has the last word', async () => {
  reset(); hostGpus(null); probeError = 'no space left on device';
  const unknown = await voice.hardware();
  assert.deepEqual([unknown.gpus, unknown.source, unknown.checked, unknown.suggestion, unknown.selected], [[], 'none', false, DEFAULT_CHOICE, null]);
  assert.match(unknown.error, /host: nvidia-smi was not found; docker: no space left on device/);
  await voice.install({ tts: 'chatterbox', asr: 'whisper', asrModel: 'small' });
  await settle();
  assert.equal(created().length, 1);
  assert.match(env(created()[0].body).VOICE_PLAN, /^No GPU could be read here; installing Chatterbox speech with Whisper small unchecked\.$/);
  // Before the image is there, the probe does not wait for it, and that is not an answer either.
  reset(); hostGpus(null); imageThere = false;
  const early = await voice.hardware();
  assert.match(early.error, /docker: the CUDA image is not downloaded yet/);
  assert.equal(early.checked, false);
});

test('no GPU for Docker is "no GPU", not an error, however Docker or the driver says so', async () => {
  const asked = { tts: 'breeze', asr: 'whisper', asrModel: 'base' } as const;
  const refused = async (why: string) => {
    const found = await voice.hardware();
    assert.deepEqual([found.gpus, found.checked, found.selected, found.suggestion], [[], true, null, DEFAULT_CHOICE], why);
    assert.doesNotMatch(JSON.stringify(found), /could not select device driver|nvidia-container|ECONN/, why);
    // An install is refused in one plain sentence, before a container is made, whether it names engines or leaves them to the check.
    for (const choice of [asked, undefined]) {
      await voice.install(choice);
      await settle();
      const state = await voice.status();
      assert.equal(state.error, NO_GPU_MESSAGE, why);
      assert.equal(state.state, 'absent', why);
    }
    assert.equal(created().length, 0, why);
    assert.ok(!calls.some(c => c.url.includes('probe-1') && c.method === 'DELETE') || calls.some(c => c.method === 'DELETE' && c.url.startsWith('/containers/probe-1')), why);
  };
  // Docker refuses the probe as it is made, or as it is started, which is where the daemon says it.
  reset(); hostGpus(null); dockerGpus = null;
  await refused('refused at create');
  reset(); hostGpus(null); dockerGpus = ''; noGpuRuntime = true;
  await refused('refused at start');
  assert.ok(calls.some(c => c.method === 'DELETE' && c.url.startsWith('/containers/probe-1')), 'the probe container is removed again');
  // The daemon does not answer at all.
  reset(); hostGpus(null); hangUp = true;
  await refused('no answer');
  // The driver is there and finds no device.
  reset(); process.env.NVIDIA_SMI = noDevices; dockerGpus = null;
  await refused('no devices');
});

test('a GPU that Docker cannot hand on is told in one plain sentence, not as the daemon words it', async () => {
  // The host sees a card, but Docker has no NVIDIA runtime: the container is made and cannot start.
  reset(); hostGpus(GPU(0, 12288, 11000)); noGpuRuntime = true;
  await voice.install();
  await settle();
  assert.equal(created().length, 1);
  const state = await voice.status();
  assert.equal(state.error, NO_GPU_MESSAGE);
  assert.doesNotMatch(JSON.stringify(state), /could not select device driver/);
  // A container that was made and exited with Docker's own words is shown the same way.
  reset(); hostGpus(GPU(0, 12288, 11000));
  container = { Config: { Labels: { 'pithagoras.addon': 'voice' } }, HostConfig: { NetworkMode: 'container:portal-one' }, State: { Running: false, ExitCode: 128, Error: `failed to create task for container: ${NO_RUNTIME}` } };
  await voice.stop();   // the install's own error is gone; what is left is what Docker says of the container
  container.State.Running = false;
  const failed = await voice.status();
  assert.equal(failed.state, 'failed');
  assert.equal(failed.error, NO_GPU_MESSAGE);
  // Anything else Docker says is left as it is.
  container.State.Error = 'port is already allocated';
  assert.equal((await voice.status()).error, 'port is already allocated');
});

test('a container made before engines could be chosen keeps its engines through start and through a restating of the same choice', async () => {
  reset(); hostGpus(GPU(0, 1024, 1000));   // far too small: a restart must not be refused on that
  container = { Config: { Labels: { 'pithagoras.addon': 'voice', 'pithagoras.voice-network': 'shared-v1' } }, HostConfig: { NetworkMode: 'container:portal-one' }, State: { Running: false } };
  assert.deepEqual((await voice.status()).choice, DEFAULT_CHOICE);
  await voice.start();
  await settle();
  assert.equal(container.State.Running, true);
  await voice.install(DEFAULT_CHOICE);
  await settle();
  assert.equal(calls.some(c => c.method === 'DELETE' || c.url.startsWith('/containers/create')), false, 'nothing recreated');
  assert.equal((await voice.status()).error, '');
  assert.deepEqual((await voice.status()).state, 'running');
});

test('a legacy container moved to a new network namespace is recreated as the original combination, without a GPU check', async () => {
  reset(); hostGpus(GPU(0, 1024, 1000));   // a card the original combination would be refused on
  container = { Config: { Labels: { 'pithagoras.addon': 'voice' } }, HostConfig: { NetworkMode: 'bridge' }, State: { Running: true } };
  assert.equal((await voice.status()).state, 'installing');
  await settle();
  assert.equal((await voice.status()).error, '');
  const spec = created()[0].body;
  assert.equal(spec.HostConfig.NetworkMode, 'container:portal-one');
  assert.equal(spec.Labels['pithagoras.voice-recipe'], 'breeze+whisper:base');
  assert.deepEqual(spec.HostConfig.DeviceRequests, [{ Driver: 'nvidia', Count: 1, Capabilities: [['gpu']] }]);
  assert.equal('VOICE_PLAN' in env(spec), false, 'no check was made, so there is nothing to report');
  assert.equal(calls.some(c => c.url === '/containers/create'), false);
});

test('a container recreated for a new portal namespace stays on the card it was given', async () => {
  reset(); hostGpus(GPU(0, 12288, 2000) + GPU(1, 12288, 12000));
  await voice.install({ tts: 'breeze', asr: 'whisper', asrModel: 'base' });
  await settle();
  assert.deepEqual(created()[0].body.HostConfig.DeviceRequests, [{ Driver: 'nvidia', DeviceIDs: ['1'], Capabilities: [['gpu']] }]);
  // A portal update gives the portal container a new id, and the voice container is made again for it.
  portalId = 'portal-two'; calls = [];
  assert.equal((await voice.status()).state, 'installing');
  await settle();
  assert.equal(created()[0].body.HostConfig.NetworkMode, 'container:portal-two');
  assert.deepEqual(created()[0].body.HostConfig.DeviceRequests, [{ Driver: 'nvidia', DeviceIDs: ['1'], Capabilities: [['gpu']] }]);
  assert.equal(created()[0].body.Labels['pithagoras.voice-recipe'], 'breeze+whisper:base');
  assert.equal(calls.some(c => c.url === '/containers/create'), false, 'a kept choice is not checked again');
});

test('VOICE_GPU decides the card of a recreated container, and of one installed without a GPU reading', async () => {
  reset(); hostGpus(GPU(0, 12288, 12000) + GPU(1, 12288, 3000));
  container = { Config: { Labels: { 'pithagoras.addon': 'voice' } }, HostConfig: { NetworkMode: 'bridge' }, State: { Running: true } };
  process.env.VOICE_GPU = '1';
  assert.equal((await voice.status()).state, 'installing');
  await settle();
  assert.deepEqual(created()[0].body.HostConfig.DeviceRequests, [{ Driver: 'nvidia', DeviceIDs: ['1'], Capabilities: [['gpu']] }]);
  reset(); hostGpus(null); probeError = 'no space left on device';
  process.env.VOICE_GPU = '1';
  await voice.install({ tts: 'chatterbox', asr: 'whisper', asrModel: 'base' });
  await settle();
  assert.deepEqual(created()[0].body.HostConfig.DeviceRequests, [{ Driver: 'nvidia', DeviceIDs: ['1'], Capabilities: [['gpu']] }]);
});

test('a VOICE_GPU that no card has is ignored when the cards can be read, at install and at recreation alike', async () => {
  reset(); hostGpus(GPU(0, 12288, 2000) + GPU(1, 12288, 12000));
  process.env.VOICE_GPU = '2';
  await voice.install({ tts: 'breeze', asr: 'whisper', asrModel: 'base' });
  await settle();
  const card = (spec: any) => spec.HostConfig.DeviceRequests[0];
  assert.deepEqual(card(created()[0].body).DeviceIDs, ['1'], 'the card with the most room');
  // A portal update: the container is made again, on the card it has, not on one that is not there.
  portalId = 'portal-two'; calls = [];
  assert.equal((await voice.status()).state, 'installing');
  await settle();
  assert.deepEqual(card(created()[0].body).DeviceIDs, ['1']);
  assert.equal((await voice.status()).error, '');
  // One card, and a setting that names a second: Docker's own pick, as an install makes it.
  reset(); hostGpus(GPU(0, 12288, 12000));
  container = { Config: { Labels: { 'pithagoras.addon': 'voice' } }, HostConfig: { NetworkMode: 'bridge' }, State: { Running: true } };
  process.env.VOICE_GPU = '1';
  assert.equal((await voice.status()).state, 'installing');
  await settle();
  assert.deepEqual(card(created()[0].body), { Driver: 'nvidia', Count: 1, Capabilities: [['gpu']] });
});

test('Start moves a container to the card VOICE_GPU names, and leaves one that is on it alone', async () => {
  const stopped = (devices: any) => ({ Config: { Labels: { 'pithagoras.addon': 'voice', 'pithagoras.voice-network': 'shared-v1', 'pithagoras.voice-recipe': 'breeze+whisper:base' } }, HostConfig: { NetworkMode: 'container:portal-one', DeviceRequests: [devices] }, State: { Running: false } });
  const cards = GPU(0, 12288, 12000) + GPU(1, 12288, 12000);
  reset(); hostGpus(cards);
  container = stopped({ Driver: 'nvidia', DeviceIDs: ['0'], Capabilities: [['gpu']] });
  process.env.VOICE_GPU = '1';
  await voice.start();
  await settle();
  assert.deepEqual(created()[0].body.HostConfig.DeviceRequests[0].DeviceIDs, ['1']);
  assert.equal(container.Config.Labels['pithagoras.voice-recipe'], 'breeze+whisper:base');
  // Already there: started as it is. So is one that asked Docker for any one GPU, which is the first.
  for (const [devices, asked] of [[{ Driver: 'nvidia', DeviceIDs: ['1'], Capabilities: [['gpu']] }, '1'], [{ Driver: 'nvidia', Count: 1, Capabilities: [['gpu']] }, '0']] as const) {
    reset(); hostGpus(cards);
    container = stopped(devices);
    process.env.VOICE_GPU = asked;
    await voice.start();
    await settle();
    assert.equal(calls.some(c => c.method === 'DELETE' || c.url.startsWith('/containers/create?')), false, `on card ${asked} already`);
    assert.equal(container.State.Running, true);
  }
  // No setting: whatever card it has is kept.
  reset(); hostGpus(cards);
  container = stopped({ Driver: 'nvidia', DeviceIDs: ['1'], Capabilities: [['gpu']] });
  await voice.start();
  await settle();
  assert.equal(calls.some(c => c.method === 'DELETE'), false);
});

test('the page is told the card the installed service is on, not the one with the most room', async () => {
  const cards = GPU(0, 6144, 6000) + GPU(1, 12288, 5000);
  reset(); hostGpus(cards);
  assert.equal((await voice.hardware()).selected, 0, 'nothing installed: the card with the most room');
  container = { Config: { Labels: { 'pithagoras.addon': 'voice', 'pithagoras.voice-recipe': 'breeze+qwen3-asr:1.7b' } }, HostConfig: { DeviceRequests: [{ Driver: 'nvidia', DeviceIDs: ['1'], Capabilities: [['gpu']] }] }, State: { Running: true } };
  assert.equal((await voice.hardware()).selected, 1, 'the service holds memory there, which is why it has less free');
  // One made before the card was chosen has Docker's first.
  container = { Config: { Labels: { 'pithagoras.addon': 'voice' } }, HostConfig: { DeviceRequests: [{ Driver: 'nvidia', Count: 1, Capabilities: [['gpu']] }] }, State: { Running: true } };
  hostGpus(GPU(0, 6144, 1000) + GPU(1, 12288, 12000));
  assert.equal((await voice.hardware()).selected, 0);
  container = null;
  process.env.VOICE_GPU = '0';
  assert.equal((await voice.hardware()).selected, 0, 'VOICE_GPU for a first install');
});

test('a rebuild reads the GPU after the running service is stopped, and starts it again when the choice is refused', async () => {
  reset(); hostGpus(null); dockerGpus = GPU(0, 6144, 6000);
  const running = () => ({ Config: { Labels: { 'pithagoras.addon': 'voice', 'pithagoras.voice-network': 'shared-v1', 'pithagoras.voice-recipe': 'breeze+whisper:base' } }, HostConfig: { NetworkMode: 'container:portal-one' }, State: { Running: true } });
  container = running();
  await voice.install({ tts: 'breeze', asr: 'qwen3-asr', asrModel: '1.7b' });
  await settle();
  const at = (test: (c: { url: string }) => boolean) => calls.findIndex(test);
  assert.ok(at(c => c.url.includes('/stop?')) >= 0 && at(c => c.url.includes('/stop?')) < at(c => c.url === '/containers/create'), 'its own memory is not counted as taken by others');
  assert.match((await voice.status()).error, /needs about 7\.0 GiB/);
  assert.equal(container.State.Running, true, 'the refusal leaves the service running');
  assert.equal(calls.some(c => c.method === 'DELETE' && c.url === '/containers/pithagoras-voice'), false);
  assert.equal(calls.filter(c => c.url === '/containers/pithagoras-voice/start').length, 1);
  // A choice that fits is stopped once, probed, and replaced.
  calls = []; container = running();
  await voice.install({ tts: 'breeze', asr: 'qwen3-asr', asrModel: '0.6b' });
  await settle();
  assert.equal(calls.filter(c => c.url.includes('/stop?')).length, 1);
  assert.ok(at(c => c.url.includes('/stop?')) < at(c => c.url === '/containers/create'));
  assert.equal(created()[0].body.Labels['pithagoras.voice-recipe'], 'breeze+qwen3-asr:0.6b');
});

test('another choice recreates the container, keeps the volume and is not mistaken for a network change', async () => {
  reset(); hostGpus(GPU(0, 12288, 11000));
  container = { Config: { Labels: { 'pithagoras.addon': 'voice', 'pithagoras.voice-network': 'shared-v1' } }, HostConfig: { NetworkMode: 'container:portal-one' }, State: { Running: true } };
  await voice.install({ tts: 'chatterbox', asr: 'qwen3-asr', asrModel: '1.7b' });
  await settle();
  assert.ok(calls.some(c => c.method === 'DELETE' && c.url === '/containers/pithagoras-voice'));
  assert.ok(calls.some(c => c.url.includes('/stop?')));
  assert.equal(calls.some(c => c.url.startsWith('/volumes') && c.method === 'DELETE'), false);
  assert.deepEqual(created()[0].body.HostConfig.Binds, ['pithagoras_voice-models:/voice']);
  assert.equal(container.Config.Labels['pithagoras.voice-recipe'], 'chatterbox+qwen3-asr:1.7b');
  // Start now keeps what was built.
  calls = [];
  await voice.start();
  await settle();
  assert.equal(calls.some(c => c.method === 'DELETE'), false);
  assert.equal(container.Config.Labels['pithagoras.voice-recipe'], 'chatterbox+qwen3-asr:1.7b');
});

test('a request for an engine the installer does not make is refused before anything happens', async () => {
  reset(); hostGpus(GPU(0, 12288, 11000));
  await assert.rejects(voice.install({ tts: 'kokoro', asr: 'whisper', asrModel: 'base' } as any), /speech synthesis engine/);
  await assert.rejects(voice.install({ tts: 'breeze', asr: 'whisper', asrModel: '1.7b' }), /speech recognition model/);
  assert.equal((await voice.status()).busy, false, 'the refusal does not leave a setup running');
  assert.equal(calls.some(c => c.url.startsWith('/containers/create')), false);
});

test('the container spec of the original combination is the one it always was', () => {
  const spec = voice.containerSpec('echo test', 'host');
  assert.deepEqual(spec.HostConfig.DeviceRequests, [{ Driver: 'nvidia', Count: 1, Capabilities: [['gpu']] }]);
  assert.deepEqual(spec.HostConfig.Binds, ['pithagoras_voice-models:/voice']);
  assert.equal(spec.Labels['pithagoras.voice-network'], 'shared-v1');
  assert.equal(spec.Labels['pithagoras.voice-recipe'], 'breeze+whisper:base');
  assert.deepEqual(spec.Cmd, ['bash', '-c', 'echo test']);
  assert.deepEqual(env(spec).VOICE_TTS + env(spec).VOICE_ASR + env(spec).VOICE_ASR_MODEL, 'breezewhisperbase');
  assert.equal('VOICE_PLAN' in env(spec), false);
});

test('the model the lease loads is the one the saved engine speaks with', async () => {
  reset();
  const sent: { url: string; body: any }[] = [];
  globalThis.fetch = (async (url: any, init: any) => { sent.push({ url: String(url), body: JSON.parse(init.body) }); return new Response('{}'); }) as typeof fetch;
  await voice.modelAction('load');
  await voice.modelAction('unload');
  await voice.modelAction('load', 'chatterbox');
  await voice.modelAction('unload', 'chatterbox');
  assert.deepEqual(sent.map(s => s.url), Array(4).fill('http://127.0.0.1:7862/v1/models/load').map((u, i) => u.replace('load', i % 2 ? 'unload' : 'load')));
  // The load request Breeze has always had, byte for byte.
  assert.deepEqual(sent[0].body, { id: 'breeze', family: 'breeze_tts', path: '/voice/models/breeze-q8_0.gguf', task: 'tts', mode: 'streaming', session_options: { 'breeze_tts.reference_cache_slots': '1' } });
  assert.deepEqual(sent[1].body, { id: 'breeze' });
  assert.equal(sent[2].body.id, 'chatterbox');
  assert.equal(sent[2].body.path, '/voice/models/chatterbox-q8_0.gguf');
  assert.deepEqual(sent[3].body, { id: 'chatterbox' });
});
