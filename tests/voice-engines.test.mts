import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ASR_MODELS, DEFAULT_CHOICE, LEAN_CHOICE, TTS_ENGINES, choiceFromKey, choiceKey, endpoints, fitOn, healthUrls, parseChoice, pickGpu, serverConfig, suggestChoice, ttsModel, vramNeeded,
  type Gpu, type VoiceChoice,
} from '../server/src/voice-engines.js';
import { NO_GPU_MESSAGE, NoGpu, decide, detectGpus, explain, isNoGpu, parseGpus, type Probe } from '../server/src/voice-gpu.js';

// Neutral cards: only the sizes matter.
const card = (totalMiB: number | null, freeMiB: number | null = totalMiB, index = 0): Gpu => ({ index, name: `Test GPU ${index}`, totalMiB, freeMiB });
const combos: VoiceChoice[] = (Object.keys(TTS_ENGINES) as VoiceChoice['tts'][]).flatMap(tts => ASR_MODELS.map(o => ({ tts, asr: o.asr, asrModel: o.model })));

test('nvidia-smi output is read as one GPU per line, and what does not fit the shape is skipped', () => {
  assert.deepEqual(parseGpus('0, Test GPU A, 12288, 11000\n1, Test GPU B, 8192, 8000\n'), [
    { index: 0, name: 'Test GPU A', totalMiB: 12288, freeMiB: 11000 },
    { index: 1, name: 'Test GPU B', totalMiB: 8192, freeMiB: 8000 },
  ]);
  // A terminal's line ends, a name with a comma in it, a card that reports no memory.
  assert.deepEqual(parseGpus('0, Test GPU, Rev 2, 4096, 100\r\n1, Shared GPU, [N/A], [N/A]\r\n'), [
    { index: 0, name: 'Test GPU, Rev 2', totalMiB: 4096, freeMiB: 100 },
    { index: 1, name: 'Shared GPU', totalMiB: null, freeMiB: null },
  ]);
  assert.deepEqual(parseGpus('NVIDIA-SMI has failed because it could not communicate with the driver\nNo devices were found'), []);
  assert.deepEqual(parseGpus(''), []);
});

test('the first probe that finds a GPU wins, and no GPU and no tool are answers, not failures', async () => {
  const fails: Probe = { name: 'host', run: async () => { throw new Error('nvidia-smi was not found'); } };
  const empty: Probe = { name: 'empty', run: async () => '\n' };
  const works: Probe = { name: 'docker', run: async () => '0, Test GPU A, 12288, 11000\n' };
  const found = await detectGpus([fails, works]);
  assert.deepEqual([found.source, found.checked, found.gpus[0].totalMiB], ['docker', true, 12288]);
  // A probe that ran and listed nothing found that there is none.
  const none = await detectGpus([fails, empty]);
  assert.deepEqual([none.gpus, none.source, none.checked], [[], 'none', true]);
  assert.match(none.error, /host: nvidia-smi was not found; empty: no GPU listed/);
  // Not being able to ask is not an answer: the tool is missing, or the image the probe needs is not there yet.
  const unknown = await detectGpus([fails, { name: 'docker', run: async () => { throw new Error('the CUDA image is not downloaded yet'); } }]);
  assert.deepEqual([unknown.gpus, unknown.checked], [[], false]);
  assert.deepEqual(await detectGpus([]), { gpus: [], source: 'none', error: '', checked: false });
});

test('Docker and the driver saying there is no GPU is "no GPU", in whatever words they use', async () => {
  const says = (message: string): Probe => ({ name: 'docker', run: async () => { throw new Error(message); } });
  for (const message of [
    'could not select device driver "nvidia" with capabilities: [[gpu]]',
    'failed to create task for container: OCI runtime create failed: nvidia-container-cli: initialization error: nvml error: driver not loaded',
    "Command failed: nvidia-smi --query-gpu=index\nNVIDIA-SMI has failed because it couldn't communicate with the NVIDIA driver. Make sure that the latest NVIDIA driver is installed and running.",
    'No devices were found',
    'unknown or invalid runtime name: nvidia',
  ]) {
    assert.equal(isNoGpu(message), true, message);
    const found = await detectGpus([says(message)]);
    assert.deepEqual([found.gpus, found.checked, found.error], [[], true, 'docker: no GPU available'], message);
    // The person reads one sentence about what is missing and what to do, not the daemon's words.
    assert.equal(explain(message), NO_GPU_MESSAGE);
  }
  assert.match(NO_GPU_MESSAGE, /NVIDIA Container Toolkit.*restart Docker/);
  // A probe can say it outright, as when Docker does not answer.
  assert.equal((await detectGpus([{ name: 'docker', run: async () => { throw new NoGpu('Docker did not answer'); } }])).checked, true);
  // Anything else is left as it is, and is not an answer.
  for (const message of ['no space left on device', 'port is already allocated']) {
    assert.equal(isNoGpu(message), false);
    assert.equal(explain(message), message);
    assert.deepEqual([(await detectGpus([says(message)])).checked, (await detectGpus([says(message)])).error], [false, `docker: ${message}`]);
  }
});

test('a choice fits when the GPU has room now, is tight when only the card is big enough, and is too large otherwise', () => {
  const need = vramNeeded(DEFAULT_CHOICE);
  assert.equal(need, TTS_ENGINES.breeze.vramMiB, 'Whisper runs on the CPU and takes no GPU memory');
  assert.equal(fitOn(DEFAULT_CHOICE, card(need)), 'fits');
  assert.equal(fitOn(DEFAULT_CHOICE, card(need * 2, need - 1)), 'tight');
  assert.equal(fitOn(DEFAULT_CHOICE, card(need - 1)), 'too-large');
  // Memory kept free for something else counts against the card.
  assert.equal(fitOn(DEFAULT_CHOICE, card(need + 999), 1000), 'too-large');
  assert.equal(fitOn(DEFAULT_CHOICE, card(need + 1000), 1000), 'fits');
  assert.equal(fitOn(DEFAULT_CHOICE, undefined), 'unknown');
  assert.equal(fitOn(DEFAULT_CHOICE, card(null)), 'unknown');
  assert.ok(vramNeeded({ tts: 'chatterbox', asr: 'qwen3-asr', asrModel: '1.7b' }) > vramNeeded({ tts: 'chatterbox', asr: 'qwen3-asr', asrModel: '0.6b' }));
});

test('the suggestion is the best combination that fits, and the original one when nothing can be said', () => {
  const at = (mib: number, reserve = 0) => suggestChoice(card(mib), reserve);
  assert.deepEqual(at(24576), { tts: 'breeze', asr: 'qwen3-asr', asrModel: '1.7b' });
  assert.deepEqual(at(vramNeeded({ tts: 'breeze', asr: 'qwen3-asr', asrModel: '0.6b' })), { tts: 'breeze', asr: 'qwen3-asr', asrModel: '0.6b' });
  // Whisper small is offered but never suggested: it only costs speed.
  assert.deepEqual(at(TTS_ENGINES.breeze.vramMiB), DEFAULT_CHOICE);
  // Breeze does not fit, Chatterbox does.
  assert.deepEqual(at(TTS_ENGINES.chatterbox.vramMiB), { tts: 'chatterbox', asr: 'whisper', asrModel: 'base' });
  // Room is kept for a model that comes later.
  assert.deepEqual(at(24576, 24576 - vramNeeded(DEFAULT_CHOICE)), DEFAULT_CHOICE);
  // Free memory is busy now but the card holds the original combination: do not change it for that.
  assert.deepEqual(suggestChoice(card(12288, 1000)), DEFAULT_CHOICE);
  // Not even the leanest fits: nothing better to name.
  assert.deepEqual(at(1024), DEFAULT_CHOICE);
  assert.deepEqual(suggestChoice(undefined), DEFAULT_CHOICE);
  assert.deepEqual(suggestChoice(card(null)), DEFAULT_CHOICE);
});

test('the leanest choice is the one that needs the least GPU memory of all that are offered', () => {
  assert.equal(vramNeeded(LEAN_CHOICE), Math.min(...combos.map(vramNeeded)));
  // The suggestion falls back to it when the card is too small for the original combination but holds this one.
  assert.deepEqual(suggestChoice(card(vramNeeded(LEAN_CHOICE), 10)), LEAN_CHOICE);
});

test('the GPU is the one asked for, else the one with the most memory free', () => {
  const gpus = [card(8192, 1000, 0), card(12288, 11000, 1), card(24576, 2000, 2)];
  assert.equal(pickGpu(gpus)?.index, 1);
  assert.equal(pickGpu(gpus, 2)?.index, 2);
  assert.equal(pickGpu(gpus, 7)?.index, 1, 'a card that is not there is not an error');
  assert.equal(pickGpu([]), undefined);
});

test('a choice is checked and keyed so a container label names it exactly', () => {
  for (const c of combos) {
    assert.deepEqual(parseChoice(c), c);
    assert.deepEqual(choiceFromKey(choiceKey(c)), c);
  }
  assert.equal(combos.length, 8);
  assert.equal(choiceKey(DEFAULT_CHOICE), 'breeze+whisper:base');
  // A container from before engines could be chosen has no label.
  assert.deepEqual(choiceFromKey(undefined), DEFAULT_CHOICE);
  assert.deepEqual(choiceFromKey('nonsense'), DEFAULT_CHOICE);
  assert.deepEqual(choiceFromKey('breeze+whisper:gigantic'), DEFAULT_CHOICE);
  assert.throws(() => parseChoice({ tts: 'kokoro', asr: 'whisper', asrModel: 'base' }), /speech synthesis engine/);
  assert.throws(() => parseChoice({ tts: 'breeze', asr: 'whisper', asrModel: '1.7b' }), /speech recognition model/);
  assert.throws(() => parseChoice({ tts: 'breeze', asr: 'qwen3-asr' }), /speech recognition model/);
  assert.throws(() => parseChoice({ tts: 'toString', asr: 'whisper', asrModel: 'base' }), /speech synthesis engine/);
  assert.throws(() => parseChoice(null), /Choose/);
});

test('the original combination makes the server config the setup script has always written', () => {
  const script = readFileSync('deploy/voice/setup.sh', 'utf8');
  const legacy = /<<'JSON'\n(.*)\nJSON\n/.exec(script)![1];
  assert.equal(JSON.stringify(serverConfig(DEFAULT_CHOICE)), legacy);
  assert.deepEqual(endpoints(DEFAULT_CHOICE), { runtime: 'audio-cpp', breezeUrl: 'http://127.0.0.1:7862/v1/audio/speech', whisperUrl: 'http://127.0.0.1:8188/inference', sttModel: '' });
  assert.deepEqual(healthUrls(DEFAULT_CHOICE), ['http://127.0.0.1:8188/health', 'http://127.0.0.1:7862/health']);
});

test('Chatterbox and Qwen3-ASR run in the one audio.cpp process, loaded together, and Whisper then has no process', () => {
  const config = serverConfig({ tts: 'chatterbox', asr: 'qwen3-asr', asrModel: '0.6b' });
  assert.equal(config.max_loaded_models, 2);
  assert.deepEqual(config.models.map(m => m.id), ['chatterbox', 'qwen3-asr']);
  assert.deepEqual(config.models.map(m => m.path), ['/voice/models/chatterbox-q8_0.gguf', '/voice/models/qwen3-asr-0.6b-q8_0.gguf']);
  // audio.cpp's own name for voice cloning.
  assert.equal(config.models[0].task, 'clon');
  assert.equal(serverConfig({ tts: 'breeze', asr: 'qwen3-asr', asrModel: '1.7b' }).models[1].path, '/voice/models/qwen3-asr-1.7b-q8_0.gguf');
  // A choice with Whisper has one audio.cpp model, so one is loaded at a time, as before.
  assert.equal(serverConfig({ tts: 'chatterbox', asr: 'whisper', asrModel: 'small' }).max_loaded_models, 1);
  assert.deepEqual(endpoints({ tts: 'chatterbox', asr: 'qwen3-asr', asrModel: '1.7b' }), {
    runtime: 'chatterbox', breezeUrl: 'http://127.0.0.1:7862/v1/audio/speech', whisperUrl: 'http://127.0.0.1:7862/v1/audio/transcriptions', sttModel: 'qwen3-asr',
  });
  assert.deepEqual(healthUrls({ tts: 'breeze', asr: 'qwen3-asr', asrModel: '0.6b' }), ['http://127.0.0.1:7862/health']);
  // The load request and the server config describe a model the same way.
  assert.deepEqual(ttsModel('chatterbox'), config.models[0]);
});

test('what the install decides tells the person what fits and what does not', () => {
  const twelve = [card(12288, 11000)];
  const auto = decide(undefined, twelve);
  assert.deepEqual(auto.choice, { tts: 'breeze', asr: 'qwen3-asr', asrModel: '1.7b' });
  assert.match(auto.summary, /Detected Test GPU 0 \(12\.0 GiB, 10\.7 GiB free\): Breeze speech with Qwen3-ASR 1\.7B needs about 7\.0 GiB, which fits/);
  const busy = decide({ tts: 'breeze', asr: 'qwen3-asr', asrModel: '1.7b' }, [card(12288, 4000)]);
  assert.match(busy.summary, /big enough, but other programs use part of it now/);
  // Too large for the card: refused, with the combination that would fit.
  assert.throws(() => decide({ tts: 'breeze', asr: 'qwen3-asr', asrModel: '1.7b' }, [card(6144)]),
    /Breeze speech with Qwen3-ASR 1\.7B needs about 7\.0 GiB of GPU memory, but Test GPU 0 \(6\.0 GiB, 6\.0 GiB free\) has less\. Breeze speech with Qwen3-ASR 0\.6B would fit\./);
  // The smallest is named as what it is, not as the original combination.
  assert.throws(() => decide(undefined, [{ index: 0, name: 'Small GPU', totalMiB: 2048, freeMiB: 2000 }]),
    /^Error: Even the smallest voice setup \(Chatterbox speech with Whisper base\) needs about 2\.9 GiB of GPU memory, but Small GPU \(2\.0 GiB, 2\.0 GiB free\) has less\.$/);
  assert.throws(() => decide(undefined, [card(2048)], { reserveMiB: 1000 }), /smallest voice setup \(Chatterbox speech with Whisper base\) needs about 2\.9 GiB of GPU memory, plus 1\.0 GiB kept free/);
  assert.throws(() => decide(DEFAULT_CHOICE, [card(20000)], { reserveMiB: 16000 }), /plus 15\.6 GiB kept free/);
  // No GPU read at all: the choice is kept, unchecked, and Docker has the last word.
  const blind = decide({ tts: 'chatterbox', asr: 'whisper', asrModel: 'base' }, []);
  assert.deepEqual(blind.choice, { tts: 'chatterbox', asr: 'whisper', asrModel: 'base' });
  assert.match(blind.summary, /No GPU could be read here; installing Chatterbox speech with Whisper base unchecked/);
  assert.deepEqual(decide(undefined, []).choice, DEFAULT_CHOICE);
  assert.match(decide(DEFAULT_CHOICE, [card(null)]).summary, /its memory could not be read/);
  // Several cards: the one asked for, which the container is then given.
  assert.equal(decide(undefined, [card(12288, 11000, 0), card(12288, 12000, 1)]).gpu?.index, 1);
  assert.equal(decide(undefined, [card(12288, 11000, 0), card(12288, 12000, 1)], { preferredGpu: 0 }).gpu?.index, 0);
});
