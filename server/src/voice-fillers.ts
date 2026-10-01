import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/** What every speech runtime here makes: mono, 16-bit, this many samples a second. */
const RATE = 24000;
/** Shorter than this is not a sound: the runtime made nothing. */
const SHORTEST = 0.25;
/** After a failed attempt, how long before the next voice start tries again. */
const RETRY_AFTER = 60_000;

/**
 * What the voice says to fill the silence after a turn. Not wording that would
 * have to be kept per language: the sounds a person makes while listening, which
 * every language has, and the one word every language has taken over ("okay").
 * Each is made with the voice's own language setting, so it is said as that
 * language says it, from the same text everywhere.
 *
 * Always two short sounds, never one: with Chatterbox a one-word "Okay." or a
 * wordless "Hmm." or "Mhm." is said twice, runs on for seconds, or comes out as
 * other words (Polish turned "Mhm." into a sentence). Two of them came out once
 * in every language of Chatterbox that was tried, at 0.9 to 2 seconds.
 *
 * `longest` is what a clip may come out at, a little over what the text takes: a
 * clip beyond that is the runtime saying it twice or running on, and is thrown
 * away instead of kept, whatever the runtime and language.
 */
export const FILLERS: readonly { text: string; longest: number }[] = [
  { text: "Ah, okay.", longest: 2.6 },
  { text: "Oh, okay.", longest: 2.6 },
  { text: "Okay, ah.", longest: 2.6 },
  { text: "Ah, mhm.", longest: 2.6 },
  { text: "Okay, mhm.", longest: 2.6 },
];

/** Makes one text as 24 kHz PCM. */
export type Render = (text: string, signal: AbortSignal) => Promise<Buffer>;

const KEY = /^[0-9a-f]{40}$/;
/** How often a clip that came out wrong is made again, for a runtime that does not say the same thing each time. */
const TRIES = 3;
/** After live speech, how long before a clip is started: a moment between two phrases of an answer is not the answer being over. */
const QUIET_MS = 8000;

/**
 * The fillers of the voice that is set up, made once and kept on disk. They are
 * made here and downloaded by the page, not made at play time: a filler has to
 * start the moment a turn ends, with no synthesis in front of it, and one still
 * being made when the answer arrives would hold the speech runtime's single slot
 * against the answer. So a clip is only started when no live speech is being made
 * nor was a moment ago, and one that is under way when live speech begins is
 * given up on and made again afterwards.
 *
 * A voice is a `key`: whatever decides how it sounds. Only one voice is made at a
 * time: a new key stops the one being made, and its clips are dropped when the new
 * one is made, so changing the voice never leaves a pile behind.
 */
export class FillerStore {
  /** The voice being made, and what stops it. */
  private current?: { key: string; run: AbortController; done: Promise<void> };
  /** The clip being made, for live speech to cut off. */
  private attempt?: AbortController;
  private failed = new Map<string, number>();
  /** Clips of a runtime that does not say the same thing each time, which came out wrong too often: left alone until the portal is restarted. */
  private gaveUp = new Set<string>();
  private live = 0;
  private endedAt = -Infinity;
  private wake = new Set<() => void>();
  constructor(
    private root: () => string,
    private warn: (message: string) => void = message => console.error("[voice] fillers:", message),
    private clock: () => number = Date.now,
    /** How long after live speech the clips wait. */
    public quiet = QUIET_MS,
  ) {}
  private dir(key: string) { return path.join(this.root(), key); }

  /**
   * Live speech is being made: from now, until the returned function is called,
   * no clip is started, and the one being made is cut off so that it does not
   * hold the runtime against this.
   */
  speaking(): () => void {
    this.live++;
    this.attempt?.abort();
    let ended = false;
    return () => {
      if (ended) return;
      ended = true; this.live--; this.endedAt = Date.now();
      for (const wake of [...this.wake]) wake();
    };
  }

  /** Resolves when no live speech is being made nor was just now, or when `signal` stops the wait. */
  private async idle(signal: AbortSignal) {
    while (!signal.aborted) {
      const wait = this.live ? undefined : this.endedAt + this.quiet - Date.now();
      if (wait !== undefined && wait <= 0) return;
      await new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); this.wake.delete(done); signal.removeEventListener("abort", done); resolve(); };
        const timer = wait === undefined ? undefined : setTimeout(done, wait);
        this.wake.add(done); signal.addEventListener("abort", done, { once: true });
      });
    }
  }

  /**
   * The clips there are for this voice, and whether more are on their way. Asking is what starts the making of the missing ones.
   * `steady` is whether the runtime says the same thing each time: what it got wrong once it gets wrong again, so that is not tried again.
   */
  async status(key: string, render: Render, steady = true): Promise<{ clips: number[]; rendering: boolean }> {
    if (!KEY.test(key)) throw new Error("Not a voice key");
    const files = await readdir(this.dir(key)).catch(() => [] as string[]);
    const clips = FILLERS.map((_, i) => i).filter(i => files.includes(`${i}.pcm`));
    const todo = FILLERS.map((_, i) => i).filter(i => !files.includes(`${i}.pcm`) && !files.includes(`${i}.skip`) && !this.gaveUp.has(`${key}/${i}`));
    // Another voice than the one being made: that is not wanted any more.
    if (this.current && this.current.key !== key) this.current.run.abort();
    let rendering = !!this.current && this.current.key === key && !this.current.run.signal.aborted;
    if (todo.length && !rendering && this.clock() - (this.failed.get(key) ?? -Infinity) >= RETRY_AFTER) {
      const run = new AbortController(), before = this.current?.done;
      // After the one before has let go, so that two never make clips at once, and the old one cannot write into what the new one cleared.
      const done = (async () => { await before; await this.make(key, todo, render, run.signal, steady); })()
        .finally(() => { if (this.current?.run === run) this.current = undefined; });
      this.current = { key, run, done };
      rendering = true;
    }
    return { clips, rendering };
  }

  /** One clip as it was kept, or none for a key or a number that is not one. */
  async read(key: string, n: number): Promise<Buffer | undefined> {
    if (!KEY.test(key) || !Number.isInteger(n) || n < 0 || n >= FILLERS.length) return undefined;
    return readFile(path.join(this.dir(key), `${n}.pcm`)).catch(() => undefined);
  }

  /** One clip, made when the runtime has nothing live to say, and again if live speech took it back meanwhile. Nothing once `run` is stopped. */
  private async render(text: string, render: Render, run: AbortSignal): Promise<Buffer | undefined> {
    while (true) {
      await this.idle(run);
      if (run.aborted) return undefined;
      const attempt = this.attempt = new AbortController();
      try {
        const pcm = await render(text, AbortSignal.any([attempt.signal, run, AbortSignal.timeout(60_000)]));
        return run.aborted ? undefined : pcm;
      } catch (e) {
        if (run.aborted) return undefined;
        // Cut off for live speech: not a failure, only for later.
        if (!attempt.signal.aborted) throw e;
      } finally {
        if (this.attempt === attempt) this.attempt = undefined;
      }
    }
  }

  /** Makes the clips one after the other. A failure is remembered and not retried for a while. */
  private async make(key: string, todo: number[], render: Render, run: AbortSignal, steady: boolean) {
    const dir = this.dir(key);
    try {
      for (const name of await readdir(this.root()).catch(() => [] as string[]))
        if (name !== key) await rm(path.join(this.root(), name), { recursive: true, force: true });
      for (const i of todo) {
        for (let tries = 1; ; tries++) {
          const pcm = await this.render(FILLERS[i].text, render, run);
          if (!pcm || run.aborted) return;
          const seconds = pcm.length / 2 / RATE;
          await mkdir(dir, { recursive: true });
          if (seconds >= SHORTEST && seconds <= FILLERS[i].longest) {
            // Whole or not at all: a listing never sees half a clip.
            await writeFile(path.join(dir, `${i}.tmp`), pcm);
            await rename(path.join(dir, `${i}.tmp`), path.join(dir, `${i}.pcm`));
            break;
          }
          // A runtime that says it the same way each time would say this again: kept as nothing, so that voice start does not make it every time.
          if (steady) { await writeFile(path.join(dir, `${i}.skip`), ""); break; }
          // One that does not may get it right the next time; after a few it is let be, until the portal is started again.
          if (tries >= TRIES) { this.gaveUp.add(`${key}/${i}`); break; }
        }
      }
      this.failed.delete(key);
    } catch (e) {
      this.failed.set(key, this.clock());
      this.warn((e as Error).message);
    }
  }
}
