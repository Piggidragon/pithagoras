import { SpeechPipeline, type PreparedSpeech } from "./speech-pipeline";
import type { Item } from "./transcript";
import { StreamingSpeech } from "./voice";
import { language, t } from "./i18n";
import { notice, type Notice } from "./voice-notices";

/** The longest the answer waits for a filler to stop: a fade-out takes a few milliseconds, and this is for a player that never reports back. */
const FILLER_STOP_MS = 150;
export type VoicePhase = "Listening" | "Hearing you" | "Transcribing" | "Thinking" | "Compacting context" | "Speaking";
export interface VoiceIO {
  sequential?: boolean;
  sentenceChunks?: boolean;
  ttsPrefetch?: boolean;
  statusSpeech?: boolean;
  /** The language the voice speaks, as its setting names it ("de"), or "auto": what the spoken notices are in. */
  speechLanguage?: () => string | undefined;
  transcribe: (samples: Float32Array, signal: AbortSignal) => Promise<string>;
  send: (text: string) => Promise<void>;
  abort: () => Promise<void>;
  /** Handles what was said on the page instead of sending it, when it is for the page ("say that again"). */
  command?: (text: string) => boolean;
  /** Whether what has been heard so far could still turn out to be for the page. */
  couldBeCommand?: (partial: string) => boolean;
  /** True when speaking mid-run should add to the run rather than stop it. */
  steering?: () => boolean;
  agentRunning: () => boolean;
  synthesize: (text: string, signal: AbortSignal, kind?:'reply'|'status') => Promise<PreparedSpeech>;
  /**
   * Plays a filler: a short sound for the silence after a turn is sent. Resolves
   * when it has ended or `signal` cut it off. Nothing to play (switched off, no
   * clip ready) is returning nothing; that is no error.
   */
  filler?: (signal: AbortSignal) => Promise<void> | undefined;
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
  /**
   * While what is being said is not yet known to be for the agent: the reply
   * it cut off, and what the agent has written since. Spoken after all when
   * it turns out to be a cough, a press taken back, or a page command; dropped
   * only once it goes to the agent.
   */
  private held: string[] | null = null;
  private items: Item[] = [];
  private speech: StreamingSpeech;
  private recordings: Float32Array[] = [];
  private text: string[] = [];
  private processing = false;
  private output: string[] = [];
  private pipeline: SpeechPipeline;
  private compacting = false;
  private compactionSpeech = false;
  private lastCompactionWaitAt = -Infinity;
  private transcription = new AbortController();
  private operations: Promise<void> = Promise.resolve();
  private sending = false;
  /** The run going when this utterance began has already been told to stop. */
  private stopped = false;
  /** The filler being played, while it plays. */
  private filler?: { controller: AbortController; done: Promise<void> };
  /** A filler was the last thing said: the next waits until something has been said that is not one. */
  private filled = false;

  constructor(private io: VoiceIO, initial: Item[]) {
    const afterSeq = initial.reduce((n, item) => Math.max(n, Number(item.id.slice(1)) || 0), 0);
    this.pipeline = new SpeechPipeline((text, signal, kind) => this.prepare(text, signal, kind), () => this.state(), error => this.report(error), io.sequential, io.sentenceChunks, io.ttsPrefetch);
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
    const phase = this.hearing ? "Hearing you" : this.compacting ? "Compacting context" : this.processing && !this.sending ? "Transcribing" : this.pipeline.busy || this.filler ? "Speaking" : this.io.agentRunning() || this.sending ? "Thinking" : "Listening";
    this.io.phase(phase);
  }
  /**
   * Whatever is spoken next ends a filler first, and is what the next filler
   * waits for. The answer does not start until the filler has stopped, so the two
   * are never heard together, and it does not wait for it to finish either: a
   * filler stops within a few milliseconds of being told to.
   */
  private async prepare(text: string, signal: AbortSignal, kind?: 'reply' | 'status'): Promise<PreparedSpeech> {
    const prepared = await this.io.synthesize(text, signal, kind);
    return Object.assign(async (playback: AbortSignal) => {
      await this.endFiller();
      playback.throwIfAborted();
      this.filled = false;
      await prepared(playback);
    }, { completed: prepared.completed });
  }
  /**
   * A filler, now: the turn has been taken, and until the agent has something to
   * say there is silence. Once per turn, and not after another filler with nothing
   * said in between. Not while anything else is going to be heard: the user is
   * speaking, a notice is, or the answer already is.
   */
  private startFiller() {
    if (!this.alive || !this.io.filler || this.io.statusSpeech === false || this.io.sequential || this.filled || this.filler) return;
    if (this.hearing || this.compacting || this.pipeline.busy || this.output.length) return;
    const controller = new AbortController();
    let playing: Promise<void> | undefined;
    try { playing = this.io.filler(controller.signal); } catch { return; }
    if (!playing) return;
    this.filled = true;
    // A filler that fails is a filler not heard, not an error shown.
    const filler = { controller, done: playing.catch(() => {}).then(() => { if (this.filler === filler) { this.filler = undefined; this.state(); } }) };
    this.filler = filler;
    this.state();
    return filler;
  }
  /** The turn that started this filler is not going to be sent after all: the filler is cut, and the next turn may have one. */
  private dropFiller(filler: { controller: AbortController } | undefined) {
    if (!filler) return;
    filler.controller.abort();
    this.filled = false;
  }
  /** Tells the filler to stop, and returns once it has: a player that does not answer is not waited for, as the answer is worth more than a filler. */
  private async endFiller() {
    const filler = this.filler;
    if (!filler) return;
    filler.controller.abort();
    let timer!: ReturnType<typeof setTimeout>;
    await Promise.race([filler.done, new Promise<void>(resolve => { timer = setTimeout(resolve, FILLER_STOP_MS); })]);
    clearTimeout(timer);
  }
  /** A notice, in the language of the voice. */
  private say(kind: Notice) {
    const text = notice(kind, this.io.speechLanguage?.(), language());
    if (text) this.pipeline.enqueue([text], 'status');
  }
  setCompacting(active: boolean, completed = true) {
    if (!this.alive || active === this.compacting) return;
    this.compacting = active;
    this.filler?.controller.abort();
    if (this.io.statusSpeech === false || this.io.sequential) { this.state(); return; }
    if (active) {
      this.lastCompactionWaitAt = -Infinity;
      if (!this.hearing && this.acceptingReplies) this.say("compacting");
    } else this.say(completed ? "done" : "stopped");
    this.state();
  }
  observe(items: Item[]) {
    this.items = items;
    if (!this.alive) return;
    if (!this.acceptingReplies) { if (this.held) this.held.push(...this.speech.observe(items)); else this.ignoreCurrent(); }
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
        this.say("waiting");
      }
      return;
    }
    this.hearing = true;
    this.acceptingReplies = false;
    this.held = [...(this.held ?? []), ...this.pipeline.cancel(), ...this.output];
    this.output = [];
    // Talking over a filler is no turn for it to finish.
    this.filler?.controller.abort();
    // The run is stopped only once what was said turns out to be for the agent:
    // not a tap, not noise, not a command the page handles. See heard().
    this.state();
  }
  /**
   * What has been made out so far of what is being said. Once it is plainly
   * for the agent, a run it would stop is stopped now, not when the speaker is
   * done: "stop, don't touch that file" must not wait for the end of the sentence.
   */
  heard(partial: string) {
    if (!this.alive || this.muted || !this.hearing || this.stopped || this.compacting) return;
    if (!partial.trim() || this.io.couldBeCommand?.(partial) || this.io.steering?.() || !(this.io.agentRunning() || this.sending)) return;
    this.stopped = true;
    const generation = this.inputGeneration;
    // Serialized like the stop in process(), and a failed one is tried again there before anything is sent.
    this.operations = this.operations.then(async () => { if (this.alive && this.inputGeneration === generation) await this.io.abort(); })
      .catch(error => { this.stopped = false; this.report(error); });
  }
  /** Speech that began and is not going to be sent after all: a push-to-talk press too short to be words. */
  speechCancel() {
    if (!this.alive) return;
    // A press during compaction is over; the next thing said is heard again.
    this.compactionSpeech = false;
    if (!this.hearing) return;
    this.hearing = false;
    this.stopped = false;
    this.resumeReplies();
    this.state();
    void this.play();
  }
  /** What was said is not going to the agent: the reply it held back is spoken after all. */
  private resumeReplies() {
    if (this.held) this.output = [...this.held, ...this.output];
    this.held = null;
    this.acceptingReplies = true;
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
      if (this.hearing) return;
      if (!this.text.length) {
        // Nothing in it but noise: the run was not stopped, so what it says next is spoken.
        if (valid() && !this.recordings.length) { this.stopped = false; this.resumeReplies(); }
        return;
      }
      const text = this.text.join(" ");
      if (this.io.command?.(text)) {
        // For the page ("say that again") and handled there, not sent to the
        // agent. The interruption cut its reply off, so what was left unsaid is
        // spoken after all instead of dropped.
        this.text = [];
        this.stopped = false;
        this.resumeReplies();
        this.ignoreCurrent();
        return;
      }
      // The turn is taken, and for the agent: from here on there is silence until
      // it speaks, and the filler is what fills it, from the clip already in hand.
      // Not after the run this turn interrupts has wound down: that is the gap it is for.
      const filler = this.startFiller();
      // Serialize abort behind an in-flight send so it cannot miss that new run.
      // When steering, the run goes on and what is said is added to it. When it
      // was already stopped while this was being said, that is not done twice —
      // but whether it was is only known once that stop has settled.
      const busy = (this.io.agentRunning() || this.sending) && !this.io.steering?.();
      const send = this.operations.then(async () => {
        if (!valid() || this.hearing || this.recordings.length) return this.dropFiller(filler);
        if (busy && !this.stopped) {
          try { await this.io.abort(); } catch (error) { this.dropFiller(filler); throw error; }
          if (!valid() || this.hearing || this.recordings.length) return this.dropFiller(filler);
        }
        this.held = null;
        this.ignoreCurrent();
        this.acceptingReplies = true;
        this.sending = true;
        this.state();
        try {
          await this.io.send(text);
          if (valid()) { this.text = []; this.stopped = false; }
        } catch (error) {
          this.acceptingReplies = false;
          this.filler?.controller.abort();
          throw new Error(t("Could not send “{text}”: {error}", { text, error: error instanceof Error ? error.message : String(error) }));
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
      this.stopped = false;
      this.transcription.abort();
      this.transcription = new AbortController();
      this.resumeReplies();
    }
    this.state();
    void this.play();
  }
  stop() {
    this.alive = false;
    this.filler?.controller.abort();
    this.pipeline.cancel();
    this.transcription.abort();
    this.output = [];
    this.held = null;
    this.recordings = [];
    this.text = [];
  }
}
