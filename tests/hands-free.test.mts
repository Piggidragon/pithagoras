import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HandsFreeVoice, type VoiceIO } from '../web/src/hands-free.js';
import { samplesWav } from '../web/src/voice.js';
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const reply = (id: string, done = true) => ({ kind: 'assistant' as const, id, text: 'A spoken answer.', thinking: '', done });
function setup(patch: Partial<VoiceIO> & { speak?: (text: string, signal: AbortSignal) => Promise<void> } = {}) {
  const sent: string[] = [], spoken: string[] = [], errors: string[] = [];
  const io: VoiceIO = {
    transcribe: async () => 'hello', send: async text => { sent.push(text); },
    abort: async () => {}, agentRunning: () => false,
    synthesize: async text => async signal => { if (patch.speak) await patch.speak(text, signal); else spoken.push(text); }, phase: () => {}, error: message => { errors.push(message); }, ...patch,
  };
  return { voice: new HandsFreeVoice(io, [reply('a10')]), sent, spoken, errors };
}
test('successive automatic turns work without another mic toggle; history stays silent', async () => {
  const { voice, sent, spoken } = setup();
  voice.observe([reply('a1'), reply('a10')]);
  voice.speechStart(); voice.speechEnd(new Float32Array(16000)); await tick();
  assert.deepEqual(sent, ['hello']);
  voice.observe([reply('a10'), reply('a20')]); await tick();
  voice.speechStart(); voice.speechEnd(new Float32Array(16000)); await tick();
  voice.observe([reply('a10'), reply('a20'), reply('a30')]); await tick();
  assert.equal(sent.length, 2); assert.equal(spoken.length, 2); voice.stop();
});
test('barge-in immediately cancels playback and ignores the interrupted reply remainder', async () => {
  let playbackSignal: AbortSignal | undefined;
  let aborted = 0;
  const { voice, sent } = setup({ agentRunning: () => true, abort: async () => { aborted++; }, speak: async (_text, signal) => {
    playbackSignal = signal; await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
  } });
  voice.observe([reply('a20'), reply('a21', false)]); await tick();
  voice.speechStart(); assert.equal(playbackSignal?.aborted, true); await tick();
  assert.equal(aborted, 1);
  voice.observe([reply('a20'), reply('a21')]);
  voice.speechEnd(new Float32Array(16000)); await tick();
  assert.deepEqual(sent, ['hello']); voice.stop();
});
test('speech resumed during transcription is combined, not dropped or sent halfway through', async () => {
  const first = deferred<string>(); let count = 0;
  const { voice, sent } = setup({ transcribe: () => ++count === 1 ? first.promise : Promise.resolve('and the second part') });
  voice.speechStart(); voice.speechEnd(new Float32Array(16000));
  voice.speechStart(); first.resolve('the first part'); await tick();
  assert.equal(sent.length, 0);
  voice.speechEnd(new Float32Array(16000)); await tick();
  assert.deepEqual(sent, ['the first part and the second part']); voice.stop();
});
test('barge-in waits for an in-flight send before abort, then sends the next turn', async () => {
  const accepted = deferred<void>(); const calls: string[] = [];
  const { voice } = setup({ send: async () => { calls.push('send'); if (calls.length === 1) await accepted.promise; }, abort: async () => { calls.push('abort'); } });
  voice.speechStart(); voice.speechEnd(new Float32Array(16000)); await tick();
  voice.speechStart(); voice.speechEnd(new Float32Array(16000));
  assert.deepEqual(calls, ['send']); accepted.resolve(); await tick(); await tick();
  assert.deepEqual(calls, ['send', 'abort', 'send']); voice.stop();
});
test('ending voice during transcription aborts the request and cannot send late text', async () => {
  const pending = deferred<string>(); let signal: AbortSignal | undefined;
  const { voice, sent } = setup({ transcribe: (_audio, input) => { signal = input; return pending.promise; } });
  voice.speechStart(); voice.speechEnd(new Float32Array(16000)); voice.stop();
  assert.equal(signal?.aborted, true); pending.resolve('must not be sent'); await tick();
  assert.deepEqual(sent, []);
});
test('a failed interruption is reported and does not send into the old running turn', async () => {
  const { voice, sent, errors } = setup({ agentRunning: () => true, abort: async () => { throw new Error('offline'); } });
  voice.speechStart(); voice.speechEnd(new Float32Array(16000)); await tick();
  assert.equal(sent.length, 0); assert.ok(errors.some(e => e.includes('offline'))); voice.stop();
});
test('VAD samples produce a 16 kHz PCM WAV with clipped amplitudes', async () => {
  const wav = new DataView(await samplesWav(new Float32Array([-2, 0, 2])).arrayBuffer());
  assert.equal(wav.getUint32(24, true), 16000); assert.equal(wav.getUint32(40, true), 6);
  assert.equal(wav.getInt16(44, true), -32768); assert.equal(wav.getInt16(48, true), 32767);
});

test('mute discards pending microphone input but leaves agent and playback alone', async () => {
  const transcription = deferred<string>(); let signal: AbortSignal | undefined;
  let aborts = 0; let playback: AbortSignal | undefined;
  const { voice, sent } = setup({ transcribe: (_samples, s) => { signal = s; return transcription.promise; }, abort: async () => { aborts++; },
    speak: async (_text, s) => { playback = s; await new Promise<void>(resolve => s.addEventListener('abort', () => resolve(), { once: true })); },
  });
  voice.speechStart(); voice.speechEnd(new Float32Array(16000));
  voice.setMuted(true); assert.equal(signal?.aborted, true);
  transcription.resolve('discard this partial turn'); await tick(); assert.deepEqual(sent, []);
  voice.observe([reply('a20')]); await tick();
  assert.equal(playback?.aborted, false);
  voice.speechStart(); voice.speechEnd(new Float32Array(16000)); await tick();
  assert.equal(aborts, 0); assert.equal(playback?.aborted, false); assert.deepEqual(sent, []);
  voice.stop();
});

test('unmute accepts new turns in the same voice session', async () => {
  const { voice, sent } = setup();
  voice.setMuted(true); voice.speechStart(); voice.speechEnd(new Float32Array(16000)); await tick();
  assert.deepEqual(sent, []);
  voice.setMuted(false); voice.speechStart(); voice.speechEnd(new Float32Array(16000)); await tick();
  assert.deepEqual(sent, ['hello']); voice.stop();
});

test('speaks stable sentences before response completion without replaying deltas or the final event', async () => {
  const { voice, spoken } = setup();
  const part = (text: string, done = false) => ({ ...reply('a20', done), text });
  voice.observe([part('Here is the first sentence. Now')]); await tick();
  assert.deepEqual(spoken, ['Here is the first sentence.']);
  voice.observe([part('Here is the first sentence. Now the rest arrives.')]); await tick();
  assert.equal(spoken.length, 1);
  voice.observe([part('Here is the first sentence. Now the rest arrives.', true)]); await tick();
  voice.observe([part('Here is the first sentence. Now the rest arrives.', true)]); await tick();
  assert.deepEqual(spoken, ['Here is the first sentence.', 'Now the rest arrives.']); voice.stop();
});

test('streaming code and link fragments are not spoken, and a final unfinished sentence is flushed', async () => {
  const { voice, spoken } = setup();
  const part = (text: string, done = false) => ({ ...reply('a20', done), text });
  voice.observe([part('Here is an introduction. ```js\nsecret.call();\n')]); await tick();
  assert.deepEqual(spoken, ['Here is an introduction.']);
  voice.observe([part('Here is an introduction. ```js\nsecret.call();\n```\nSee [the docs](https://secret.')]); await tick();
  assert.ok(spoken.join(' ').includes('Code is shown in the transcript.'));
  voice.observe([part('Here is an introduction. ```js\nsecret.call();\n```\nSee [the docs](https://secret.example). Final words', true)]); await tick();
  assert.ok(spoken.join(' ').endsWith('See the docs. Final words'));
  assert.ok(!spoken.join(' ').includes('secret')); voice.stop();
});


test('multiple available sentences stay separate so playback buffers only one phrase at a time', async () => {
  const { voice, spoken } = setup();
  voice.observe([{ ...reply('a20'), text: 'This is the first sentence. This is the second sentence. This is the final sentence.' }]);
  await tick();
  assert.deepEqual(spoken, ['This is the first sentence.', 'This is the second sentence.', 'This is the final sentence.']);
  voice.stop();
});


test('tiny sentences join the next phrase, while a short final reply still flushes', async () => {
  const { voice, spoken } = setup();
  const part = (text: string, done = false) => ({ ...reply('a20', done), text });
  voice.observe([part('Yes. ')]); await tick(); assert.deepEqual(spoken, []);
  voice.observe([part('Yes. I can check that for you. Next')]); await tick();
  assert.deepEqual(spoken, ['Yes. I can check that for you.']);
  voice.observe([part('Yes. I can check that for you. Next', true)]); await tick();
  assert.deepEqual(spoken, ['Yes. I can check that for you.', 'Next']); voice.stop();
});

test('response audio plays while the send acknowledgement is still pending', async () => {
  const accepted = deferred<void>();
  const { voice, spoken } = setup({ send: () => accepted.promise });
  voice.speechStart(); voice.speechEnd(new Float32Array(16000)); await tick();
  voice.observe([reply('a20')]); await tick();
  assert.deepEqual(spoken, ['A spoken answer.']);
  accepted.resolve(); await tick(); voice.stop();
});

test('thinking gets one short queued phrase; fast replies suppress it', async () => {
  const { voice, spoken } = setup({ agentRunning: () => true });
  voice.observe([reply('a10')]);
  await new Promise(r => setTimeout(r, 1900)); await tick();
  assert.equal(spoken.length, 1);
  assert.match(spoken[0], /think|consider|moment/i);
  voice.observe([reply('a10')]); await tick();
  assert.equal(spoken.length, 1);
  voice.stop();
  const fast = setup({ agentRunning: () => true });
  fast.voice.observe([reply('a10')]);
  fast.voice.observe([reply('a20')]); await tick();
  fast.voice.stop();
  assert.deepEqual(fast.spoken, ['A spoken answer.']);
});

test('compaction replaces thinking cues once and returns to normal status after ending', async () => {
  const phases: string[] = [];
  const { voice, spoken } = setup({ agentRunning: () => true, phase: phase => phases.push(phase) });
  voice.observe([reply('a10')]);
  voice.setCompacting(true);
  voice.setCompacting(true);
  await tick();
  await new Promise(r => setTimeout(r, 1900));
  assert.equal(spoken.length, 1);
  assert.match(spoken[0], /context/i);
  assert.equal(phases.at(-1), 'Compacting context');
  voice.setCompacting(false);
  await tick();
  assert.ok(spoken.some(text => text.includes('compaction is done')));
  assert.equal(phases.at(-1), 'Thinking');
  voice.stop();
});

test('compaction aborts an in-flight thinking cue', async () => {
  let cueSignal: AbortSignal | undefined;
  const { voice } = setup({ agentRunning: () => true, synthesize: async (text, signal) => {
    if (!text.includes('context')) {
      cueSignal = signal;
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    }
    return async () => {};
  } });
  voice.observe([reply('a10')]);
  await new Promise(r => setTimeout(r, 1900));
  assert.ok(cueSignal);
  voice.setCompacting(true);
  assert.equal(cueSignal.aborted, true);
  await tick();
  voice.stop();
});

test('speech during compaction does not abort or send, even if compaction ends mid-utterance', async () => {
 let aborts=0, transcriptions=0;
 const {voice,spoken,sent}=setup({agentRunning:()=>true,abort:async()=>{aborts++},transcribe:async()=>{transcriptions++;return 'interrupt'}});
 voice.setCompacting(true); await tick();
 voice.speechStart(); voice.speechStart(); await tick();
 assert.equal(aborts,0);
 assert.equal(spoken.filter(text=>text.includes('Please wait')).length,1);
 voice.setCompacting(false); await tick();
 voice.speechEnd(new Float32Array(16000)); await tick();
 assert.equal(transcriptions,0); assert.equal(sent.length,0);
 assert.ok(spoken.some(text=>text.includes('compaction is done')));
 voice.stop();
});
test('failed compaction is not announced as completed', async () => {
 const {voice,spoken}=setup();voice.setCompacting(true);await tick();voice.setCompacting(false,false);await tick();
 assert.ok(spoken.some(text=>text.includes('stopped before')));
 assert.ok(!spoken.some(text=>text.includes('compaction is done')));voice.stop();
});


test('short sentences wait regardless of character length', async () => {
  const { voice, spoken } = setup();
  const part = (text: string, done = false) => ({ ...reply('a20', done), text });
  voice.observe([part('Absolutely extraordinary. ')]); await tick(); assert.deepEqual(spoken, []);
  voice.observe([part('Absolutely extraordinary. I am here. Next')]); await tick();
  assert.deepEqual(spoken, ['Absolutely extraordinary. I am here.']);
  voice.observe([part('Absolutely extraordinary. I am here. Next', true)]); await tick();
  assert.equal(spoken.at(-1), 'Next'); voice.stop();
});

test('speech cues do not count as words and three-word phrases join the next sentence', async () => {
  const { voice, spoken } = setup();
  const part = (text: string, done = false) => ({ ...reply('a20', done), text });
  voice.observe([part('(clears throat) Hello. ')]); await tick(); assert.deepEqual(spoken, []);
  voice.observe([part('(clears throat) Hello. I am here. Go to it. Next')]); await tick();
  assert.deepEqual(spoken, ['(clears throat) Hello. I am here.']);
  voice.observe([part('(clears throat) Hello. I am here. Go to it. Now we can continue. Next')]); await tick();
  assert.deepEqual(spoken, ['(clears throat) Hello. I am here.', 'Go to it. Now we can continue.']); voice.stop();
});

test('sequential baseline waits for the complete agent turn before synthesizing',async()=>{
 let running=true;const generated:string[]=[];
 const {voice}=setup({sequential:true,agentRunning:()=>running,synthesize:async text=>{generated.push(text);return async()=>{};}});
 voice.observe([reply('a20'),reply('a21',false)]);await tick();assert.equal(generated.length,0);
 voice.observe([reply('a20'),reply('a21')]);await tick();assert.equal(generated.length,0);
 running=false;voice.observe([reply('a20'),reply('a21')]);await tick();assert.equal(generated.length,2);voice.stop();
});

test('sentence comparison submits a completed sentence before the agent turn ends',async()=>{
 const generated:string[]=[];const {voice}=setup({sequential:true,sentenceChunks:true,agentRunning:()=>true,synthesize:async text=>{generated.push(text);return async()=>{};}});
 voice.observe([{...reply('a20',false),text:'Here is the first complete sentence. More'}]);await tick();
 assert.deepEqual(generated,['Here is the first complete sentence.']);voice.stop();
});
