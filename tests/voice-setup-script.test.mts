import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ASR_MODELS, DEFAULT_CHOICE, TTS_ENGINES, serverConfig, type VoiceChoice } from '../server/src/voice-engines.js';

// The setup script run for real, with every command that would build, download or
// install something replaced by a stub that writes down what it was asked to do.
// Nothing is downloaded, built or installed, and no GPU is needed.
const script = readFileSync('deploy/voice/setup.sh', 'utf8');
const root = mkdtempSync(path.join(tmpdir(), 'voice-setup-'));
const calls = path.join(root, 'calls.log');
const stubs = path.join(root, 'stubs.sh');
const volume = path.join(root, 'volume');
// A service writes its line and stays up a moment: the script ends when the first one exits and stops the other.
const SERVER_STUB = '#!/bin/sh\necho "$(basename "$0") $*" >> "$CALLS"\nsleep 0.4\nexit 0\n';
const GGUF_STUB = '#!/bin/sh\necho "audiocpp_gguf $*" >> "$CALLS"\nwhile [ $# -gt 0 ]; do [ "$1" = --output ] && echo weights > "$2"; shift; done\nexit 0\n';
// Functions win over commands, so BASH_ENV reaches the script's own shell and no PATH is touched.
writeFileSync(stubs, `
log() { echo "$*" >> "$CALLS"; }
cd() { if [ "\${1:-}" = /voice ]; then builtin cd "$VOLUME"; else builtin cd "$@"; fi; }
touch() { case "\${1:-}" in /usr/*) log "touch $1";; *) command touch "$@";; esac; }
dpkg() { log "dpkg $*"; }
apt-get() { log "apt-get $*"; }
nvidia-smi() { echo 8.6; }
git() {
  log "git $*"
  if [ "$1" = clone ]; then mkdir -p "$3/.git" "$3/scripts"; fi
}
cmake() { log "cmake $*"; if [ "$1" = --build ]; then mkdir -p whisper/build/bin; printf '${SERVER_STUB.replace(/\n/g, '\\n')}' > whisper/build/bin/whisper-server; chmod +x whisper/build/bin/whisper-server; fi; }
aria2c() {
  local dir out sum
  for a in "$@"; do case "$a" in --dir=*) dir="\${a#--dir=}";; --out=*) out="\${a#--out=}";; --checksum=*) sum="\${a#--checksum=}";; esac; done
  log "aria2c \${sum#sha-256=} \${@: -1} -> $dir/$out"
  echo weights > "$dir/$out"
}
bash() {
  log "bash $*"
  case "$1" in
    scripts/build_linux.sh)
      local bin="$VOLUME/audio/build/portal/bin"
      mkdir -p "$bin"
      printf '${SERVER_STUB.replace(/\n/g, '\\n')}' > "$bin/audiocpp_server"
      printf '${GGUF_STUB.replace(/\n/g, '\\n')}' > "$bin/audiocpp_gguf"
      chmod +x "$bin/audiocpp_server" "$bin/audiocpp_gguf"
      echo 'AUDIOCPP_BUILD_NATIVE_MODEL_MANAGER:BOOL=ON' > "$VOLUME/audio/build/portal/CMakeCache.txt" ;;
    whisper/models/download-ggml-model.sh) : > "models/ggml-$2.bin" ;;
  esac
}
`);
after(() => rmSync(root, { recursive: true, force: true }));

/** Runs the script in the volume, as the container would. */
function run(env: Record<string, string> = {}) {
  mkdirSync(volume, { recursive: true });
  writeFileSync(calls, '');
  const result = spawnSync('bash', ['--noprofile', '--norc', '-c', script], {
    env: { PATH: process.env.PATH!, BASH_ENV: stubs, CALLS: calls, VOLUME: volume, ...env }, encoding: 'utf8', timeout: 30000,
  });
  const log = readFileSync(calls, 'utf8').split('\n').filter(Boolean);
  return { status: result.status, stderr: result.stderr, stdout: result.stdout, log };
}
const environment = (c: VoiceChoice) => ({ VOICE_TTS: c.tts, VOICE_ASR: c.asr, VOICE_ASR_MODEL: c.asrModel, VOICE_SERVER_CONFIG: JSON.stringify(serverConfig(c)) });
const fresh = () => { rmSync(volume, { recursive: true, force: true }); };
const built = (log: string[]) => log.filter(l => l.startsWith('bash scripts/build_linux.sh'));
const downloads = (log: string[]) => log.filter(l => l.startsWith('aria2c'));
// The two services write their line as they start, in no fixed order.
const started = (log: string[]) => log.filter(l => /^(whisper-server|audiocpp_server) /.test(l)).sort();

test('the script is valid bash', () => {
  const result = spawnSync('bash', ['-n'], { input: script, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('without any choice the script makes the original combination: Breeze, Whisper base and the config it always wrote', () => {
  fresh();
  const { status, log, stderr } = run();
  assert.equal(status, 0, stderr);
  assert.match(built(log)[0], /--models breeze_tts --target audiocpp_server --target audiocpp_gguf/);
  assert.ok(log.some(l => l.startsWith('bash whisper/models/download-ggml-model.sh base /voice/models')));
  assert.equal(downloads(log).length, 1);
  assert.match(downloads(log)[0], /^aria2c a00c9f678b4c5ae03d1dcd228f636b329352cda200823faef4e01d3bd97c0a89 https:\/\/huggingface\.co\/audio-cpp\/audio\.cpp-gguf\/resolve\/056144d2744697c9439bd32647279674dba0c964\/Breeze-TTS-2-GGUF\/breeze-tts-2-bf16\.gguf/);
  assert.ok(log.some(l => l.startsWith('audiocpp_gguf --input models/breeze-bf16.gguf --output models/breeze-q8_0.partial.gguf --type q8_0')));
  assert.ok(existsSync(path.join(volume, 'models/breeze-q8_0.gguf')) && !existsSync(path.join(volume, 'models/breeze-bf16.gguf')));
  assert.deepEqual(JSON.parse(readFileSync(path.join(volume, 'server.json'), 'utf8')), serverConfig(DEFAULT_CHOICE));
  assert.deepEqual(started(log), ['audiocpp_server --config /voice/server.json', 'whisper-server --host 127.0.0.1 --port 8188 --model /voice/models/ggml-base.bin --language auto --threads 4']);
});

test('every engine and model size the page offers is built, downloaded and started by the script', () => {
  const sums: Record<string, string> = {
    '0.6b': '6c44ec2fb4cee513892d7863c1fcc3ea6b699ffa4d899b0ef4ab19956d9544f7', '1.7b': 'da4fc2ac7f24dee784d1684eb1f35836cdbf559519452ae11777670734c0a4f8',
  };
  for (const tts of Object.keys(TTS_ENGINES) as VoiceChoice['tts'][]) for (const o of ASR_MODELS) {
    const choice: VoiceChoice = { tts, asr: o.asr, asrModel: o.model };
    fresh();
    const { status, log, stderr } = run(environment(choice));
    const name = `${tts} + ${o.asr}:${o.model}`;
    assert.equal(status, 0, `${name}: ${stderr}`);
    const families = [tts === 'breeze' ? 'breeze_tts' : 'chatterbox', ...(o.asr === 'qwen3-asr' ? ['qwen3_asr'] : [])].sort().join(',');
    assert.match(built(log)[0], new RegExp(`--models ${families} `), name);
    const names = downloads(log).map(l => l.split(' -> ')[1]);
    if (tts === 'chatterbox') assert.ok(downloads(log).some(l => l.startsWith('aria2c d586dd1aa59613cab8046176fb7ca5ba191c02a9b10ffa5b0d892ed22b470656 https://huggingface.co/audio-cpp/audio.cpp-gguf/resolve/6d5436fc85f7a20c2e9f4e472b7f3a532f686444/Chatterbox-GGUF/chatterbox-q8_0.gguf')), name);
    assert.equal(names.includes('models/chatterbox-q8_0.gguf.part'), tts === 'chatterbox', name);
    assert.equal(names.includes('models/breeze-bf16.gguf.part'), tts === 'breeze', name);
    if (o.asr === 'qwen3-asr') {
      const folder = `Qwen3-ASR-${o.model.toUpperCase()}-GGUF`;
      assert.ok(downloads(log).some(l => l.startsWith(`aria2c ${sums[o.model]} https://huggingface.co/audio-cpp/audio.cpp-gguf/resolve/6d5436fc85f7a20c2e9f4e472b7f3a532f686444/${folder}/qwen3-asr-${o.model}-q8_0.gguf`)), name);
      assert.ok(existsSync(path.join(volume, `models/qwen3-asr-${o.model}-q8_0.gguf`)), name);
      assert.ok(!log.some(l => l.includes('download-ggml-model') || l.startsWith('cmake')), `${name} needs no Whisper`);
      assert.deepEqual(started(log), ['audiocpp_server --config /voice/server.json'], name);
    } else {
      assert.ok(log.some(l => l.startsWith(`bash whisper/models/download-ggml-model.sh ${o.model} /voice/models`)), name);
      assert.deepEqual(started(log), ['audiocpp_server --config /voice/server.json', `whisper-server --host 127.0.0.1 --port 8188 --model /voice/models/ggml-${o.model}.bin --language auto --threads 4`], name);
    }
    // The config the portal sent is the one audio.cpp is started with.
    assert.deepEqual(JSON.parse(readFileSync(path.join(volume, 'server.json'), 'utf8')), serverConfig(choice), name);
    // Every model the config names is on disk by then.
    for (const model of serverConfig(choice).models) assert.ok(existsSync(path.join(volume, model.path.replace('/voice/', ''))), `${name}: ${model.path}`);
  }
});

test('a second run reuses the volume, and switching engines builds only what is new, once', () => {
  fresh();
  const chatterbox: VoiceChoice = { tts: 'chatterbox', asr: 'qwen3-asr', asrModel: '0.6b' };
  assert.equal(run(environment(DEFAULT_CHOICE)).status, 0);
  const again = run(environment(DEFAULT_CHOICE));
  assert.deepEqual([built(again.log), downloads(again.log)], [[], []], 'nothing rebuilt or downloaded for the same choice');
  const switched = run(environment(chatterbox));
  assert.match(built(switched.log)[0], /--models breeze_tts,chatterbox,qwen3_asr /, 'the family Breeze needed is kept');
  assert.equal(downloads(switched.log).length, 2, 'only the two new models');
  // Back again: the build already holds Breeze, and so does the volume.
  const back = run(environment(DEFAULT_CHOICE));
  assert.deepEqual([built(back.log), downloads(back.log)], [[], []]);
  assert.deepEqual(JSON.parse(readFileSync(path.join(volume, 'server.json'), 'utf8')), serverConfig(DEFAULT_CHOICE));
});

test('a volume from before engines could be chosen is neither rebuilt nor downloaded again for the same combination', () => {
  fresh();
  // What the old installer left: Breeze-only binaries without a families file, the quantized model, Whisper.
  const bin = path.join(volume, 'audio/build/portal/bin');
  mkdirSync(bin, { recursive: true });
  mkdirSync(path.join(volume, 'audio/.git'), { recursive: true });
  mkdirSync(path.join(volume, 'whisper/build/bin'), { recursive: true });
  mkdirSync(path.join(volume, 'whisper/.git'), { recursive: true });
  mkdirSync(path.join(volume, 'models'), { recursive: true });
  for (const f of ['audio/build/portal/bin/audiocpp_server', 'audio/build/portal/bin/audiocpp_gguf', 'whisper/build/bin/whisper-server']) {
    writeFileSync(path.join(volume, f), SERVER_STUB); chmodSync(path.join(volume, f), 0o755);
  }
  writeFileSync(path.join(volume, 'audio/build/portal/CMakeCache.txt'), 'AUDIOCPP_BUILD_NATIVE_MODEL_MANAGER:BOOL=ON\n');
  writeFileSync(path.join(volume, 'models/breeze-q8_0.gguf'), 'weights');
  const { status, log, stderr } = run();
  assert.equal(status, 0, stderr);
  assert.deepEqual([built(log), downloads(log), log.filter(l => l.startsWith('cmake'))], [[], [], []]);
  assert.equal(started(log).length, 2);
  // The same volume grows when another engine is chosen: Breeze stays in the build.
  const next = run(environment({ tts: 'breeze', asr: 'qwen3-asr', asrModel: '1.7b' }));
  assert.match(built(next.log)[0], /--models breeze_tts,qwen3_asr /);
});

test('a choice the script does not know, or a config it was not sent, stops it before anything is built', () => {
  fresh();
  for (const [env, message] of [
    [{ VOICE_TTS: 'kokoro' }, /unknown speech engine 'kokoro'/],
    [{ VOICE_ASR: 'qwen3-asr', VOICE_ASR_MODEL: 'base' }, /unknown speech recognition model 'qwen3-asr:base'/],
    [{ VOICE_ASR: 'whisper', VOICE_ASR_MODEL: '1.7b' }, /unknown speech recognition model 'whisper:1\.7b'/],
  ] as const) {
    const { status, stderr, log } = run(env);
    assert.equal(status, 2, stderr);
    assert.match(stderr, message);
    assert.deepEqual(log, []);
  }
  // Only the original combination has a config of its own here.
  const missing = run({ VOICE_TTS: 'chatterbox' });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /VOICE_SERVER_CONFIG is missing/);
});

test('what the GPU check found is the first line of the setup log', () => {
  fresh();
  const { stdout } = run({ ...environment(DEFAULT_CHOICE), VOICE_PLAN: 'Detected Test GPU: Breeze speech with Whisper base needs about 4.5 GiB, which fits.' });
  assert.equal(stdout.split('\n')[0], 'VOICE_STAGE: Detected Test GPU: Breeze speech with Whisper base needs about 4.5 GiB, which fits.');
});
