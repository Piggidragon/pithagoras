import type { ReactNode } from "react";

/**
 * The pieces every Settings page is built from, so the pages look like one
 * dialog rather than ten: a titled section, a quiet empty state, a switch,
 * and the three kinds of field and button.
 */

export function Section({ title, hint, action, children }: { title: string; hint?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="settings-section mb-7">
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-60">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">{title}</h3>
          {hint && <p className="mt-0.5 text-xs text-fg-subtle">{hint}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-3 py-8 text-center text-sm text-fg-subtle">
      {children}
    </div>
  );
}

/** A labelled field, with what it does underneath. */
export function Field({ label, hint, children, className = "" }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-xs text-fg-muted">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-[11px] text-fg-faint">{hint}</span>}
    </label>
  );
}

/** On or off, said with a switch rather than a checkbox: it takes effect at once. */
export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="shrink-0 disabled:opacity-40"
    >
      <span className={`relative block h-5 w-9 rounded-full transition-colors ${on ? "bg-accent" : "bg-fg/15"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all duration-200 ${on ? "left-[1.125rem]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

/** A setting that is a switch: what it is on the left, the switch on the right. */
export function SwitchRow({ title, detail, on, onChange, disabled, note }: { title: ReactNode; detail?: ReactNode; on: boolean; onChange: (on: boolean) => void; disabled?: boolean; note?: ReactNode }) {
  return (
    <div className={`flex items-start gap-3 rounded-xl border border-line bg-raised/40 p-3 ${disabled ? "opacity-60" : ""}`}>
      <div className="min-w-0 flex-1 text-sm text-fg">
        {title}
        {detail && <span className="mt-0.5 block text-xs text-fg-faint">{detail}</span>}
        {note && <span className="mt-1 block text-xs text-warn">{note}</span>}
      </div>
      <Switch on={on} onChange={onChange} disabled={disabled} label={typeof title === "string" ? title : "Switch"} />
    </div>
  );
}

export const inputCls =
  "w-full rounded-lg border border-line bg-raised/60 px-3 py-2 text-sm outline-none transition placeholder:text-fg-faint focus:border-accent/60";
export const btnCls =
  "inline-flex items-center gap-1.5 rounded-lg bg-fg/5 px-3 py-2 text-sm text-fg transition hover:bg-fg/10 disabled:opacity-40";
export const primaryCls =
  "inline-flex items-center gap-1.5 rounded-lg bg-accent/12 px-3 py-2 text-sm text-accent ring-1 ring-inset ring-accent/25 transition hover:bg-accent/20 disabled:opacity-40";
export const ghostCls =
  "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-fg-muted transition hover:bg-fg/5 hover:text-fg disabled:opacity-40";
