export type PreparedSpeech = ((signal: AbortSignal) => Promise<void>) & { completed?: Promise<void> };
type Run = { controller: AbortController; text: {text:string;kind:'reply'|'status'}[]; audio: PreparedSpeech[]; generating: boolean; playing: boolean };

/** One TTS producer and one audio consumer, running independently in sentence order. */
export class SpeechPipeline {
  private run = this.fresh();
  constructor(
    private synthesize: (text: string, signal: AbortSignal, kind?:'reply'|'status') => Promise<PreparedSpeech>,
    private changed: () => void,
    private error: (error: unknown) => void,
    private sequential = false,
    private sentenceBySentence = false,
    private prefetch = false,
  ) {}
  private fresh(): Run { return { controller: new AbortController(), text: [], audio: [], generating: false, playing: false }; }
  get busy() { const r = this.run; return !!(r.generating || r.playing || r.text.length || r.audio.length); }
  enqueue(text: string[],kind:'reply'|'status'='reply') { this.run.text.push(...text.map(text=>({text,kind})));  this.pump(this.run); }
  cancel() {
    const previous = this.run;
    this.run = this.fresh();
    previous.text = []; previous.audio = []; previous.controller.abort();
    this.changed();
  }
  private fail(run: Run, error: unknown) {
    if (run !== this.run || run.controller.signal.aborted) return;
    this.cancel(); this.error(error);
  }
  private pump(run: Run) {
    if (run !== this.run || run.controller.signal.aborted) return;
    const signal = run.controller.signal;
    if (!run.playing && run.audio.length && (!this.sequential || this.prefetch || (!run.generating && (this.sentenceBySentence || !run.text.length)))) {
      const play = run.audio.shift()!;
      run.playing = true;
      void (async () => {
        try { await play(signal); }
        catch (error) { this.fail(run, error); }
        finally { run.playing = false; if (run === this.run) this.pump(run); }
      })();
    }
    if (run !== this.run) return;
    // Keep at most two completed phrases ahead of playback. Breeze itself has
    // one GPU request slot; overlapping playback needs no additional GPU slot.
    if (!run.generating && (this.sequential && !this.prefetch ? !run.playing : run.audio.length < 2) && run.text.length) {
      const {text,kind} = run.text.shift()!;
      run.generating = true;
      void (async () => {
        try {
          const prepared = await this.synthesize(text, signal,kind);
          if (this.sequential) await prepared.completed;
          if (run === this.run && !signal.aborted) { run.audio.push(prepared); this.pump(run); }
          await prepared.completed;
        } catch (error) { this.fail(run, error); }
        finally { run.generating = false; if (run === this.run) this.pump(run); }
      })();
    }
    this.changed();
  }
}
