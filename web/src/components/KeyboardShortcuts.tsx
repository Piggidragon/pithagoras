import { useEffect, useState } from "react";
import { LuRotateCcw } from "react-icons/lu";
import { ACTIONS, FIXED, bindingOf, describe, resetAll, resetBinding, setBinding, useKeyLabels, useKeybindings, type ActionId } from "../keybindings";

const btnCls = "inline-flex items-center gap-1.5 rounded-lg bg-fg/5 px-2.5 py-1.5 text-xs text-fg transition hover:bg-fg/10 disabled:opacity-40";
const kbdCls = "inline-flex min-w-[2rem] justify-center rounded-md border border-line bg-raised px-2 py-0.5 font-mono text-xs text-fg shadow-[inset_0_-1px_0_rgb(var(--line))]";

/**
 * Every keyboard shortcut, and a way to change the ones that can be.
 *
 * Changing one listens for the next key pressed, with whatever modifiers are
 * held — Escape included, since Escape is a fine shortcut, so it is Cancel
 * that takes it back. A key another action already has moves to this one, and
 * the list says which lost it. Kept in this browser.
 */
export function KeyboardShortcuts() {
  const bindings = useKeybindings();
  const layout = useKeyLabels();
  const [recording, setRecording] = useState<ActionId | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!recording) return;
    const take = (e: KeyboardEvent) => {
      // Before anything else on the page sees it: Escape would close the dialog.
      e.preventDefault(); e.stopPropagation();
      const binding = bindingOf(e);
      if (!binding) return;
      const took = setBinding(recording, binding);
      const label = ACTIONS.find(a => a.id === took)?.label;
      setNote(label ? `${describe(binding, layout)} was used for “${label}”, which now has no shortcut.` : "");
      setRecording(null);
    };
    const swallow = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); };
    window.addEventListener("keydown", take, true);
    window.addEventListener("keyup", swallow, true);
    return () => { window.removeEventListener("keydown", take, true); window.removeEventListener("keyup", swallow, true); };
  }, [recording, layout]);

  const changed = ACTIONS.some(a => describe(bindings[a.id], null, false) !== describe(a.default, null, false));
  return <div>
    <section className="mb-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">Voice mode</h3>
          <p className="mt-0.5 text-xs text-fg-subtle">
            Work while voice mode is on, except when typing in a field. Starting voice mode works from the chat too.
            Kept in this browser.
          </p>
        </div>
        <button className={`${btnCls} shrink-0 whitespace-nowrap`} disabled={!changed} onClick={() => { resetAll(); setNote(""); setRecording(null); }}><LuRotateCcw className="h-3.5 w-3.5" />Reset all</button>
      </div>
      {note && <p role="status" className="mt-2 rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn">{note}</p>}
      <ul className="mt-2.5 divide-y divide-line rounded-xl border border-line bg-raised/40" aria-label="Voice mode shortcuts">
        {ACTIONS.map(action => {
          const binding = bindings[action.id];
          const isDefault = describe(binding, null, false) === describe(action.default, null, false);
          const listening = recording === action.id;
          return <li key={action.id} className="flex flex-wrap items-center gap-2 px-3 py-2" aria-label={action.label}>
            <span className="min-w-0 flex-1 text-sm text-fg">{action.label}</span>
            {listening
              ? <span className="text-xs text-accent" role="status">Press the new keys…</span>
              : binding ? <kbd className={kbdCls}>{describe(binding, layout)}</kbd> : <span className="text-xs text-fg-faint">None</span>}
            <div className="flex gap-1">
              {listening
                ? <button className={btnCls} onClick={() => setRecording(null)}>Cancel</button>
                : <button className={btnCls} onClick={() => { setNote(""); setRecording(action.id); }}>Change</button>}
              <button className={btnCls} disabled={listening || !binding} onClick={() => { setBinding(action.id, null); setNote(""); }}>Clear</button>
              <button className={btnCls} disabled={listening || isDefault} title={`Back to ${describe(action.default, layout) || "none"}`} onClick={() => {
                const took = resetBinding(action.id);
                const label = ACTIONS.find(a => a.id === took)?.label;
                setNote(label ? `That was used for “${label}”, which now has no shortcut.` : "");
              }}>Reset</button>
            </div>
          </li>;
        })}
      </ul>
    </section>
    <section className="mb-6">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">Chat</h3>
      <p className="mt-0.5 text-xs text-fg-subtle">Part of how the message box works, so they are fixed.</p>
      <ul className="mt-2.5 divide-y divide-line rounded-xl border border-line bg-raised/40" aria-label="Chat shortcuts">
        {FIXED.map(item => <li key={item.label} className="flex items-center gap-2 px-3 py-2">
          <span className="min-w-0 flex-1 text-sm text-fg">{item.label}</span>
          <kbd className={kbdCls}>{item.keys}</kbd>
        </li>)}
      </ul>
    </section>
  </div>;
}
