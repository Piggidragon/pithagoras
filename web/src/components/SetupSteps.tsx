import { LuCheck } from "react-icons/lu";
import { t } from "../i18n";

/**
 * Where a first-run wizard is: a numbered bar per step, the ones behind it
 * ticked. A screen reader hears the step change, which it would not see.
 */
export function SetupSteps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <>
      <ol className="setup-steps" aria-label={t("Steps")}>
        {steps.map((title, i) => (
          <li key={title} className={`setup-step ${i < current ? "is-done" : i === current ? "is-current" : ""}`} aria-current={i === current ? "step" : undefined}>
            <span className="flex items-center gap-1">
              {i < current && <LuCheck className="h-3 w-3 text-ok" />}
              <span className="font-medium">{i + 1}. {t(title)}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="sr-only" aria-live="polite">{t("Step {n} of {total}", { n: current + 1, total: steps.length })}</p>
    </>
  );
}
