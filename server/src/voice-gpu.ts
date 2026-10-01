import { execFile } from "node:child_process";
import os from "node:os";
import { LEAN_CHOICE, asrDevice, choiceLabel, cpuSlow, fitOn, fitRam, pickGpu, ramNeeded, sameChoice, suggestChoice, suggestCpuChoice, usesGpu, vramNeeded, type Gpu, type Host, type VoiceChoice } from "./voice-engines.js";

/** The query every probe runs. Not `compute_cap`: older drivers refuse the whole query over it. */
export const SMI_ARGS = ["--query-gpu=index,name,memory.total,memory.free", "--format=csv,noheader,nounits"];

/** What nvidia-smi printed for SMI_ARGS, one GPU a line. A line that does not fit the shape is skipped. */
export function parseGpus(output: string): Gpu[] {
  const gpus: Gpu[] = [];
  for (const line of output.split(/\r?\n/)) {
    const fields = line.split(",").map((f) => f.trim());
    if (fields.length < 4) continue;
    const index = Number(fields[0]);
    if (!/^\d+$/.test(fields[0])) continue;
    // A name with a comma in it keeps them: the memory figures are the last two fields.
    const memory = (value: string) => (/^\d+$/.test(value) ? Number(value) : null);
    gpus.push({ index, name: fields.slice(1, -2).join(", "), totalMiB: memory(fields.at(-2)!), freeMiB: memory(fields.at(-1)!) });
  }
  return gpus;
}

/** A way to read what nvidia-smi says. The portal may sit in a container without the tool, so there is more than one. */
export interface Probe { name: string; run(): Promise<string> }

/**
 * The one sentence for a host where Docker cannot give a container a GPU, however Docker or the
 * driver says so: no NVIDIA runtime, no driver loaded, no device. It is what the person reads.
 * The card may well be there (the portal can see it), so it does not say that none was found.
 */
export const NO_GPU_MESSAGE = "Docker cannot give the voice container a GPU: its NVIDIA runtime is missing or has no device to hand out. Install the NVIDIA Container Toolkit and restart Docker, or install speech recognition only, which needs no GPU.";
/** The toolkit refusing a container whose image needs a newer driver than the host has. */
export const DRIVER_TOO_OLD_MESSAGE = "The NVIDIA driver on this host is too old for the CUDA image the voice container runs in: update the driver, then try again.";
/** What a choice with speech synthesis is told on a host that was found to have no GPU. */
export const NO_GPU_FOR_SPEECH = "Speech synthesis needs a GPU, and none was found: install speech recognition only, or add an NVIDIA GPU that Docker can use.";
/**
 * Docker's, nvidia-container-cli's and nvidia-smi's own words for there being no GPU to use. Only those: the toolkit
 * has other errors (a driver that is too old, a failed mount) that are not this, and their words say what to do.
 */
const NO_GPU = /could not select device driver|unknown or invalid runtime name: nvidia|nvml error|driver not loaded|no devices were found|couldn't communicate with the nvidia driver|load library failed: libnvidia-ml/i;
const DRIVER_TOO_OLD = /requirement error|unsatisfied condition|please update your driver/i;
/** Does this error from Docker or nvidia-smi only say that there is no GPU? */
export const isNoGpu = (message: string) => NO_GPU.test(message);
/** What a person reads of an error out of Docker: a plain sentence where it only says there is no GPU or the driver is too old, else as it came. */
export const explain = (message: string) => isNoGpu(message) ? NO_GPU_MESSAGE : DRIVER_TOO_OLD.test(message) ? DRIVER_TOO_OLD_MESSAGE : message;

/** A probe's way of saying that it ran and found there is no GPU to use, as opposed to not being able to tell. */
export class NoGpu extends Error {}

/** nvidia-smi on the portal's own host; `NVIDIA_SMI` names another binary. */
export const hostProbe: Probe = {
  name: "host",
  run: () => new Promise((resolve, reject) =>
    execFile(process.env.NVIDIA_SMI || "nvidia-smi", SMI_ARGS, { timeout: 8000 }, (error, stdout) => {
      if (!error) return resolve(stdout);
      // A portal in a container has no nvidia-smi: that says nothing about the GPUs.
      reject((error as NodeJS.ErrnoException).code === "ENOENT" ? new Error("nvidia-smi was not found") : error);
    })),
};

/**
 * `checked` is whether the check could tell: GPUs were found, or a probe ran and found there are
 * none. It is false while nothing could be asked yet, such as before the CUDA image is downloaded.
 */
export interface Detected {
  gpus: Gpu[]; source: string; error: string; checked: boolean;
  /** Cards the host lists that Docker cannot hand to a container, such as for want of the NVIDIA Container Toolkit. Then there are no GPUs for voice. */
  unusable?: string[];
}

/** The first probe that finds a GPU wins. No GPU, no tool and no NVIDIA runtime are answers too, not failures. */
export async function detectGpus(probes: readonly Probe[]): Promise<Detected> {
  const errors: string[] = [];
  let none = false;
  for (const probe of probes) {
    try {
      const gpus = parseGpus(await probe.run());
      if (gpus.length) return { gpus, source: probe.name, error: "", checked: true };
      none = true;
      errors.push(`${probe.name}: no GPU listed`);
    } catch (e) {
      const message = (e as Error).message.split("\n")[0];
      if (e instanceof NoGpu || isNoGpu((e as Error).message)) { none = true; errors.push(`${probe.name}: no GPU available`); }
      else errors.push(`${probe.name}: ${message}`);
    }
  }
  return { gpus: [], source: "none", error: errors.join("; "), checked: none };
}

const gib = (mib: number | null) => mib === null ? "unknown" : `${(mib / 1024).toFixed(1)} GiB`;

/**
 * The memory and threads of the host. Recognition runs in a container of its own, which has no limit of the portal's:
 * a memory limit or a CPU set on the portal's container is not what it has, so the host's figures are read, which are
 * the ones a container sees of /proc.
 */
export function readHost(): Host {
  return { totalMiB: Math.round(os.totalmem() / 1048576), freeMiB: Math.round(os.freemem() / 1048576), threads: os.cpus().length || os.availableParallelism() };
}

export interface Decision { choice: VoiceChoice; gpu: Gpu | undefined; summary: string }
export interface DecideOptions { reserveMiB?: number; preferredGpu?: number; host?: Host; noGpu?: boolean }

/** Throws when the host cannot hold what the choice runs on the CPU; otherwise what to say of it, or nothing where it is a matter of course. */
function ramVerdict(choice: VoiceChoice, host: Host | undefined, alone: boolean): string {
  const fit = fitRam(choice, host);
  const need = gib(ramNeeded(choice));
  if (fit === "too-large") {
    const lighter = suggestCpuChoice(host);
    const hint = sameChoice({ ...lighter, tts: choice.tts }, choice) ? "" : ` ${choiceLabel({ ...lighter, tts: choice.tts })} would fit.`;
    throw new Error(`${choiceLabel(choice)} needs about ${need} of memory on the CPU, but this host has ${gib(host!.totalMiB)}.${hint}`);
  }
  const slow = host && cpuSlow(choice, host.threads) ? ` and may be slower than the speaker on this host's ${host.threads} CPU threads` : "";
  if (fit === "tight") return `about ${need} of memory on the CPU, of which the host has less free now${slow}`;
  if (fit === "unknown") return alone ? `about ${need} of memory on the CPU` : "";
  // Whisper's few hundred MiB are not worth a clause next to a GPU; recognition alone, or on the CPU by choice, is the whole story.
  if (alone || (choice.asr === "qwen3-asr" && asrDevice(choice) === "cpu")) return `about ${need} of memory on the CPU, which fits${slow}`;
  return slow ? `recognition on the CPU${slow}` : "";
}

/**
 * What to install on what was found. Without a request the suggestion is taken; a request is kept.
 * Either is refused, with what would fit, when the card or the host's memory cannot hold it at all.
 * On a host that was found to have no GPU (`noGpu`) the suggestion is speech recognition alone on the
 * CPU, and a request for speech synthesis is refused.
 */
export function decide(requested: VoiceChoice | undefined, gpus: readonly Gpu[], options: DecideOptions = {}): Decision {
  const reserve = options.reserveMiB ?? 0;
  const host = options.host;
  if (options.noGpu && !gpus.length) {
    const choice = requested ?? suggestCpuChoice(host);
    if (usesGpu(choice)) throw new Error(NO_GPU_FOR_SPEECH);
    return { choice, gpu: undefined, summary: `No GPU detected: installing ${choiceLabel(choice)} needing ${ramVerdict(choice, host, true)}. Replies are not spoken: speech synthesis needs a GPU.` };
  }
  const gpu = pickGpu(gpus, options.preferredGpu);
  const choice = requested ?? suggestChoice(gpu, reserve);
  const label = choiceLabel(choice);
  const need = gib(vramNeeded(choice));
  const card = gpu ? `${gpu.name} (${gib(gpu.totalMiB)}, ${gib(gpu.freeMiB)} free)` : "";
  const fit = fitOn(choice, gpu, reserve);
  if (fit === "too-large") {
    const better = suggestChoice(gpu, reserve);
    // When nothing fits the suggestion is the original combination, which is no help to name.
    const hint = sameChoice(better, choice) || fitOn(better, gpu, reserve) === "too-large" ? "" : ` ${choiceLabel(better)} would fit.`;
    const kept = reserve ? `, plus ${gib(reserve)} kept free` : "";
    throw new Error(requested
      ? `${label} needs about ${need} of GPU memory${kept}, but ${card} has less.${hint}`
      : `Even the smallest voice setup (${choiceLabel(LEAN_CHOICE)}) needs about ${gib(vramNeeded(LEAN_CHOICE))} of GPU memory${kept}, but ${card} has less.`);
  }
  const ram = ramVerdict(choice, host, !usesGpu(choice));
  if (!usesGpu(choice)) return { choice, gpu, summary: `${label} needs ${ram} and no GPU.` };
  if (!gpu) return { choice, gpu, summary: `No GPU could be read here; installing ${label} unchecked.` };
  const verdict = fit === "tight" ? `needs about ${need}; the card is big enough, but other programs use part of it now`
    : fit === "unknown" ? `needs about ${need}; its memory could not be read`
    : `needs about ${need}, which fits`;
  return { choice, gpu, summary: `Detected ${card}: ${label} ${verdict}${ram ? `, and ${ram}` : ""}.` };
}
