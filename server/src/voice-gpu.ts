import { execFile } from "node:child_process";
import { LEAN_CHOICE, choiceLabel, fitOn, pickGpu, sameChoice, suggestChoice, vramNeeded, type Gpu, type VoiceChoice } from "./voice-engines.js";

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

/** nvidia-smi on the portal's own host; `NVIDIA_SMI` names another binary. */
export const hostProbe: Probe = {
  name: "host",
  run: () => new Promise((resolve, reject) =>
    execFile(process.env.NVIDIA_SMI || "nvidia-smi", SMI_ARGS, { timeout: 8000 }, (error, stdout) => error ? reject(error) : resolve(stdout))),
};

export interface Detected { gpus: Gpu[]; source: string; error: string }

/** The first probe that finds a GPU wins. No GPU and no tool is an answer too, not a failure. */
export async function detectGpus(probes: readonly Probe[]): Promise<Detected> {
  const errors: string[] = [];
  for (const probe of probes) {
    try {
      const gpus = parseGpus(await probe.run());
      if (gpus.length) return { gpus, source: probe.name, error: "" };
      errors.push(`${probe.name}: no GPU listed`);
    } catch (e) { errors.push(`${probe.name}: ${(e as Error).message.split("\n")[0]}`); }
  }
  return { gpus: [], source: "none", error: errors.join("; ") };
}

const gib = (mib: number | null) => mib === null ? "unknown" : `${(mib / 1024).toFixed(1)} GiB`;

export interface Decision { choice: VoiceChoice; gpu: Gpu | undefined; summary: string }

/**
 * What to install on what was found. Without a request the suggestion is taken;
 * a request is kept. Either is refused, with what would fit, when the card cannot hold it at all.
 */
export function decide(requested: VoiceChoice | undefined, gpus: readonly Gpu[], options: { reserveMiB?: number; preferredGpu?: number } = {}): Decision {
  const reserve = options.reserveMiB ?? 0;
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
  if (!gpu) return { choice, gpu, summary: `No GPU could be read here; installing ${label} unchecked.` };
  const verdict = fit === "tight" ? `needs about ${need}; the card is big enough, but other programs use part of it now`
    : fit === "unknown" ? `needs about ${need}; its memory could not be read`
    : `needs about ${need}, which fits`;
  return { choice, gpu, summary: `Detected ${card}: ${label} ${verdict}.` };
}
