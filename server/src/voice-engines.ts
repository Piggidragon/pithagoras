/**
 * The speech engines the managed Voice service can run, in one place.
 *
 * The container spec, the setup script's environment, the health checks, the
 * settings the portal saves after an install and the choices the add-on page
 * offers all read this table, so an engine or a model size is added here once.
 * It has no node imports: the page uses it too.
 *
 * Everything here describes the audio.cpp process that serves speech and, for
 * Qwen3-ASR, recognition too. A model of another kind, such as an LLM that runs
 * in the same container later, is one more entry in `serverConfig` and one more
 * `vramMiB` in the sum; `reserveMiB` below keeps room for it in the meantime.
 */
export type TtsEngine = "breeze" | "chatterbox";
export type AsrEngine = "whisper" | "qwen3-asr";
/** What the managed container is built for: one speech engine and one recognition model. */
export interface VoiceChoice { tts: TtsEngine; asr: AsrEngine; asrModel: string }

/**
 * GPU memory in MiB, with the CUDA context included. These are estimates: Breeze is
 * the 4414 MiB measured for the audio.cpp process in the voice guide, the others
 * come from the size of their Q8_0 files plus the same kind of overhead, and
 * Chatterbox with Qwen3-ASR 1.7B was seen at about 5.5 GB together.
 */
export const TTS_ENGINES: Record<TtsEngine, { label: string; vramMiB: number }> = {
  breeze: { label: "Breeze", vramMiB: 4600 },
  chatterbox: { label: "Chatterbox", vramMiB: 3000 },
};
/**
 * Cheapest and weakest first: the last `recommended` one that fits is the one a suggestion picks.
 * Whisper runs on the CPU, so a larger one costs speed, not memory, and is offered but not suggested.
 */
export const ASR_MODELS: readonly { asr: AsrEngine; model: string; label: string; vramMiB: number; recommended: boolean }[] = [
  { asr: "whisper", model: "base", label: "Whisper base", vramMiB: 0, recommended: true },
  { asr: "whisper", model: "small", label: "Whisper small", vramMiB: 0, recommended: false },
  { asr: "qwen3-asr", model: "0.6b", label: "Qwen3-ASR 0.6B", vramMiB: 1400, recommended: true },
  { asr: "qwen3-asr", model: "1.7b", label: "Qwen3-ASR 1.7B", vramMiB: 2600, recommended: true },
];

/** The combination the installer has always made. A container without a recipe label is this one. */
export const DEFAULT_CHOICE: VoiceChoice = { tts: "breeze", asr: "whisper", asrModel: "base" };

export const SPEECH_PORT = 7862;
export const WHISPER_PORT = 8188;
export const speechUrl = `http://127.0.0.1:${SPEECH_PORT}/v1/audio/speech`;
export const whisperUrl = `http://127.0.0.1:${WHISPER_PORT}/inference`;

export const asrOption = (choice: Pick<VoiceChoice, "asr" | "asrModel">) =>
  ASR_MODELS.find((o) => o.asr === choice.asr && o.model === choice.asrModel);

/** Throws what the person should read when the value is not a combination the installer can make. */
export function parseChoice(value: unknown): VoiceChoice {
  const v = value as Partial<VoiceChoice> | null;
  if (!v || typeof v !== "object") throw new Error("Choose a speech synthesis and a speech recognition engine");
  if (typeof v.tts !== "string" || !Object.hasOwn(TTS_ENGINES, v.tts)) throw new Error("Choose a supported speech synthesis engine");
  if (typeof v.asr !== "string" || typeof v.asrModel !== "string" || !asrOption(v as VoiceChoice))
    throw new Error("Choose a supported speech recognition model");
  return { tts: v.tts as TtsEngine, asr: v.asr as AsrEngine, asrModel: v.asrModel };
}

/** The choice as a container label carries it, e.g. `breeze+whisper:base`. */
export const choiceKey = (c: VoiceChoice) => `${c.tts}+${c.asr}:${c.asrModel}`;
export const sameChoice = (a: VoiceChoice, b: VoiceChoice) => choiceKey(a) === choiceKey(b);
/** The choice a label names; one that is missing or is not a combination known now reads as the original one. */
export function choiceFromKey(key: string | undefined): VoiceChoice {
  const m = /^(\w+)\+([\w-]+):([\w.]+)$/.exec(key ?? "");
  try { return m ? parseChoice({ tts: m[1], asr: m[2], asrModel: m[3] }) : DEFAULT_CHOICE; } catch { return DEFAULT_CHOICE; }
}

export const choiceLabel = (c: VoiceChoice) => `${TTS_ENGINES[c.tts].label} speech with ${asrOption(c)?.label ?? c.asr}`;

/** GPU memory the choice holds while it is in use. */
export const vramNeeded = (c: VoiceChoice) => TTS_ENGINES[c.tts].vramMiB + (asrOption(c)?.vramMiB ?? 0);

export interface Gpu { index: number; name: string; totalMiB: number | null; freeMiB: number | null }
/** `fits`: there is room now. `tight`: the card is big enough, but other programs hold part of it now. */
export type Fit = "fits" | "tight" | "too-large" | "unknown";

/**
 * Does the choice fit the GPU? `reserveMiB` is memory to keep free for something
 * else on the same card, such as a model that runs in the container later.
 */
export function fitOn(c: VoiceChoice, gpu: Gpu | undefined, reserveMiB = 0): Fit {
  if (!gpu || gpu.totalMiB === null) return "unknown";
  const need = vramNeeded(c) + reserveMiB;
  if (need > gpu.totalMiB) return "too-large";
  return gpu.freeMiB !== null && need > gpu.freeMiB ? "tight" : "fits";
}

/** The GPU the container will use: the one asked for, else the one with the most memory free. */
export function pickGpu(gpus: readonly Gpu[], preferred?: number): Gpu | undefined {
  const asked = preferred === undefined ? undefined : gpus.find((g) => g.index === preferred);
  return asked ?? [...gpus].sort((a, b) => (b.freeMiB ?? b.totalMiB ?? -1) - (a.freeMiB ?? a.totalMiB ?? -1))[0];
}

/** The combination that needs the least GPU memory: Chatterbox, with Whisper on the CPU. */
export const LEAN_CHOICE: VoiceChoice = { tts: "chatterbox", asr: "whisper", asrModel: "base" };

/**
 * The best combination that fits with room to spare right now. Breeze stays the
 * speech engine as long as it fits, since it streams; recognition then gets the
 * largest recommended model that still fits next to it. When nothing fits right
 * now it is the original combination if the card can hold it at all, else the
 * leanest one; without a GPU reading it is the original combination.
 */
export function suggestChoice(gpu: Gpu | undefined, reserveMiB = 0): VoiceChoice {
  if (!gpu || gpu.totalMiB === null) return DEFAULT_CHOICE;
  for (const tts of Object.keys(TTS_ENGINES) as TtsEngine[]) {
    const best = ASR_MODELS.filter((o) => o.recommended && fitOn({ tts, asr: o.asr, asrModel: o.model }, gpu, reserveMiB) === "fits").at(-1);
    if (best) return { tts, asr: best.asr, asrModel: best.model };
  }
  return [DEFAULT_CHOICE, LEAN_CHOICE].find((c) => fitOn(c, gpu, reserveMiB) !== "too-large") ?? DEFAULT_CHOICE;
}

const MODELS = {
  breeze: () => ({ id: "breeze", family: "breeze_tts", path: "/voice/models/breeze-q8_0.gguf", task: "tts", mode: "streaming", session_options: { "breeze_tts.reference_cache_slots": "1" } }),
  // "clon" is audio.cpp's own name for voice cloning, not a truncated "clone".
  chatterbox: () => ({ id: "chatterbox", family: "chatterbox", path: "/voice/models/chatterbox-q8_0.gguf", task: "clon", mode: "offline", session_options: { "chatterbox.multilingual_t3": "v3", "chatterbox.conditionals_cache_slots": "2" } }),
};
/** The speech model as audio.cpp loads it, in the server config and in a load request alike. */
export const ttsModel = (engine: TtsEngine) => MODELS[engine]();
const asrModel = (model: string) => ({ id: "qwen3-asr", family: "qwen3_asr", path: `/voice/models/qwen3-asr-${model}-q8_0.gguf`, task: "asr", mode: "offline" });

/** The audio.cpp server config for the choice. Whisper is a process of its own and is not in it. */
export function serverConfig(c: VoiceChoice) {
  const models = [ttsModel(c.tts), ...(c.asr === "qwen3-asr" ? [asrModel(c.asrModel)] : [])];
  // Speech and recognition are loaded together, or each request would swap the other out.
  return { host: "127.0.0.1", port: SPEECH_PORT, backend: "cuda", device: 0, threads: 4, lazy_load: true, idle_unload_ms: 90000, ui_management: true, max_loaded_models: models.length, models };
}

/** The settings that point the portal at the managed services of the choice. */
export function endpoints(c: VoiceChoice) {
  const whisper = c.asr === "whisper";
  return {
    runtime: c.tts === "chatterbox" ? "chatterbox" as const : "audio-cpp" as const,
    breezeUrl: speechUrl,
    whisperUrl: whisper ? whisperUrl : `http://127.0.0.1:${SPEECH_PORT}/v1/audio/transcriptions`,
    // Whisper.cpp serves one model and is sent no model field; audio.cpp names the one it loaded.
    sttModel: whisper ? "" : "qwen3-asr",
  };
}

/** What has to answer before the service counts as ready. */
export const healthUrls = (c: VoiceChoice) => [
  ...(c.asr === "whisper" ? [`http://127.0.0.1:${WHISPER_PORT}/health`] : []),
  `http://127.0.0.1:${SPEECH_PORT}/health`,
];
