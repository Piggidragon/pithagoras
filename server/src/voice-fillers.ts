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

/**
 * The fillers of the voice that is set up, made once and kept on disk. They are
 * made here and downloaded by the page, not made at play time: a filler has to
 * start the moment a turn ends, with no synthesis in front of it, and one still
 * being made when the answer arrives would hold the speech runtime's single slot
 * against the answer.
 *
 * A voice is a `key`: whatever decides how it sounds. The clips of other keys are
 * dropped when a new one is made, so changing the voice never leaves a pile behind.
 */
export class FillerStore {
  private running = new Map<string, Promise<void>>();
  private failed = new Map<string, number>();
  constructor(
    private root: () => string,
    /** Resolves when no live speech is being made: a clip is only started then. */
    private idle: () => Promise<void>,
    private warn: (message: string) => void = message => console.error("[voice] fillers:", message),
    private clock: () => number = Date.now,
  ) {}
  private dir(key: string) { return path.join(this.root(), key); }

  /** The clips there are for this voice, and whether more are on their way. Asking is what starts the making of the missing ones. */
  async status(key: string, render: Render): Promise<{ clips: number[]; rendering: boolean }> {
    if (!KEY.test(key)) throw new Error("Not a voice key");
    const files = await readdir(this.dir(key)).catch(() => [] as string[]);
    const clips = FILLERS.map((_, i) => i).filter(i => files.includes(`${i}.pcm`));
    const todo = FILLERS.map((_, i) => i).filter(i => !files.includes(`${i}.pcm`) && !files.includes(`${i}.skip`));
    let rendering = this.running.has(key);
    if (todo.length && !rendering && this.clock() - (this.failed.get(key) ?? -Infinity) >= RETRY_AFTER) {
      this.running.set(key, this.make(key, todo, render).finally(() => this.running.delete(key)));
      rendering = true;
    }
    return { clips, rendering };
  }

  /** One clip as it was kept, or none for a key or a number that is not one. */
  async read(key: string, n: number): Promise<Buffer | undefined> {
    if (!KEY.test(key) || !Number.isInteger(n) || n < 0 || n >= FILLERS.length) return undefined;
    return readFile(path.join(this.dir(key), `${n}.pcm`)).catch(() => undefined);
  }

  /** Makes the clips one after the other, each when the speech runtime has nothing live to say. A failure is remembered and not retried for a while. */
  private async make(key: string, todo: number[], render: Render) {
    const dir = this.dir(key);
    try {
      for (const name of await readdir(this.root()).catch(() => [] as string[]))
        if (name !== key) await rm(path.join(this.root(), name), { recursive: true, force: true });
      for (const i of todo) {
        await this.idle();
        const pcm = await render(FILLERS[i].text, AbortSignal.timeout(60_000));
        const seconds = pcm.length / 2 / RATE;
        await mkdir(dir, { recursive: true });
        // Kept as nothing, so that the same text is not made again every time voice starts: the runtime says it the same way each time.
        if (seconds < SHORTEST || seconds > FILLERS[i].longest) { await writeFile(path.join(dir, `${i}.skip`), ""); continue; }
        // Whole or not at all: a listing never sees half a clip.
        await writeFile(path.join(dir, `${i}.tmp`), pcm);
        await rename(path.join(dir, `${i}.tmp`), path.join(dir, `${i}.pcm`));
      }
      this.failed.delete(key);
    } catch (e) {
      this.failed.set(key, this.clock());
      this.warn((e as Error).message);
    }
  }
}
