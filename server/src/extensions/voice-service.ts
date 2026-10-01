import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { containerState, dockerAvailable, imagePresent, pullImage, request } from './docker.js';
import { choiceFromKey, choiceKey, DEFAULT_CHOICE, healthUrls, parseChoice, pickGpu, sameChoice, serverConfig, SPEECH_PORT, speechUrl, suggestChoice, ttsModel, whisperUrl as managedWhisperUrl, type TtsEngine, type VoiceChoice } from '../voice-engines.js';
import { decide, detectGpus, hostProbe, SMI_ARGS, type Detected, type Probe } from '../voice-gpu.js';

export const CONTAINER = 'pithagoras-voice';
export const IMAGE = 'nvidia/cuda:12.4.1-devel-ubuntu22.04';
const VOLUME = 'pithagoras_voice-models';
export const whisperUrl = managedWhisperUrl;
export const breezeUrl = speechUrl;
let pending = false;
let progress = '';
let error = '';
async function checked<T = unknown>(method: string, path: string, body?: unknown) {
  const result = await request<T & { message?: string }>(method, path, body);
  if (result.status >= 400) throw new Error(result.body?.message || `Docker returned ${result.status}`);
  return result;
}
async function healthy(url: string) {
  try { return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
}
export interface ServiceStatus { available: boolean; state: string; busy: boolean; progress: string; error: string; /** The engines the managed container is built for, once there is one. */ choice?: VoiceChoice }
export async function status(): Promise<ServiceStatus> {
  if (!dockerAvailable()) return { available: false, state: 'unavailable', busy: false, progress: '', error: 'Automatic voice setup requires Docker with NVIDIA GPU support.' };
  const state = await containerState(CONTAINER);
  if (state.running && !pending) {
    const detail = await request<{Config?: {Labels?: Record<string,string>}; HostConfig?: {NetworkMode?: string}}>('GET', `/containers/${CONTAINER}/json`);
    if (detail.body?.Config?.Labels?.['pithagoras.addon'] === 'voice') {
      const target = await voiceNetworkMode();
      if (detail.body.Config.Labels['pithagoras.voice-network'] !== 'shared-v1' || detail.body.HostConfig?.NetworkMode !== target) {
        await install();
        return {available:true, state:'installing', busy:true, progress:'Updating managed voice networking; keeping downloaded models', error:''};
      }
    }
  }
  let logs = '';
  if (state.exists) {
    // Tty=true in the container spec makes logs plain text, without Docker multiplex frames.
    const result = await request<string>('GET', `/containers/${CONTAINER}/logs?stdout=1&stderr=1&tail=25`);
    if (result.status === 200) logs = String(result.body ?? '').replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').slice(-6000);
  }
  const detail = state.exists ? await request<{ Config?: { Labels?: Record<string, string> }; State?: { ExitCode?: number; Error?: string } }>('GET', `/containers/${CONTAINER}/json`) : null;
  // A container made before engines could be chosen has no recipe label, and is the original combination.
  const labels = detail?.body?.Config?.Labels;
  const choice = labels?.['pithagoras.addon'] === 'voice' ? choiceFromKey(labels['pithagoras.voice-recipe']) : undefined;
  const ready = state.running && (await Promise.all(healthUrls(choice ?? DEFAULT_CHOICE).map(healthy))).every(Boolean);
  const failed = !state.running && Boolean(detail?.body?.State?.ExitCode);
  return { available: true, state: pending ? 'installing' : ready ? 'running' : state.running ? 'starting' : failed ? 'failed' : state.exists ? 'stopped' : 'absent', busy: pending, progress: pending ? progress : logs, error: error || (failed ? detail?.body?.State?.Error || 'Voice setup or service exited. Review the log, then retry.' : ''), choice };
}
/** Share loopback with the portal; no published host ports or gateway lookup. */
export async function voiceNetworkMode(): Promise<string> {
  if (!existsSync('/.dockerenv') && !process.env.PORTAL_CONTAINER_NAME) {
    if (process.platform !== 'linux') throw new Error('Native managed voice requires Linux. Run the portal in Docker on this platform.');
    return 'host';
  }
  const name = process.env.PORTAL_CONTAINER_NAME || process.env.HOSTNAME;
  if (!name) throw new Error('Set PORTAL_CONTAINER_NAME to the portal Docker container name.');
  const detail = await request<{Id?: string; State?: {Running?: boolean}}>('GET', `/containers/${encodeURIComponent(name)}/json`);
  if (detail.status !== 200 || !detail.body?.Id || !detail.body.State?.Running) {
    throw new Error('Cannot identify the running portal container. Set PORTAL_CONTAINER_NAME to its Docker name.');
  }
  return `container:${detail.body.Id}`;
}
/**
 * `plan.gpuIndex` names the card when the host has several; without it Docker gives
 * the container one, as it always has. `plan.note` is what the check found, and
 * the script prints it as the first line of the setup log.
 */
export function containerSpec(script: string, networkMode: string, choice: VoiceChoice = DEFAULT_CHOICE, plan: { gpuIndex?: number; note?: string } = {}) {
  const gpu = plan.gpuIndex === undefined ? { Count: 1 } : { DeviceIDs: [String(plan.gpuIndex)] };
  return { Image: IMAGE, Tty: true, Cmd: ['bash', '-c', script],
    Env: [`VOICE_TTS=${choice.tts}`, `VOICE_ASR=${choice.asr}`, `VOICE_ASR_MODEL=${choice.asrModel}`, `VOICE_SERVER_CONFIG=${JSON.stringify(serverConfig(choice))}`, ...(plan.note ? [`VOICE_PLAN=${plan.note}`] : [])],
    Labels: { 'pithagoras.addon': 'voice', 'pithagoras.voice-network': 'shared-v1', 'pithagoras.voice-recipe': choiceKey(choice) },
    HostConfig: { Binds: [`${VOLUME}:/voice`], NetworkMode: networkMode,
      DeviceRequests: [{ Driver: 'nvidia', ...gpu, Capabilities: [['gpu']] }],
      RestartPolicy: { Name: 'no' }, LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '2' } } } };
}
/** The card a container was given by index. One made before the card was chosen asked Docker for any one GPU, and has no ids. */
const deviceIndex = (requests?: { DeviceIDs?: string[] | null }[] | null) => {
  const id = requests?.flatMap(r => r.DeviceIDs ?? [])[0];
  return id !== undefined && /^\d+$/.test(id) ? Number(id) : undefined;
};
async function ensureContainer(script: string, choice: VoiceChoice, plan: { gpuIndex?: number; note?: string }) {
  const networkMode = await voiceNetworkMode();
  const existing = await request<{Config?: {Labels?: Record<string,string>}; HostConfig?: {NetworkMode?: string; DeviceRequests?: { DeviceIDs?: string[] | null }[] | null}; State?: {Running?: boolean}}>('GET', `/containers/${CONTAINER}/json`);
  if (existing.status !== 404) {
    if (existing.status >= 400) throw new Error(`Cannot inspect voice container: Docker ${existing.status}`);
    if (existing.body.Config?.Labels?.['pithagoras.addon'] !== 'voice') throw new Error('The pithagoras-voice container is not a managed voice add-on. Rename it before installing.');
    const labels = existing.body.Config.Labels;
    // A card that is asked for and is not the one it has makes it another container, so that Start moves it. Docker's any-one-GPU is the first.
    const onCard = plan.gpuIndex === undefined || plan.gpuIndex === (deviceIndex(existing.body.HostConfig?.DeviceRequests) ?? 0);
    const current = labels['pithagoras.voice-network'] === 'shared-v1' && existing.body.HostConfig?.NetworkMode === networkMode && sameChoice(choiceFromKey(labels['pithagoras.voice-recipe']), choice) && onCard;
    if (current) { await checked('POST', `/containers/${CONTAINER}/start`); return; }
    // Container config is immutable. Retain /voice and the cached model/build
    // files while replacing the old published-port container, a stale namespace
    // or one built for other engines.
    if (existing.body.State?.Running) await checked('POST', `/containers/${CONTAINER}/stop?t=10`);
    await checked('DELETE', `/containers/${CONTAINER}`);
  }
  await checked('POST', '/volumes/create', { Name: VOLUME });
  await checked('POST', `/containers/create?name=${CONTAINER}`, containerSpec(script, networkMode, choice, plan));
  await checked('POST', `/containers/${CONTAINER}/start`);
}

/** The managed container as far as a recreation has to keep it: its engines and the card it was given. None when there is no managed container. */
async function installedContainer(): Promise<{ choice: VoiceChoice; gpuIndex?: number; running: boolean } | undefined> {
  const found = await request<{Config?: {Labels?: Record<string,string>}; HostConfig?: {DeviceRequests?: {DeviceIDs?: string[] | null}[] | null}; State?: {Running?: boolean}}>('GET', `/containers/${CONTAINER}/json`);
  const labels = found.status === 200 ? found.body?.Config?.Labels : undefined;
  if (labels?.['pithagoras.addon'] !== 'voice') return undefined;
  return { choice: choiceFromKey(labels['pithagoras.voice-recipe']), gpuIndex: deviceIndex(found.body.HostConfig?.DeviceRequests), running: Boolean(found.body.State?.Running) };
}

/**
 * nvidia-smi inside a short-lived container of the CUDA image, for a portal that runs in
 * a container itself and has no GPU tool. It never pulls the image: before the install
 * has, there is nothing to ask, and the install asks again once it has.
 */
const dockerProbe: Probe = {
  name: 'docker',
  async run() {
    if (!dockerAvailable()) throw new Error('Docker is unavailable');
    if (!(await imagePresent(IMAGE))) throw new Error('the CUDA image is not downloaded yet');
    const created = await checked<{ Id: string }>('POST', '/containers/create', { Image: IMAGE, Tty: true, Cmd: ['nvidia-smi', ...SMI_ARGS],
      Labels: { 'pithagoras.addon': 'voice-probe' }, HostConfig: { DeviceRequests: [{ Driver: 'nvidia', Count: -1, Capabilities: [['gpu']] }] } });
    const id = created.body.Id;
    try {
      await checked('POST', `/containers/${id}/start`);
      const done = await request<{ StatusCode?: number }>('POST', `/containers/${id}/wait`, undefined, 30000);
      const logs = await request<string>('GET', `/containers/${id}/logs?stdout=1&stderr=1`);
      const text = String(logs.body ?? '');
      if (done.body?.StatusCode) throw new Error(text.trim().split('\n').at(-1) || 'nvidia-smi failed');
      return text;
    } finally { await request('DELETE', `/containers/${id}?force=1`).catch(() => {}); }
  },
};
let probing: Promise<Detected> | undefined;
/** One probe at a time: the page asks as it opens, and an install asks too. */
function detect(): Promise<Detected> {
  probing ??= detectGpus([hostProbe, dockerProbe]).finally(() => { probing = undefined; });
  return probing;
}
/** `VOICE_GPU` picks the card, as it does for the Compose service; `VOICE_VRAM_RESERVE_MIB` keeps memory on it free for something else. */
const preferredGpu = () => /^\d+$/.test(process.env.VOICE_GPU ?? '') ? Number(process.env.VOICE_GPU) : undefined;
const reserveMiB = () => { const n = Math.round(Number(process.env.VOICE_VRAM_RESERVE_MIB)); return n > 0 ? n : 0; };

/**
 * What the GPU check finds, and what it would suggest, for the page to show before anything is installed.
 * With a container, the card shown is the one it is on and not the one with the most room: the memory
 * the service holds is what makes its own card look full.
 */
export async function hardware() {
  // No Docker, or one that does not answer, is no container: the GPUs can still be read from the host.
  const existing = dockerAvailable() ? await installedContainer().catch(() => undefined) : undefined;
  const found = await detect();
  const reserve = reserveMiB();
  const gpu = pickGpu(found.gpus, existing ? existing.gpuIndex ?? 0 : preferredGpu());
  return { ...found, selected: gpu?.index ?? null, reserveMiB: reserve, suggestion: suggestChoice(gpu, reserve) };
}

/**
 * Installs the managed container, or starts it. `requested` is the engines to run: a new
 * installation without it takes what the GPU check suggests, and an existing container
 * without it keeps the engines it has. A different choice recreates the container; the
 * downloads and builds in the volume stay.
 */
export async function install(requested?: VoiceChoice) {
  if (pending) throw new Error('Voice setup is already in progress');
  if (!dockerAvailable()) throw new Error('Docker is unavailable');
  const wanted = requested && parseChoice(requested);
  pending = true; error = ''; progress = 'Preparing voice setup';
  // Read before returning so a packaging error is reported immediately.
  let script: string;
  try { script = await readFile(new URL('../../../deploy/voice/setup.sh', import.meta.url), 'utf8'); }
  catch (e) { pending = false; throw e; }
  void (async () => {
    try {
      if (!(await imagePresent(IMAGE))) await pullImage(IMAGE, line => { progress = line; });
      const existing = await installedContainer();
      let choice = wanted ?? existing?.choice;
      // Recreated with the engines it has, the container stays on the card it was given.
      let plan: { gpuIndex?: number; note?: string } = { gpuIndex: existing?.gpuIndex };
      // An installed choice that is kept ran before this check existed, and a restart must not be refused for it.
      if (!existing || (wanted && !sameChoice(wanted, existing.choice))) {
        // The running container is about to be replaced. Left up, the memory it holds would count as used by other programs,
        // and the card with the most room could be another one than its own.
        const stopped = existing?.running;
        if (stopped) await checked('POST', `/containers/${CONTAINER}/stop?t=10`);
        try {
          progress = 'Checking the GPU';
          const found = await detect();
          const decision = decide(wanted, found.gpus, { reserveMiB: reserveMiB(), preferredGpu: preferredGpu() });
          choice = decision.choice;
          // With one card Docker's own pick is the card; only a choice among several needs naming.
          plan = { gpuIndex: found.gpus.length > 1 ? decision.gpu?.index : found.gpus.length ? undefined : preferredGpu(), note: decision.summary };
          progress = decision.summary;
        } catch (e) {
          // Refused: the service that was running goes on running.
          if (stopped) await request('POST', `/containers/${CONTAINER}/start`).catch(() => {});
          throw e;
        }
      } else if (preferredGpu() !== undefined) {
        // A kept choice is not checked against the card, but `VOICE_GPU` has to name one that is there, as an install insists.
        // Where no GPU can be read it is taken as it is, as an install does.
        const asked = preferredGpu()!;
        const { gpus } = await detect();
        if (!gpus.length || gpus.some(g => g.index === asked)) plan = { gpuIndex: asked };
      }
      await ensureContainer(script, choice ?? DEFAULT_CHOICE, plan);
    } catch (e) { error = (e as Error).message; }
    finally { pending = false; }
  })();
}
export async function start() {
  await install();
}
export async function stop() {
  if (pending) throw new Error('Wait for the image download to finish before stopping');
  await checked('POST', `/containers/${CONTAINER}/stop?t=10`);
  error = '';
}

export async function modelAction(action:'load'|'unload', engine: TtsEngine = 'breeze') {
  const model = ttsModel(engine);
  const response=await fetch(`http://127.0.0.1:${SPEECH_PORT}/v1/models/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(action==='load'?model:{id:model.id}),signal:AbortSignal.timeout(120000)});
  if(!response.ok)throw new Error(`Voice model ${action} failed (${response.status}): ${(await response.text()).slice(0,300)}`);
}
