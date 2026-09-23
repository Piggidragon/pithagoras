import { TimeStretch, stretch } from "./time-stretch";

/**
 * How a phrase is played: `rate` makes it faster without raising the voice
 * (see time-stretch.ts), and `record` is given the phrase's samples as they
 * were spoken, before any of that, so a reply can be played again later at
 * whatever speed is chosen then.
 */
export interface SpeechOptions { rate?: number; record?: (samples: Float32Array) => void }

const samplesOf = (bytes: Uint8Array, count: number) => {
  const samples = new Float32Array(count), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < count; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
  return samples;
};

/** A buffer holding `samples`, or none for none: a zero-length AudioBuffer is an error. */
export function bufferOf(audio: BaseAudioContext, samples: Float32Array, sampleRate = 24000): AudioBuffer | undefined {
  if (!samples.length) return undefined;
  const buffer = audio.createBuffer(1, samples.length, sampleRate);
  buffer.getChannelData(0).set(samples);
  return buffer;
}

/** Buffer one spoken phrase so slower-than-realtime synthesis cannot interrupt words. */
export async function readPcmStream(
  body: ReadableStream<Uint8Array>, audio: AudioContext, signal: AbortSignal, options: SpeechOptions = {},
): Promise<AudioBuffer> {
  signal.throwIfAborted();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const cancelRead = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancelRead, { once: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      chunks.push(value); length += value.length;
    }
  } finally {
    signal.removeEventListener('abort', cancelRead);
    await reader.cancel().catch(() => {}); reader.releaseLock();
  }
  if (!length || length % 2) throw new Error('Breeze returned incomplete PCM audio');
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const samples = samplesOf(bytes, length / 2);
  options.record?.(samples);
  const buffer = bufferOf(audio, stretch(samples, options.rate ?? 1));
  if (!buffer) throw new Error('Breeze returned incomplete PCM audio');
  signal.throwIfAborted();
  return buffer;
}

export async function playAudioBuffer(buffer: AudioBuffer, audio: AudioContext, destination: AudioNode, signal: AbortSignal, onStarted: (scheduledAt?:number) => void): Promise<void> {
  signal.throwIfAborted();
  const source = audio.createBufferSource(); source.buffer = buffer; source.connect(destination);
  await new Promise<void>((resolve, reject) => {
    const finish = () => { signal.removeEventListener('abort', cancel); source.disconnect(); resolve(); };
    const cancel = () => { source.onended = null; source.stop(); signal.removeEventListener('abort', cancel); source.disconnect(); reject(signal.reason); };
    source.onended = finish;
    signal.addEventListener('abort', cancel, { once: true });
    source.start(); onStarted(audio.currentTime);
    if (signal.aborted) cancel();
  });
}

/** Combined helper for consumers that only have one phrase. */
export async function playPcmStream(body: ReadableStream<Uint8Array>, audio: AudioContext, destination: AudioNode, signal: AbortSignal, onStarted: (scheduledAt?:number) => void, options: SpeechOptions = {}): Promise<void> {
  const buffer = await readPcmStream(body, audio, signal, options);
  await playAudioBuffer(buffer, audio, destination, signal, onStarted);
}

/** Start from a small PCM cushion while the producer continues generating. */
export async function preparePcmSpeech(body: ReadableStream<Uint8Array>, audio: AudioContext, signal: AbortSignal, options: SpeechOptions = {}) {
  const reader = body.getReader();
  const stretcher = new TimeStretch(options.rate ?? 1);
  let spoken = 0;
  const pending: AudioBuffer[] = [];
  const sources = new Set<AudioBufferSourceNode>();
  let destination: AudioNode | undefined, nextTime = 0, finished = false, carry: number | undefined;
  let buffered = 0, started = false;
  let ready!: () => void, rejectReady!: (error: unknown) => void;
  const initial = new Promise<void>((resolve, reject) => { ready = resolve; rejectReady = reject; });
  let finishPlay!: () => void, failPlay!: (error: unknown) => void;
  let onStarted: (scheduledAt?:number)=>void = () => {};
  const pump = () => {
    if (!destination || signal.aborted) return;
    for (const buffer of pending.splice(0)) {
      const source = audio.createBufferSource(); source.buffer = buffer; source.connect(destination);
      sources.add(source);
      source.onended = () => { sources.delete(source); source.disconnect(); if (finished && !sources.size) finishPlay(); };
      nextTime = Math.max(nextTime, audio.currentTime + 0.04);
      const scheduledAt=nextTime; source.start(nextTime); nextTime += buffer.duration;
      if (!started) { started = true; onStarted(scheduledAt); }
    }
    if (finished && !sources.size) finishPlay();
  };
  const cancel = () => {
    void reader.cancel().catch(() => {});
    for (const source of sources) { source.onended = null; source.stop(); source.disconnect(); }
    sources.clear(); rejectReady(signal.reason); failPlay?.(signal.reason);
  };
  signal.addEventListener('abort', cancel, { once: true });
  const completed = (async () => {
    try {
      signal.throwIfAborted();
      while (true) {
        const { done, value } = await reader.read(); signal.throwIfAborted();
        if (done) break;
        const bytes = new Uint8Array(value.length + (carry === undefined ? 0 : 1));
        if (carry !== undefined) bytes[0] = carry;
        bytes.set(value, carry === undefined ? 0 : 1);
        carry = bytes.length % 2 ? bytes[bytes.length - 1] : undefined;
        const count = Math.floor(bytes.length / 2);
        if (!count) continue;
        const samples = samplesOf(bytes, count);
        spoken += count; options.record?.(samples);
        const buffer = bufferOf(audio, stretcher.push(samples));
        if (!buffer) continue;
        pending.push(buffer); buffered += buffer.duration;
        if (buffered >= 0.65) ready();
        pump();
      }
      if (!spoken || carry !== undefined) throw new Error('Breeze returned incomplete PCM audio');
      const rest = bufferOf(audio, stretcher.flush());
      if (rest) { pending.push(rest); buffered += rest.duration; }
      finished = true; ready(); pump();
    } catch (error) { rejectReady(error); failPlay?.(error); throw error; }
    finally { reader.releaseLock(); }
  })();
  // The pipeline observes completion after this function has returned.
  void completed.catch(() => {});
  try { await initial; } catch (error) { signal.removeEventListener('abort', cancel); throw error; }
  return { completed, play: async (output: AudioNode, notify: (scheduledAt?:number) => void) => {
    signal.throwIfAborted();
    try {
      await new Promise<void>((resolve, reject) => { finishPlay = resolve; failPlay = reject; destination = output; onStarted = notify; pump(); });
    } finally { signal.removeEventListener('abort', cancel); }
  } };
}
