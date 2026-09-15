import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preparePcmSpeech } from '../web/src/pcm-stream.js';
const tick = () => new Promise(resolve => setImmediate(resolve));
function audio() {
  const sources: any[] = [];
  return { sources, context: {
    currentTime: 1,
    createBuffer: (_channels: number, count: number, rate: number) => ({ duration: count / rate, getChannelData: () => new Float32Array(count) }),
    createBufferSource: () => {
      const source = { buffer: null, onended: null as any, stopped: false, at: 0,
        connect() {}, disconnect() {}, start(at: number) { this.at = at; }, stop() { this.stopped = true; } };
      sources.push(source); return source;
    },
  } as unknown as AudioContext };
}
test('PCM starts before generation ends and schedules incoming chunks contiguously', async () => {
  const { context, sources } = audio(); const abort = new AbortController();
  let writer!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(c) { writer = c; } });
  const ready = preparePcmSpeech(body, context, abort.signal);
  writer.enqueue(new Uint8Array(32001)); // also exercise split 16-bit samples
  const speech = await ready;
  let generated = false; void speech.completed.then(() => { generated = true; });
  let started = false;
  const playing = speech.play({} as AudioNode, () => { started = true; });
  assert.equal(started, true); assert.equal(generated, false);
  writer.enqueue(new Uint8Array(15999)); await tick();
  assert.equal(sources.length, 2);
  assert.equal(sources[1].at, sources[0].at + sources[0].buffer.duration);
  writer.close(); await speech.completed;
  for (const source of sources) source.onended();
  await playing;
});
test('barge-in cancels both streaming reads and scheduled audio', async () => {
  const { context, sources } = audio(); const abort = new AbortController(); let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(32000)); }, cancel() { cancelled = true; } });
  const speech = await preparePcmSpeech(body, context, abort.signal);
  const playing = speech.play({} as AudioNode, () => {});
  abort.abort(new Error('interrupted'));
  await assert.rejects(playing, /interrupted/);
  await assert.rejects(speech.completed, /interrupted/);
  assert.equal(cancelled, true); assert.ok(sources.every(s => s.stopped));
});
