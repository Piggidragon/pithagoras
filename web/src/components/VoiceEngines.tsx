import { Select } from "./Select";
import { ASR_MODELS, DEFAULT_CHOICE, TTS_ENGINES, asrOption, fitOn, sameChoice, vramNeeded, type VoiceChoice } from "../../../server/src/voice-engines";
import type { VoiceHardware } from "../api";
import { formatNumber, t } from "../i18n";
import { btnCls } from "./SettingsUi";

const gib = (mib: number) => formatNumber(mib / 1024, { maximumFractionDigits: 1 });
const asrKey = (c: Pick<VoiceChoice, "asr" | "asrModel">) => `${c.asr}:${c.asrModel}`;

/**
 * Which speech engine and which recognition model the managed voice container is built for,
 * with what the GPU can hold. `picked` is null while the choice is left to the install, which
 * takes what fits the GPU; once there is a container, the choice shown is the one it was built for.
 */
export function VoiceEngines({ installed, fresh, busy, hardware, picked, onPick }: {
  installed: VoiceChoice | undefined; fresh: boolean; busy: boolean; hardware: VoiceHardware | null;
  picked: VoiceChoice | null; onPick: (choice: VoiceChoice | null) => void;
}) {
  const gpu = hardware?.gpus.find((g) => g.index === hardware.selected);
  const shown = picked ?? installed ?? hardware?.suggestion ?? DEFAULT_CHOICE;
  const auto = fresh && picked === null;
  // The installed choice is running there: the memory it holds is what the card shows as taken, so a verdict on it would blame the service itself, and it is what the card is already used for.
  const kept = !!installed && picked === null;
  const fit = fitOn(shown, gpu, hardware?.reserveMiB ?? 0);
  const need = gib(vramNeeded(shown));
  const suggestion = hardware?.suggestion;
  const pick = (patch: Partial<VoiceChoice>) => {
    const next = { ...shown, ...patch };
    // Back to what is installed is no change at all.
    onPick(installed && sameChoice(next, installed) ? null : next);
  };
  return <div className="space-y-3 rounded-lg border border-line p-3">
    <div><p className="text-xs font-medium">{t("Speech engines")}</p><p className="mt-1 text-xs text-fg-faint">{t("Pick how the voice speaks and listens. Pithagoras checks your GPU and tells you what fits.")}</p></div>
    {fresh && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={auto} disabled={busy} onChange={(e) => onPick(e.target.checked ? null : shown)} />{t("Choose for me, based on my GPU")}</label>}
    <div className="block text-xs text-fg-muted">{t("Speech synthesis engine")}
      <Select aria-label={t("Speech synthesis engine")} size="sm" className="mt-1.5 w-full" disabled={auto || busy} value={shown.tts}
        onChange={(tts) => pick({ tts })}
        options={[
          { value: "breeze", label: TTS_ENGINES.breeze.label, hint: t("English and Chinese, streams while it speaks") },
          { value: "chatterbox", label: TTS_ENGINES.chatterbox.label, hint: t("Nineteen languages, clones a reference voice") },
        ]} /></div>
    <div className="block text-xs text-fg-muted">{t("Speech recognition engine")}
      <Select aria-label={t("Speech recognition engine")} size="sm" className="mt-1.5 w-full" disabled={auto || busy} value={asrKey(shown)}
        onChange={(key) => { const o = ASR_MODELS.find((m) => asrKey({ asr: m.asr, asrModel: m.model }) === key)!; pick({ asr: o.asr, asrModel: o.model }); }}
        options={ASR_MODELS.map((o) => ({ value: asrKey({ asr: o.asr, asrModel: o.model }), label: o.label,
          hint: o.vramMiB ? t("On the GPU, about {gib} GiB", { gib: gib(o.vramMiB) }) : t("On the CPU, no GPU memory") }))} /></div>
    {hardware && (gpu
      ? <p className="text-xs text-fg-faint">{gpu.totalMiB === null ? t("GPU detected: {name}", { name: gpu.name }) : t("GPU detected: {name}, {total} GiB, {free} GiB free", { name: gpu.name, total: gib(gpu.totalMiB), free: gib(gpu.freeMiB ?? 0) })}</p>
      : fresh && <p className="text-xs text-fg-faint">{hardware.checked ? t("No GPU detected. Voice needs an NVIDIA GPU that Docker can use.") : t("GPU not checked yet. It is checked while installing, and you are told if your choice does not fit.")}</p>)}
    {auto
      ? <p className="text-xs text-fg-faint">{gpu && suggestion
        ? t("Suggested for this GPU: {tts} with {asr}.", { tts: TTS_ENGINES[suggestion.tts].label, asr: asrOption(suggestion)?.label ?? suggestion.asrModel })
        : t("The install picks what fits your GPU.")}</p>
      : gpu && !kept && <p role={fit === "too-large" ? "alert" : "status"} className={`text-xs ${fit === "fits" ? "text-fg-faint" : fit === "tight" ? "text-warn" : "text-red-400"}`}>
        {fit === "too-large" ? t("Needs about {gib} GiB of GPU memory, more than this GPU has.", { gib: need })
          : fit === "tight" ? t("Needs about {gib} GiB of GPU memory. The card is big enough, but other programs use part of it right now.", { gib: need })
            : t("Needs about {gib} GiB of GPU memory. Fits.", { gib: need })}
        {fit === "too-large" && suggestion && !sameChoice(suggestion, shown) && <> <button type="button" className={btnCls} onClick={() => onPick(installed && sameChoice(suggestion, installed) ? null : suggestion)}>{t("Use the suggestion")}</button></>}
      </p>}
    {installed && picked && <p className="text-xs text-fg-faint">{t("Switching engines recreates the voice container. Downloaded models are kept.")}</p>}
  </div>;
}
