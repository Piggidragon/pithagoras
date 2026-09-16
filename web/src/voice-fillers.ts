/** Wordless murmurs that read naturally in every voice language. */
export const FILLER_PHRASES = ["Hmm.", "Hmm...", "Mhm.", "Uhm..."];

/** Quiet enough to sit under the conversation rather than read as a reply. */
const FILLER_GAIN = 0.8;

/** Drop the leading and trailing silence TTS pads short phrases with. */
export function trimSilence(samples: Float32Array<ArrayBuffer>, sampleRate: number, threshold = 0.01, padMs = 40): Float32Array<ArrayBuffer> {
  let start = 0, end = samples.length;
  while (start < end && Math.abs(samples[start]) < threshold) start++;
  while (end > start && Math.abs(samples[end - 1]) < threshold) end--;
  if (start >= end) return new Float32Array(0);
  const pad = Math.round(sampleRate * padMs / 1000);
  return samples.slice(Math.max(0, start - pad), Math.min(samples.length, end + pad));
}

/**
 * Pre-rendered thinking murmurs in the session's own voice. Rendering them
 * once while the conversation starts keeps the GPU free while the model reasons.
 */
export class FillerSounds {
  private clips: AudioBuffer[] = [];
  private last = -1;
  constructor(private audio: AudioContext, private render: (text: string, signal: AbortSignal) => Promise<AudioBuffer>) {}
  get ready() { return this.clips.length > 0; }
  /** Render sequentially; a failed murmur is skipped rather than reported. */
  async prepare(signal: AbortSignal) {
    for (const text of FILLER_PHRASES) {
      if (signal.aborted) return;
      try {
        const buffer = await this.render(text, signal);
        const samples = trimSilence(buffer.getChannelData(0), buffer.sampleRate);
        // A murmur that renders as silence or a full sentence is not a filler.
        if (!samples.length || samples.length > buffer.sampleRate * 2) continue;
        const clip = this.audio.createBuffer(1, samples.length, buffer.sampleRate);
        clip.copyToChannel(samples, 0);
        this.clips.push(clip);
      } catch { if (signal.aborted) return; }
    }
  }
  /** Play a murmur other than the previous one; resolves when it ends. */
  async play(signal: AbortSignal) {
    if (!this.clips.length || signal.aborted || this.audio.state !== "running") return;
    const candidates = this.clips.map((_, i) => i).filter(i => i !== this.last || this.clips.length === 1);
    this.last = candidates[Math.floor(Math.random() * candidates.length)];
    const source = this.audio.createBufferSource(), gain = this.audio.createGain();
    source.buffer = this.clips[this.last]; gain.gain.value = FILLER_GAIN;
    source.connect(gain); gain.connect(this.audio.destination);
    await new Promise<void>(resolve => {
      const finish = () => { signal.removeEventListener("abort", cancel); source.disconnect(); gain.disconnect(); resolve(); };
      // Fade instead of clicking when barge-in cuts a murmur short.
      const cancel = () => { gain.gain.setTargetAtTime(0, this.audio.currentTime, 0.015); source.stop(this.audio.currentTime + 0.06); };
      source.onended = finish;
      signal.addEventListener("abort", cancel, { once: true });
      source.start();
    });
  }
}
