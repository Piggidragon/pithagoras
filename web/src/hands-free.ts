import { SpeechPipeline, type PreparedSpeech } from "./speech-pipeline";
import type { Item } from "./transcript";
import { StreamingSpeech } from "./voice";
import { pick, statusPhrases, type FillerKind } from "./voice-phrases";
import type { ToolKind } from "./tool-kind";

/** First filler after this long in a thinking turn; later gaps grow up to the cap. */
export const FILLER_FIRST_MS = 3500;
export const FILLER_GAP_MS = 4500;
export const FILLER_MAX_MS = 25000;
/** A tool that finishes sooner than this is not worth announcing. */
export const TOOL_FILLER_DELAY_MS = 1200;
/** Skip a tool announcement right after the agent itself spoke, which often already said what it is about to do. */
export const TOOL_FILLER_QUIET_MS = 4000;
export type VoicePhase = "Listening" | "Hearing you" | "Transcribing" | "Thinking" | "Compacting context" | "Speaking";
export interface VoiceIO {
  sequential?: boolean;
  sentenceChunks?: boolean;
  ttsPrefetch?: boolean;
  statusSpeech?: boolean;
  /** Language for spoken status notices; see voice-phrases. */
  language?: string;
  transcribe: (samples: Float32Array, signal: AbortSignal) => Promise<string>;
  send: (text: string) => Promise<void>;
  abort: () => Promise<void>;
  agentRunning: () => boolean;
  synthesize: (text: string, signal: AbortSignal, kind?:'reply'|'status') => Promise<PreparedSpeech>;
  /** Plays a pre-rendered filler and resolves when it ends; undefined when none of that kind is ready. */
  filler?: (kind: FillerKind, signal: AbortSignal) => Promise<void> | undefined;
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
  private lastThinkingPhrase?: string;
  private fillerTimer?: ReturnType<typeof setTimeout>;
  private fillerPlayback?: AbortController;
  private fillersThisTurn = 0;
  private tool?: ToolKind;
  private toolTimer?: ReturnType<typeof setTimeout>;
  private announcedTools = new Set<ToolKind>();
  private lastSpokeAt = -Infinity;
  private get phrases() { return statusPhrases(this.io.language ?? "en"); }
  private clearThinkingTimer() { clearTimeout(this.thinkingTimer); this.thinkingTimer = undefined; }
  private clearFillers() {
    clearTimeout(this.fillerTimer); this.fillerTimer = undefined;
    clearTimeout(this.toolTimer); this.toolTimer = undefined;
    this.fillerPlayback?.abort(); this.fillerPlayback = undefined;
  }
  /** Starts a filler if one of this kind is ready and nothing else is being said. */
  private startFiller(kind: FillerKind) {
    if (!this.io.filler || this.fillerPlayback) return false;
    const playback = new AbortController();
    const playing = this.io.filler(kind, playback.signal);
    if (!playing) return false;
    this.fillerPlayback = playback;
    if (kind !== 'murmur') this.lastSpokeAt = Date.now();
    // A filler resets the spacing, so a murmur never trails right behind it.
    clearTimeout(this.fillerTimer); this.fillerTimer = undefined;
    this.io.trace?.('filler');
    void playing.catch(() => {}).finally(() => {
      if (this.fillerPlayback === playback) { this.fillerPlayback = undefined; this.state(); }
    });
    return true;
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
      if (!this.fillerAllowed() || this.fillerPlayback) return;
      this.fillersThisTurn++;
      // Long turns mix in a short "still on it" among the wordless murmurs.
      if (!(this.fillersThisTurn > 2 && Math.random() < 0.35 && this.startFiller('still'))) this.startFiller('murmur');
      // Nothing ready yet: the spacing still grows, and the next attempt follows.
      if (!this.fillerPlayback) this.scheduleFiller();
    }, base * (0.8 + Math.random() * 0.4));
  }
  /** A tool started; a long-running one may be announced once per turn in the user's language. */
  toolStart(kind: ToolKind) {
    if (!this.alive) return;
    this.tool = kind;
    clearTimeout(this.toolTimer); this.toolTimer = undefined;
    if (kind === 'tool' || this.announcedTools.has(kind) || Date.now() - this.lastSpokeAt < TOOL_FILLER_QUIET_MS) return;
    this.toolTimer = setTimeout(() => {
      this.toolTimer = undefined;
      if (this.tool !== kind || !this.fillerAllowed() || Date.now() - this.lastSpokeAt < TOOL_FILLER_QUIET_MS) return;
      if (this.startFiller(kind)) this.announcedTools.add(kind);
    }, TOOL_FILLER_DELAY_MS);
  }
  toolEnd() {
    this.tool = undefined;
    clearTimeout(this.toolTimer); this.toolTimer = undefined;
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
    if (phase === "Speaking") this.lastSpokeAt = Date.now();
    this.scheduleFiller();
    if (this.io.statusSpeech === false || this.io.sequential || phase !== "Thinking" || !this.acceptingReplies || this.output.length) this.clearThinkingTimer();
    else if (!this.thinkingAnnounced && !this.thinkingTimer && Date.now() - this.lastThinkingAt >= 20000) {
      this.thinkingTimer = setTimeout(() => {
        this.thinkingTimer = undefined;
        if (!this.alive || this.compacting || this.hearing || !this.acceptingReplies || this.pipeline.busy || this.fillerPlayback || this.output.length || !(this.io.agentRunning() || this.sending)) return;
        this.thinkingAnnounced = true; this.lastThinkingAt = Date.now();
        // A pre-rendered phrase starts instantly; otherwise synthesize one.
        if (this.startFiller('think')) return;
        this.lastThinkingPhrase = pick(this.phrases.think, this.lastThinkingPhrase);
        this.thinkingPipeline.enqueue([this.lastThinkingPhrase],'status');
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
      if (!this.hearing && this.acceptingReplies) this.pipeline.enqueue([pick(this.phrases.compacting)],'status');
    } else this.pipeline.enqueue([completed ? this.phrases.compactionDone : this.phrases.compactionStopped],'status');
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
        this.pipeline.enqueue([this.phrases.compactionWait],'status');
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
        this.announcedTools.clear();
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
