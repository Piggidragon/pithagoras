import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { HandsFreeVoice, FILLER_PACING, type FillerPacing, type VoiceIO } from '../web/src/hands-free.js';
import { samplesWav } from '../web/src/voice.js';
import { notice } from '../web/src/voice-notices.js';
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
/** A filler that plays until it is cut, and what happened to it. */
function fillers() {
  const log: string[] = [];
  const filler = (signal: AbortSignal) => {
    log.push('filler:start');
    return new Promise<void>(resolve => signal.addEventListener('abort', () => { log.push('filler:cut'); resolve(); }, { once: true }));
  };
  return { filler, log };
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
  // Not stopped for a sound; stopped once it is words for the agent.
  assert.equal(aborted, 0);
  voice.heard('hello'); await tick();
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
  voice.speechStart(); voice.heard('hello'); voice.speechEnd(new Float32Array(16000));
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

test('compaction is announced once and again when it ends, and the phase follows it', async () => {
  const phases: string[] = [];
  const { voice, spoken } = setup({ agentRunning: () => true, phase: phase => phases.push(phase) });
  voice.observe([reply('a10')]);
  voice.setCompacting(true);
  voice.setCompacting(true);
  await tick();
  assert.equal(spoken.length, 1);
  assert.match(spoken[0], /context/i);
  assert.equal(phases.at(-1), 'Compacting context');
  voice.setCompacting(false);
  await tick();
  assert.ok(spoken.some(text => text.includes('compaction is done')));
  assert.equal(phases.at(-1), 'Thinking');
  voice.stop();
});

test('the compaction notices are in the language the voice speaks, whatever language the page is in', async () => {
  const say = async (speechLanguage?: string) => {
    const { voice, spoken } = setup({ agentRunning: () => true, speechLanguage: () => speechLanguage });
    voice.setCompacting(true); await tick(); voice.speechStart(); await tick(); voice.setCompacting(false); await tick(); voice.stop();
    return spoken;
  };
  const german = await say('de');
  assert.equal(german.length, 3);
  assert.ok(german.every(text => /komprimier|kontext/i.test(text)), german.join(' | '));
  assert.ok((await say('en')).every(text => /compact/i.test(text)));
  // The same with the page in another language: the voice's is what counts.
  assert.equal(notice('done', 'en', 'de'), "Context compaction is done. I'm ready to continue.");
  assert.match(notice('done', 'de-AT', 'en')!, /Komprimierung/);
});

test('a voice in a language the notices have no wording for says nothing about compaction, and the phase still follows it', async () => {
  const phases: string[] = [];
  const { voice, spoken } = setup({ agentRunning: () => true, speechLanguage: () => 'fr', phase: phase => phases.push(phase) });
  voice.setCompacting(true); await tick(); voice.speechStart(); await tick();
  assert.equal(phases.at(-1), 'Compacting context');
  voice.setCompacting(false); await tick(); voice.setCompacting(true, false); await tick(); voice.setCompacting(false, false); await tick();
  assert.deepEqual(spoken, []);
  voice.stop();
  // Detected language: the voice speaks what it is given, so the page's wording is used where there is one.
  assert.match(notice('compacting', 'auto', 'de')!, /Kontext/);
  assert.match(notice('compacting', undefined, 'en')!, /context/);
  assert.equal(notice('compacting', 'auto', 'fr'), undefined);
});

test('compaction ends a filler that is playing', async () => {
  const { filler, log } = fillers();
  const { voice } = setup({ agentRunning: () => true, filler });
  voice.speechStart(); voice.speechEnd(new Float32Array(16000)); await tick();
  assert.deepEqual(log, ['filler:start']);
  voice.setCompacting(true);
  assert.deepEqual(log, ['filler:start', 'filler:cut']);
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
test('what is for the page is handled there and never sent', async () => {
  const handled: string[] = [];
  const { voice, sent, spoken } = setup({ transcribe: async () => 'say that again', command: text => { handled.push(text); return true; } });
  voice.speechStart(); voice.speechEnd(new Float32Array(16000)); await tick();
  assert.deepEqual(handled, ['say that again']);
  assert.deepEqual(sent, []);
  // Replies after it are spoken as before.
  voice.observe([reply('a10'), reply('a20')]); await tick();
  assert.equal(spoken.length, 1); voice.stop();
});
test('a page command heard over an interrupted reply keeps its remainder spoken', async () => {
  const handled: string[] = [];
  const { voice, sent, spoken } = setup({ agentRunning: () => true, transcribe: async () => 'say that again', command: text => { handled.push(text); return true; } });
  voice.speechStart();
  // The reply it cut off is held back while what is said may still be for the page.
  voice.observe([reply('a10'), reply('a20')]); await tick();
  voice.speechEnd(new Float32Array(16000)); await tick();
  assert.deepEqual(handled, ['say that again']);
  assert.deepEqual(sent, []);
  // What the interruption cut off is spoken after all, not dropped with it.
  assert.deepEqual(spoken, ['A spoken answer.']); voice.stop();
});
test('when steering, speaking mid-run adds to the run instead of stopping it', async () => {
  let aborted = 0, steering = true;
  const { voice, sent } = setup({ agentRunning: () => true, abort: async () => { aborted++; }, steering: () => steering });
  voice.speechStart(); voice.speechEnd(new Float32Array(16000)); await tick();
  assert.equal(aborted, 0); assert.deepEqual(sent, ['hello']);
  steering = false;
  voice.speechStart(); voice.speechEnd(new Float32Array(16000)); await tick();
  assert.equal(aborted, 1); voice.stop();
});
test('speech taken back before it ends is not sent, and replies carry on', async () => {
  const phases: string[] = [];
  const { voice, sent, spoken } = setup({ phase: phase => { phases.push(phase); } });
  voice.speechStart(); voice.speechCancel(); await tick();
  assert.deepEqual(sent, []);
  assert.equal(phases.at(-1), 'Listening');
  voice.observe([reply('a10'), reply('a20')]); await tick();
  assert.equal(spoken.length, 1); voice.stop();
});
test('a noise that transcribes to nothing leaves the run going and its reply spoken', async () => {
  let aborted = 0;
  const { voice, sent, spoken } = setup({ agentRunning: () => true, transcribe: async () => '', abort: async () => { aborted++; } });
  voice.observe([reply('a10'), reply('a20', false)]); await tick();
  voice.speechStart(); voice.speechEnd(new Float32Array(16000)); await tick();
  assert.equal(aborted, 0); assert.deepEqual(sent, []);
  // What the agent says after the cough is heard.
  voice.observe([reply('a10'), reply('a20', false), reply('a30')]); await tick();
  assert.deepEqual(spoken, ['A spoken answer.']); voice.stop();
});
test('a run is stopped as soon as what is being said is plainly for the agent, and only once', async () => {
  let aborted = 0;
  const pending = deferred<string>();
  const { voice, sent } = setup({ agentRunning: () => aborted === 0, abort: async () => { aborted++; }, transcribe: () => pending.promise,
    couldBeCommand: partial => /^(say|say that)$/i.test(partial.trim()) });
  voice.speechStart();
  voice.heard('Say'); await tick();
  assert.equal(aborted, 0);
  voice.heard("Stop, don't"); await tick();
  assert.equal(aborted, 1);
  voice.heard("Stop, don't touch that file"); await tick();
  voice.speechEnd(new Float32Array(16000)); pending.resolve("Stop, don't touch that file."); await tick(); await tick();
  assert.equal(aborted, 1); assert.deepEqual(sent, ["Stop, don't touch that file."]); voice.stop();
});
test('what is heard mid-run does not stop it when steering or while it could still be for the page', async () => {
  let aborted = 0;
  const { voice } = setup({ agentRunning: () => true, abort: async () => { aborted++; }, steering: () => true });
  voice.speechStart(); voice.heard('Also check the tests'); await tick();
  assert.equal(aborted, 0); voice.stop();
});
test('a cough mid-reply cuts it off, then the cut-off sentence and what came meanwhile are spoken', async () => {
  const started: string[] = [];
  let release: (() => void) | undefined;
  const { voice } = setup({ agentRunning: () => true, transcribe: async () => '', speak: async (text, signal) => {
    started.push(text);
    await new Promise<void>(resolve => { release = resolve; signal.addEventListener('abort', () => resolve(), { once: true }); });
  } });
  voice.observe([reply('a10'), { ...reply('a20', false), text: 'First sentence here now. Second sentence here now. ' }]); await tick();
  assert.deepEqual(started, ['First sentence here now.']);
  voice.speechStart(); await tick();
  voice.observe([reply('a10'), { ...reply('a20', false), text: 'First sentence here now. Second sentence here now. Third sentence here now. ' }]); await tick();
  assert.deepEqual(started, ['First sentence here now.']);
  voice.speechEnd(new Float32Array(16000)); await tick(); await tick();
  for (let i = 0; i < 3; i++) { release?.(); await tick(); await tick(); }
  assert.deepEqual(started, ['First sentence here now.', 'First sentence here now.', 'Second sentence here now.', 'Third sentence here now.']);
  voice.stop();
});
test('a push-to-talk press taken back does not lose the reply it cut off', async () => {
  const started: string[] = [];
  const { voice } = setup({ agentRunning: () => true, speak: async (text, signal) => {
    started.push(text); await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
  } });
  voice.observe([reply('a10'), reply('a20')]); await tick();
  voice.speechStart(); voice.speechCancel(); await tick(); await tick();
  assert.deepEqual(started, ['A spoken answer.', 'A spoken answer.']); voice.stop();
});
test('what is sent drops the reply it cut off', async () => {
  const { voice, spoken, sent } = setup();
  voice.speechStart();
  voice.observe([reply('a10'), reply('a20')]); await tick();
  voice.speechEnd(new Float32Array(16000)); await tick(); await tick();
  assert.deepEqual(sent, ['hello']); assert.deepEqual(spoken, []); voice.stop();
});
test('a stop that failed while speaking is tried again before what was said is sent', async () => {
  const calls: string[] = []; const firstAbort = deferred<void>();
  const { voice, sent } = setup({ agentRunning: () => true, send: async text => { calls.push('send'); sent.push(text); },
    abort: async () => { calls.push('abort'); if (calls.filter(c => c === 'abort').length === 1) { await firstAbort.promise; throw new Error('offline'); } } });
  voice.speechStart(); voice.heard('stop'); await tick();
  voice.speechEnd(new Float32Array(16000)); await tick();
  assert.deepEqual(calls, ['abort']);
  firstAbort.resolve(); await tick(); await tick(); await tick();
  assert.deepEqual(calls, ['abort', 'abort', 'send']); assert.deepEqual(sent, ['hello']); voice.stop();
});

// Fillers: a short sound the moment a turn is taken, until the answer starts.
const turn = (voice: HandsFreeVoice) => { voice.speechStart(); voice.speechEnd(new Float32Array(16000)); };

test('a filler plays the moment the turn is taken, while the agent has not yet answered the send', async () => {
  const { filler, log } = fillers(); const accepted = deferred<void>();
  const { voice, sent } = setup({ filler, send: () => accepted.promise });
  turn(voice); await tick();
  // No timer in between: not after seconds of silence, but with the send still open.
  assert.deepEqual(log, ['filler:start']); assert.deepEqual(sent, []);
  accepted.resolve(); await tick(); voice.stop();
});

test('a filler waits for what was said to be known, and then comes with nothing in front of it', async () => {
  const { filler, log } = fillers(); const transcript = deferred<string>();
  const { voice } = setup({ filler, transcribe: () => transcript.promise });
  turn(voice); await tick();
  assert.deepEqual(log, []);
  transcript.resolve('hello'); await tick();
  assert.deepEqual(log, ['filler:start']); voice.stop();
});

test('no filler for a noise that is no words, for what is for the page, or for a send that is refused', async () => {
  const noise = fillers();
  const a = setup({ filler: noise.filler, transcribe: async () => '' });
  turn(a.voice); await tick(); a.voice.stop();
  const page = fillers();
  const b = setup({ filler: page.filler, command: () => true });
  turn(b.voice); await tick(); b.voice.stop();
  const refused = fillers();
  const c = setup({ filler: refused.filler, send: async () => { throw new Error('offline'); } });
  turn(c.voice); await tick();
  assert.deepEqual([noise.log, page.log], [[], []]);
  // Started with the send, and cut when it failed: the turn did not happen.
  assert.deepEqual(refused.log, ['filler:start', 'filler:cut']); c.voice.stop();
});

test('a turn said again after a send that was refused has its filler', async () => {
  const { filler, log } = fillers(); let calls = 0; const errors: string[] = [];
  const { voice, sent } = setup({ filler, error: message => errors.push(message), send: async text => { if (!calls++) throw new Error('offline'); sent.push(text); } });
  turn(voice); await tick();
  assert.deepEqual(log, ['filler:start', 'filler:cut']); assert.equal(errors.length, 1);
  // The user says it again: that turn is the one that happens, and the silence before its answer is filled.
  turn(voice); await tick();
  assert.deepEqual(log, ['filler:start', 'filler:cut', 'filler:start']);
  voice.stop();
});

test('a turn that interrupts a running agent has its filler at once, not when the run it stops has wound down', async () => {
  const { filler, log } = fillers(); const stopped = deferred<void>();
  const { voice, sent } = setup({ filler, agentRunning: () => true, abort: () => { log.push('abort:asked'); return stopped.promise; } });
  turn(voice); await tick();
  // The stop is still pending, as with a tool that is slow to give way: the silence is covered all the same.
  assert.deepEqual(log, ['filler:start', 'abort:asked']); assert.deepEqual(sent, []);
  stopped.resolve(); await tick();
  assert.deepEqual(sent, ['hello']); assert.deepEqual(log, ['filler:start', 'abort:asked']);
  voice.stop();
});

test('the filler of an interrupting turn is cut, and the next turn may have one, when the stop fails or the speaker goes on', async () => {
  const failing = fillers(); const errors: string[] = [];
  const a = setup({ filler: failing.filler, agentRunning: () => true, abort: async () => { throw new Error('stuck'); }, error: message => errors.push(message) });
  turn(a.voice); await tick();
  assert.deepEqual(failing.log, ['filler:start', 'filler:cut']); assert.equal(errors.length, 1);
  turn(a.voice); await tick();
  assert.deepEqual(failing.log, ['filler:start', 'filler:cut', 'filler:start', 'filler:cut']);
  a.voice.stop();
  // Talking on while the stop is pending: the filler is cut as it is for any speech.
  const going = fillers(); const stopped = deferred<void>();
  const b = setup({ filler: going.filler, agentRunning: () => true, abort: () => stopped.promise });
  turn(b.voice); await tick();
  b.voice.speechStart(); await tick();
  assert.deepEqual(going.log, ['filler:start', 'filler:cut']);
  stopped.resolve(); await tick();
  assert.deepEqual(b.sent, []);
  b.voice.stop();
});

test('a filler yields to the answer: it is cut before the answer is heard, and the two never play together', async () => {
  const { filler, log } = fillers();
  const { voice } = setup({ filler, speak: async text => { log.push('answer:' + text); } });
  turn(voice); await tick();
  voice.observe([reply('a20')]); await tick();
  assert.deepEqual(log, ['filler:start', 'filler:cut', 'answer:A spoken answer.']); voice.stop();
});

test('a filler plays on while the answer is made, and yields when the answer can be heard, not when its text arrives', async () => {
  const { filler, log } = fillers(); const made = deferred<void>();
  const { voice } = setup({ filler, synthesize: async () => { await made.promise; return async () => { log.push('answer'); }; } });
  turn(voice); await tick();
  voice.observe([reply('a20')]); await tick();
  assert.deepEqual(log, ['filler:start']);
  made.resolve(); await tick();
  assert.deepEqual(log, ['filler:start', 'filler:cut', 'answer']); voice.stop();
});

test('a filler whose player does not answer is not waited for', async () => {
  const log: string[] = [];
  const { voice } = setup({ filler: () => new Promise<void>(() => {}), speak: async () => { log.push('answer'); } });
  turn(voice); await tick();
  voice.observe([reply('a20')]); await tick();
  assert.deepEqual(log, []);
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.deepEqual(log, ['answer']); voice.stop();
});

test('talking over a filler cuts it at once, and the turn that follows does not get one at the same moment', async () => {
  const { filler, log } = fillers();
  const { voice } = setup({ filler });
  turn(voice); await tick();
  voice.speechStart();
  assert.deepEqual(log, ['filler:start', 'filler:cut']);
  voice.speechEnd(new Float32Array(16000)); await tick();
  // The last thing heard was a filler: the next turn's first comes after a gap, not on top of it.
  assert.deepEqual(log, ['filler:start', 'filler:cut']); voice.stop();
});

test('the first filler of a turn that follows another is not at once, and is again once an answer has been heard', async () => {
  const { filler, log } = fillers(); const spoken: string[] = [];
  const { voice } = setup({ filler, speak: async text => { spoken.push(text); } });
  turn(voice); await tick();
  turn(voice); await tick();
  assert.equal(log.filter(entry => entry === 'filler:start').length, 1);
  voice.observe([reply('a20')]); await tick();
  assert.deepEqual(spoken, ['A spoken answer.']);
  turn(voice); await tick();
  assert.equal(log.filter(entry => entry === 'filler:start').length, 2); voice.stop();
});

test('there is no spoken "let me think" line any more, in any words: what fills a long silence is fillers', async () => {
  const { filler } = fillers();
  const { voice, spoken } = setup({ filler, agentRunning: () => true });
  turn(voice); await tick();
  voice.observe([reply('a10')]); await tick();
  await new Promise(resolve => setTimeout(resolve, 2100));
  assert.deepEqual(spoken, []); voice.stop();
});

test('with status speech off, or in the sequential baseline, there are no fillers', async () => {
  for (const patch of [{ statusSpeech: false }, { sequential: true }]) {
    const { filler, log } = fillers();
    const { voice, sent } = setup({ filler, ...patch });
    turn(voice); await tick();
    assert.deepEqual(sent, ['hello']); assert.deepEqual(log, [], JSON.stringify(patch)); voice.stop();
  }
});

test('nothing to play is not an error, and the next turn tries again; a filler that fails is not reported', async () => {
  let ready = false, asked = 0;
  const { voice, errors } = setup({ filler: () => { asked++; return ready ? Promise.reject(new Error('no audio')) : undefined; } });
  turn(voice); await tick();
  ready = true;
  turn(voice); await tick(); await tick();
  assert.equal(asked, 2); assert.deepEqual(errors, []); voice.stop();
});

test('ending voice cuts a filler, and the phase says speaking only while it plays', async () => {
  const { filler, log } = fillers(); const phases: string[] = [];
  const { voice } = setup({ filler, phase: phase => phases.push(phase), agentRunning: () => true });
  turn(voice); await tick();
  assert.equal(phases.at(-1), 'Speaking');
  voice.stop();
  assert.deepEqual(log, ['filler:start', 'filler:cut']);
});

// A long wait: the silence is filled again and again, on a clock that only moves when told to.
const pacing: FillerPacing = { gaps: [1000, 2000, 4000], max: 4, jitter: 0 };
/** Fillers that play for `length` ms of that clock, and what happened to them when. */
function timeline(t: TestContext, length = 500) {
  t.mock.timers.reset(); t.mock.timers.enable({ apis: ['setTimeout'] });
  const log: { at: number; e: string }[] = []; let now = 0;
  const filler = (signal: AbortSignal) => {
    log.push({ at: now, e: 'start' });
    return new Promise<void>(resolve => {
      const timer = setTimeout(() => { log.push({ at: now, e: 'end' }); resolve(); }, length);
      signal.addEventListener('abort', () => { clearTimeout(timer); log.push({ at: now, e: 'cut' }); resolve(); }, { once: true });
    });
  };
  const advance = async (ms: number) => { for (let done = 0; done < ms; done += 100) { now += 100; t.mock.timers.tick(100); await tick(); await tick(); } };
  const starts = () => log.filter(entry => entry.e === 'start').map(entry => entry.at);
  return { filler, log, advance, starts };
}

test('a long wait is filled again and again, with growing gaps after each filler has ended, and no more after the last', async t => {
  const { filler, advance, starts } = timeline(t);
  const { voice } = setup({ filler, agentRunning: () => true, fillerPacing: pacing });
  turn(voice); await tick();
  await advance(60_000);
  // Each filler lasts 500 ms; the gaps after it are 1, 2 and 4 seconds; four are the most.
  assert.deepEqual(starts(), [0, 1500, 4000, 8500]);
  voice.stop();
});

test('the fillers of a long wait stop when the answer is heard, whether one is playing or the wait is between two', async t => {
  // Heard while one is playing: it is cut, and no more come.
  const playing = timeline(t, 5000);
  const a = setup({ filler: playing.filler, agentRunning: () => true, fillerPacing: pacing });
  turn(a.voice); await tick();
  await playing.advance(1000);
  a.voice.observe([reply('a20')]); await tick(); await tick();
  assert.deepEqual(playing.log.map(entry => entry.e), ['start', 'cut']);
  assert.deepEqual(a.spoken, ['A spoken answer.']);
  await playing.advance(60_000);
  assert.deepEqual(playing.starts(), [0]);
  a.voice.stop();
  // Heard in the gap after the first: the second never comes.
  const gap = timeline(t, 500);
  const b = setup({ filler: gap.filler, agentRunning: () => true, fillerPacing: pacing });
  turn(b.voice); await tick();
  await gap.advance(800);
  b.voice.observe([reply('a20')]); await tick(); await tick();
  await gap.advance(60_000);
  assert.deepEqual(gap.starts(), [0]);
  assert.deepEqual(b.spoken, ['A spoken answer.']);
  b.voice.stop();
});

test('the answer is never heard over a filler of a long wait: it starts once the one playing has been cut', async t => {
  const { filler, log, advance } = timeline(t, 5000);
  const events: string[] = [];
  const { voice } = setup({ filler, agentRunning: () => true, fillerPacing: pacing, speak: async () => { events.push(`answer after ${log.map(entry => entry.e).join(',')}`); } });
  turn(voice); await tick();
  await advance(1000);
  voice.observe([reply('a20')]); await tick(); await tick();
  assert.deepEqual(events, ['answer after start,cut']);
  voice.stop();
});

test('speech, compaction, an agent that has finished, or the end of voice mode stop the fillers of a wait', async t => {
  for (const [name, end] of [
    ['speech', (voice: HandsFreeVoice) => voice.speechStart()],
    ['compaction', (voice: HandsFreeVoice) => voice.setCompacting(true)],
    ['stop', (voice: HandsFreeVoice) => voice.stop()],
  ] as const) {
    const line = timeline(t, 300);
    let running = true;
    const { voice } = setup({ filler: line.filler, agentRunning: () => running, fillerPacing: pacing });
    turn(voice); await tick();
    await line.advance(1500);
    assert.deepEqual(line.starts(), [0, 1300], name);
    end(voice); await tick();
    await line.advance(60_000);
    assert.deepEqual(line.starts(), [0, 1300], name);
    voice.stop();
  }
  // An agent that has finished without a word has nothing left to wait for.
  const line = timeline(t, 300); let running = true;
  const { voice } = setup({ filler: line.filler, agentRunning: () => running, fillerPacing: pacing });
  turn(voice); await tick();
  await line.advance(1500);
  running = false;
  await line.advance(60_000);
  assert.deepEqual(line.starts(), [0, 1300]);
  voice.stop();
});

test('a wait where no clip is ready yet tries again after a gap, and the tries count towards the most', async t => {
  t.mock.timers.reset(); t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = 0, asked: number[] = [];
  const advance = async (ms: number) => { for (let done = 0; done < ms; done += 100) { now += 100; t.mock.timers.tick(100); await tick(); await tick(); } };
  const { voice, errors } = setup({ agentRunning: () => true, fillerPacing: pacing, filler: () => { asked.push(now); return undefined; } });
  turn(voice); await tick();
  await advance(60_000);
  assert.deepEqual(asked, [0, 1000, 3000, 7000]); assert.deepEqual(errors, []);
  voice.stop();
});

test('the gaps are not a clock: each varies at random within the pacing, and the default pacing grows and ends', async t => {
  assert.ok(FILLER_PACING.gaps.every((gap, i) => i === 0 || gap > FILLER_PACING.gaps[i - 1]), 'the gaps grow');
  assert.ok(FILLER_PACING.max >= 3 && FILLER_PACING.max <= 8, 'a few, and not for ever');
  for (const [random, gap] of [[0, 500], [1, 1500]] as const) {
    t.mock.method(Math, 'random', () => random);
    const { filler, advance, starts } = timeline(t, 100);
    const { voice } = setup({ filler, agentRunning: () => true, fillerPacing: { gaps: [1000], max: 2, jitter: 0.5 } });
    turn(voice); await tick();
    await advance(5000);
    assert.deepEqual(starts(), [0, 100 + gap]);
    voice.stop();
    t.mock.restoreAll();
  }
  // With the pacing it ships with, a minute of waiting is filled with several fillers, further and further apart.
  t.mock.method(Math, 'random', () => 0.5);
  const { filler, advance, starts } = timeline(t, 1500);
  const { voice } = setup({ filler, agentRunning: () => true });
  turn(voice); await tick();
  await advance(120_000);
  const at = starts();
  assert.equal(at.length, FILLER_PACING.max);
  const spacing = at.slice(1).map((time, i) => time - at[i]);
  assert.ok(spacing.every((gap, i) => i === 0 || gap > spacing[i - 1]), `spacing ${spacing}`);
  voice.stop();
});

test('after a filler that nothing followed the next turn waits the first gap for its own, and after an answer it does not', async t => {
  const first = timeline(t, 300);
  const a = setup({ filler: first.filler, agentRunning: () => true, fillerPacing: pacing });
  turn(a.voice); await tick();
  await first.advance(500);
  turn(a.voice); await tick();
  await first.advance(900);
  // Not at once, as the one before was the last thing heard.
  assert.deepEqual(first.starts(), [0]);
  await first.advance(300);
  assert.deepEqual(first.starts(), [0, 1500]);
  a.voice.stop();
  const second = timeline(t, 300);
  const b = setup({ filler: second.filler, agentRunning: () => true, fillerPacing: pacing });
  turn(b.voice); await tick();
  await second.advance(500);
  b.voice.observe([reply('a20')]); await tick(); await tick();
  assert.deepEqual(b.spoken, ['A spoken answer.']);
  turn(b.voice); await tick();
  assert.deepEqual(second.starts(), [0, 500]);
  b.voice.stop();
});

test('an answer that is being made into speech does not end the fillers: they go on until it is audible', async t => {
  const line = timeline(t, 300); const gate = deferred<void>(); const spoken: string[] = [];
  const { voice } = setup({ filler: line.filler, agentRunning: () => true, fillerPacing: pacing, synthesize: async text => { await gate.promise; return async () => { spoken.push(text); }; } });
  turn(voice); await tick();
  // The text of the answer is there, its audio is not: a long first sentence, or a speech runtime that is busy.
  voice.observe([reply('a20')]); await tick();
  await line.advance(3700);
  assert.deepEqual(line.starts(), [0, 1300, 3600]);
  gate.resolve(); await tick(); await tick();
  assert.deepEqual(spoken, ['A spoken answer.']);
  assert.equal(line.log.at(-1)?.e, 'cut');
  await line.advance(60_000);
  assert.deepEqual(line.starts(), [0, 1300, 3600]);
  voice.stop();
});
