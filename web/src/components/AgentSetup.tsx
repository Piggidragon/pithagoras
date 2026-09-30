import { useState } from "react";
import { LuArrowLeft, LuArrowRight, LuBot, LuCheck, LuRefreshCw, LuUser } from "react-icons/lu";
import { api, type AgentSetup as Setup } from "../api";
import { isEnter } from "../shortcuts";
import { ghostCls, primaryCls } from "./SettingsUi";
import { msg, t } from "../i18n";

const STEPS = [msg("Who it is"), msg("Who it works for")];

const inputCls =
  "w-full rounded-lg border border-line bg-raised/60 px-3 py-2 text-sm outline-none transition placeholder:text-fg-faint focus:border-accent/60";

/**
 * First run for the agent's home directory.
 *
 * Two questions, because the two things the agent cannot work out for itself
 * are who it is and who it is talking to. Everything else has a sensible
 * starting point, and the files are editable afterwards.
 */
export function AgentSetup({ home, onDone }: { home: string; onDone: (s: Setup) => void }) {
  const [step, setStep] = useState(0);
  const [agentName, setAgentName] = useState("");
  const [vibe, setVibe] = useState("");
  const [userName, setUserName] = useState("");
  const [userAbout, setUserAbout] = useState("");
  const [userPrefers, setUserPrefers] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = (to: number) => {
    setError(null);
    setStep(to);
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(
        await api.runAgentWizard({ agentName, vibe, userName, userAbout, userPrefers })
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-10">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/12 text-accent">
          <LuBot className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-fg">{t("Set up the agent")}</h2>
          <p className="mt-0.5 text-sm text-fg-muted">
            {t("Every channel talks to one agent, and it keeps what it learns. Two questions and it has somewhere to start.")}
          </p>
          <p className="mt-1 truncate font-mono text-[11px] text-fg-faint">{home}</p>
        </div>
      </div>

      <p className="mt-6 text-[11px] text-fg-faint">{t("Step {n} of {total}", { n: step + 1, total: STEPS.length })}</p>
      <div className="mt-2 flex items-center gap-2" aria-hidden="true">
        {STEPS.map((_, i) => (
          <div
            key={i}
            className={`h-0.5 flex-1 rounded-full transition ${
              i <= step ? "bg-accent" : "bg-fg/10"
            }`}
          />
        ))}
      </div>

      {step === 0 ? (
        <section className="mt-6 space-y-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
            <LuBot className="h-3.5 w-3.5" /> {t(STEPS[0])}
          </div>

          <label className="block">
            <span className="text-xs text-fg-muted">{t("Name")}</span>
            <input
              autoFocus
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              onKeyDown={(e) => isEnter(e) && agentName.trim() && go(1)}
              placeholder="Aria"
              className={`${inputCls} mt-1`}
            />
          </label>

          <label className="block">
            <span className="text-xs text-fg-muted">{t("Character")}</span>
            <textarea
              value={vibe}
              onChange={(e) => setVibe(e.target.value)}
              rows={5}
              placeholder={t("How it should come across. Direct and a bit dry? Careful and thorough? Leave it empty for a sensible default you can edit later.")}
              className={`${inputCls} mt-1 resize-y text-xs leading-relaxed`}
            />
            <p className="mt-1 text-[11px] text-fg-faint">{t("Becomes SOUL.md.")}</p>
          </label>

          <button disabled={!agentName.trim()} onClick={() => go(1)} className={primaryCls}>
            {t("Next")} <LuArrowRight className="h-4 w-4" />
          </button>
        </section>
      ) : (
        <section className="mt-6 space-y-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
            <LuUser className="h-3.5 w-3.5" /> {t(STEPS[1])}
          </div>

          <label className="block">
            <span className="text-xs text-fg-muted">{t("Your name")}</span>
            <input
              autoFocus
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder="Anirban"
              className={`${inputCls} mt-1`}
            />
          </label>

          <label className="block">
            <span className="text-xs text-fg-muted">{t("About you")}</span>
            <textarea
              value={userAbout}
              onChange={(e) => setUserAbout(e.target.value)}
              rows={4}
              placeholder={t("What you work on, what you care about, anything it should assume rather than ask.")}
              className={`${inputCls} mt-1 resize-y text-xs leading-relaxed`}
            />
          </label>

          <label className="block">
            <span className="text-xs text-fg-muted">{t("How to answer you")}</span>
            <textarea
              value={userPrefers}
              onChange={(e) => setUserPrefers(e.target.value)}
              rows={3}
              placeholder={t("Short and blunt? Show the reasoning? Never guess?")}
              className={`${inputCls} mt-1 resize-y text-xs leading-relaxed`}
            />
            <p className="mt-1 text-[11px] text-fg-faint">{t("Becomes PrimaryUser.md.")}</p>
          </label>

          {error && <p className="text-xs text-danger">{error}</p>}

          <div className="flex items-center gap-2">
            {/* Not while Create runs: its error shows on this step only. */}
            <button disabled={busy} onClick={() => go(0)} className={ghostCls}>
              <LuArrowLeft className="h-3.5 w-3.5" /> {t("Back")}
            </button>
            <button disabled={!userName.trim() || busy} onClick={create} className={primaryCls}>
              {busy ? (
                <LuRefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <LuCheck className="h-4 w-4" />
              )}
              {t("Create")}
            </button>
          </div>
        </section>
      )}

      <p className="mt-8 text-[11px] leading-relaxed text-fg-faint">
        {t("Writes SOUL.md, PrimaryUser.md and MEMORY.md into the agent's home directory. All three are handed to pi as context whenever a conversation starts, and stay editable here. An existing MEMORY.md is never overwritten.")}
      </p>
    </div>
  );
}
