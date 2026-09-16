import { SpeechPipeline, type PreparedSpeech } from "./speech-pipeline";
import type { Item } from "./transcript";
import { StreamingSpeech } from "./voice";

export const THINKING_PHRASES = [
  "Let me think about that for a moment.",
  "Give me a moment to think this through.",
  "Let me consider that.",
  "I’m thinking through your request.",
  "Let me take a moment with that.",
];

export const COMPACTION_PHRASES = [
  "My context is getting full. Let me quickly compact our conversation before I continue.",
  "I need a little room in my context. Let me summarize our conversation, then I'll carry on.",
  "Let me do a quick context compaction so I can keep going.",
];
/** First murmur after this long in a thinking turn; later gaps grow up to the cap. */
export const FILLER_FIRST_MS = 3500;
export const FILLER_GAP_MS = 4500;
export const FILLER_MAX_MS = 25000;
export type VoicePhase = "Listening" | "Hearing you" | "Transcribing" | "Thinking" | "Compacting context" | "Speaking";
export interface VoiceIO {
  sequential?: boolean;
  sentenceChunks?: boolean;
  ttsPrefetch?: boolean;
  statusSpeech?: boolean;
  transcribe: (samples: Float32Array, signal: AbortSignal) => Promise<string>;
  send: (text: string) => Promise<void>;
  abort: () => Promise<void>;
  agentRunning: () => boolean;
  synthesize: (text: string, signal: AbortSignal, kind?:'reply'|'status') => Promise<PreparedSpeech>;
  /** Plays a short pre-rendered murmur during long thinking; resolves when it ends. */
  filler?: (signal: AbortSignal) => Promise<void>;
  trace?: (name:string)=>void;
  phase: (phase: VoicePhase) => void;
  error: (message: string) => void;
}

/** Coordinates microphone turns independently of React renders and network timing. */
export class HandsFreeVoice {
  private alive = true;
  private hearing = false;
  private muted = false;
  private inputGeneration = 0;
  private acceptingReplies = true;
  private items: Item[] = [];
  private speech: StreamingSpeech;
  private recordings: Float32Array[] = [];
  private text: string[] = [];
  private processing = false;
  private output: string[] = [];
  private pipeline: SpeechPipeline;
  private thinkingPipeline: SpeechPipeline;
  private compacting = false;
  private compactionSpeech = false;
  private lastCompactionWaitAt = -Infinity;
  private transcription = new AbortController();
  private operations: Promise<void> = Promise.resolve();
  private sending = false;
  private thinkingTimer?: ReturnType<typeof setTimeout>;
  private thinkingAnnounced = false;
  private lastThinkingAt = -Infinity;
  private lastThinkingPhrase = -1;
  private fillerTimer?: ReturnType<typeof setTimeout>;
  private fillerPlayback?: AbortController;
  private fillersThisTurn = 0;
  private clearThinkingTimer() { clearTimeout(this.thinkingTimer); this.thinkingTimer = undefined; }
  private clearFillers() {
    clearTimeout(this.fillerTimer); this.fillerTimer = undefined;
    this.fillerPlayback?.abort(); this.fillerPlayback = undefined;
  }
  private fillerAllowed() {
    return !!this.io.filler && this.io.statusSpeech !== false && !this.io.sequential && this.alive && !this.compacting && !this.hearing
      && this.acceptingReplies && !this.output.length && !this.pipeline.busy && !this.thinkingPipeline.busy && (this.io.agentRunning() || this.sending);
  }
  private scheduleFiller() {
    if (!this.fillerAllowed()) { clearTimeout(this.fillerTimer); this.fillerTimer = undefined; return; }
    if (this.fillerTimer || this.fillerPlayback) return;
    // Space murmurs further apart the longer the model reasons, with jitter so
    // they do not tick like a metronome.
    const base = Math.min(FILLER_MAX_MS, this.fillersThisTurn ? FILLER_GAP_MS * (1 + this.fillersThisTurn) : FILLER_FIRST_MS);
    this.fillerTimer = setTimeout(() => {
      this.fillerTimer = undefined;
      if (!this.fillerAllowed()) return;
      const playback = new AbortController(); this.fillerPlayback = playback;
      this.fillersThisTurn++;
      this.io.trace?.('filler');
      void this.io.filler!(playback.signal).catch(() => {}).finally(() => {
        if (this.fillerPlayback === playback) { this.fillerPlayback = undefined; this.state(); }
      });
    }, base * (0.8 + Math.random() * 0.4));
  }


  constructor(private io: VoiceIO, initial: Item[]) {
    const afterSeq = initial.reduce((n, item) => Math.max(n, Number(item.id.slice(1)) || 0), 0);
    this.pipeline = new SpeechPipeline(io.synthesize, () => this.state(), error => this.report(error), io.sequential, io.sentenceChunks, io.ttsPrefetch);
    this.thinkingPipeline = new SpeechPipeline(io.synthesize, () => this.state(), error => this.report(error));
    this.speech = new StreamingSpeech(afterSeq);
    this.items = initial;
    this.ignoreCurrent();
    io.phase("Listening");
  }
  private ignoreCurrent() {
    this.speech.ignore(this.items);
  }
  private report(error: unknown) {
    if (this.alive) this.io.error(error instanceof Error ? error.message : String(error));
  }
  private state() {
    if (!this.alive) return;
    const phase = this.hearing ? "Hearing you" : this.compacting ? "Compacting context" : this.processing && !this.sending ? "Transcribing" : this.pipeline.busy || this.thinkingPipeline.busy ? "Speaking" : this.io.agentRunning() || this.sending ? "Thinking" : "Listening";
    this.io.phase(phase);
    this.scheduleFiller();
    if (this.io.statusSpeech === false || this.io.sequential || phase !== "Thinking" || !this.acceptingReplies || this.output.length) this.clearThinkingTimer();
    else if (!this.thinkingAnnounced && !this.thinkingTimer && Date.now() - this.lastThinkingAt >= 20000) {
      this.thinkingTimer = setTimeout(() => {
        this.thinkingTimer = undefined;
        if (!this.alive || this.compacting || this.hearing || !this.acceptingReplies || this.pipeline.busy || this.fillerPlayback || this.output.length || !(this.io.agentRunning() || this.sending)) return;
        this.thinkingAnnounced = true; this.lastThinkingAt = Date.now();
        const candidates = THINKING_PHRASES.map((_, i) => i).filter(i => i !== this.lastThinkingPhrase);
        this.lastThinkingPhrase = candidates[Math.floor(Math.random() * candidates.length)];
        this.thinkingPipeline.enqueue([THINKING_PHRASES[this.lastThinkingPhrase]],'status');
      }, 1800);
    }
  }
  setCompacting(active: boolean, completed = true) {
    if (!this.alive || active === this.compacting) return;
    this.compacting = active;
    this.clearThinkingTimer();
    if (active) this.clearFillers();
    if (this.io.statusSpeech === false || this.io.sequential) { this.state(); return; }
    if (active) {
      this.lastCompactionWaitAt = -Infinity;
      this.thinkingPipeline.cancel();
      if (!this.hearing && this.acceptingReplies) this.pipeline.enqueue([COMPACTION_PHRASES[Math.floor(Math.random() * COMPACTION_PHRASES.length)]],'status');
    } else this.pipeline.enqueue([completed ? "Context compaction is done. I'm ready to continue." : "Context compaction stopped before it finished."],'status');
    this.state();
  }
  observe(items: Item[]) {
    this.items = items;
    if (!this.alive) return;
    if (!this.acceptingReplies) this.ignoreCurrent();
    else if (!this.io.sequential || this.io.sentenceChunks || !this.io.agentRunning()) this.output.push(...this.speech.observe(items));
    this.state();
    void this.play();
  }
  /** Called after a sustained speech detection, not a single noise frame. */
  speechStart() {
    if (!this.alive || this.muted) return;
    if (this.compacting) {
      this.compactionSpeech = true;
      if (this.io.statusSpeech !== false && !this.io.sequential && Date.now() - this.lastCompactionWaitAt >= 8000) {
        this.lastCompactionWaitAt = Date.now();
        this.pipeline.enqueue(["I'm still compacting our conversation. Please wait a moment; I'll let you know when I'm ready."],'status');
      }
      return;
    }
    this.clearThinkingTimer();
    this.clearFillers();
    this.hearing = true;
    this.acceptingReplies = false;
    this.ignoreCurrent();
    this.output = [];
    this.pipeline.cancel();
    this.thinkingPipeline.cancel();
    // Serialize abort behind an in-flight send so it cannot miss that new run.
    if (this.io.agentRunning() || this.sending) {
      this.operations = this.operations.then(async () => { if (this.alive) await this.io.abort(); });
      void this.operations.catch(error => this.report(error));
    }
    this.state();
  }
  speechEnd(samples: Float32Array) {
    if (!this.alive || this.muted) return;
    if (this.compacting || this.compactionSpeech) { this.compactionSpeech = false; return; }
    this.hearing = false;
    this.recordings.push(samples);
    void this.process();
  }
  private async process() {
    if (this.processing || !this.alive) return;
    const generation = this.inputGeneration;
    const valid = () => this.alive && this.inputGeneration === generation;
    this.processing = true;
    this.state();
    try {
      while (this.recordings.length && valid()) {
        const text = await this.io.transcribe(this.recordings.shift()!, this.transcription.signal);
        if (!valid()) return;
        if (text.trim()) this.text.push(text.trim());
      }
      // If speech resumes during transcription, retain the text and combine it
      // with the next segment instead of sending half a thought or losing it.
      if (this.hearing || !this.text.length) return;
      const text = this.text.join(" ");
      const send = this.operations.then(async () => {
        if (!valid() || this.hearing || this.recordings.length) return;
        this.ignoreCurrent();
        this.acceptingReplies = true;
        this.sending = true;
        this.thinkingAnnounced = false;
        this.fillersThisTurn = 0;
        this.state();
        try {
          await this.io.send(text);
          if (valid()) this.text = [];
        } catch (error) {
          this.acceptingReplies = false;
          throw new Error(`Could not send “${text}”: ${error instanceof Error ? error.message : error}`);
        } finally { this.sending = false; }
      });
      this.operations = send;
      await send;
    } catch (error) {
      if (valid()) this.report(error);
      // A failed command is reported, but must not poison subsequent turns.
      this.operations = Promise.resolve();
    } finally {
      this.processing = false;
      this.state();
      if (this.alive && this.recordings.length) void this.process();
      else void this.play();
    }
  }
  private play() {
    if (!this.alive || this.hearing || !this.acceptingReplies || !this.output.length || (this.io.sequential && !this.io.sentenceChunks && this.io.agentRunning())) return;
    const text = this.output; this.output = [];
    this.thinkingPipeline.cancel();
    this.io.trace?.('reply_chunk');
    this.pipeline.enqueue(text);
  }
  /** Mute is input-only: keep the agent and its spoken output running. */
  setMuted(muted: boolean) {
    this.muted = muted;
    if (muted) {
      this.inputGeneration++;
      this.hearing = false;
      this.recordings = [];
      this.text = [];
      this.transcription.abort();
      this.transcription = new AbortController();
      this.acceptingReplies = true;
    }
    this.state();
    void this.play();
  }
  stop() {
    this.alive = false;
    this.clearThinkingTimer();
    this.clearFillers();
    this.pipeline.cancel();
    this.thinkingPipeline.cancel();
    this.transcription.abort();
    this.output = [];
    this.recordings = [];
    this.text = [];
  }
}
