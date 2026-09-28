import { useEffect, useState } from "react";
import { api, type PiModel } from "../api";
import { Select } from "./Select";

/**
 * What this chat's subagents run on, in its model menu: the portal's default,
 * the chat's own model, or one named. Only while the subagent tool is on —
 * otherwise there is nothing for it to decide. Asked when a subagent starts,
 * so a change needs no restart.
 */
export function SubagentModelPicker({ sessionId, models, onError }: { sessionId: string; models: PiModel[]; onError?: (e: string) => void }) {
  const [on, setOn] = useState(false);
  const [choice, setChoice] = useState<{ model: string | null; default: string } | null>(null);

  useEffect(() => {
    let current = true;
    api
      .features()
      .then((f) => {
        if (!current || !f.subagent.enabled) return;
        setOn(true);
        return api.subagentModel(sessionId).then((c) => current && setChoice(c));
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [sessionId]);

  if (!on || !choice) return null;
  const named = (value: string) => (value === "auto" ? "this chat's model" : value);
  const change = (value: string) => {
    const model = value === "" ? null : value;
    setChoice({ ...choice, model });
    api.setSubagentModel(sessionId, model).then(setChoice, (e: Error) => onError?.(e.message));
  };
  const value = choice.model ?? "";
  return (
    <div className="px-3 py-1.5">
      <p className="text-[11px] text-fg-subtle">Subagents in this chat run on</p>
      <Select
        aria-label="Subagents in this chat run on"
        size="sm"
        className="mt-1 w-full"
        value={value}
        onChange={change}
        options={[
          { value: "", label: `Default — ${named(choice.default)}` },
          { value: "auto", label: "This chat's model", hint: "The one it is on when it starts one" },
          ...(value && value !== "auto" && !models.some((m) => `${m.provider}/${m.id}` === value) ? [{ value, label: value }] : []),
          ...models.map((m) => ({ value: `${m.provider}/${m.id}`, label: m.name || m.id, hint: `${m.provider}/${m.id}` })),
        ]}
      />
    </div>
  );
}
