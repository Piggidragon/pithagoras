import { LuCheck, LuClock, LuLoaderCircle, LuPlay, LuTerminal, LuX } from "react-icons/lu";
import type { CommandState, Item } from "../transcript";

const SAID: Record<CommandState, string> = {
  running: "running…",
  done: "",
  quiet: "done — it had nothing to show",
  started: "started a run",
  queued: "runs when this one ends",
  failed: "failed",
};

/**
 * A slash command in the chat: what was sent, on the side of what you send,
 * and how it went. What it answered follows it as its own lines.
 */
export function CommandLine({ item }: { item: Extract<Item, { kind: "command" }> }) {
  const Icon = { running: LuLoaderCircle, done: LuCheck, quiet: LuCheck, started: LuPlay, queued: LuClock, failed: LuX }[item.state];
  return (
    <div className={`command-line is-${item.state}`} role="status" aria-label={`${item.text}: ${SAID[item.state] || "done"}`}>
      <span className="command-line-pill">
        <LuTerminal className="command-line-kind" aria-hidden />
        <code>{item.text}</code>
        <Icon className={`command-line-state ${item.state === "running" ? "animate-spin" : ""}`} aria-hidden />
      </span>
      {SAID[item.state] && item.state !== "failed" && <span className="command-line-said">{SAID[item.state]}</span>}
      {item.state === "failed" && <span className="command-line-said is-error">{item.error || "failed"}</span>}
    </div>
  );
}
