import { useEffect, useState } from "react";
import { LuBot, LuSquareTerminal } from "react-icons/lu";
import type { BackgroundJob } from "../api";
import type { Subagent } from "../subagents";
import { formatElapsed } from "../transcript";
import { Ring } from "./ChatActivity";

/**
 * What is running beside the conversation, just above the box: subagents,
 * jobs the agent left running, and the status lines extensions set. Each opens
 * its window; the tray itself says only that it is going and for how long.
 */
export function RunningTray({
  agents,
  jobs,
  statuses,
  onAgent,
  onJob,
}: {
  agents: Subagent[];
  jobs: BackgroundJob[];
  statuses: { key: string; text: string }[];
  onAgent: (id: string) => void;
  onJob: (key: string) => void;
}) {
  const runningAgents = agents.filter((a) => a.status === "running");
  const runningJobs = jobs.filter((j) => j.state !== "exited" && !j.attached);
  const any = runningAgents.length + runningJobs.length + statuses.length > 0;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!runningAgents.length && !runningJobs.length) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [runningAgents.length, runningJobs.length]);
  if (!any) return null;
  const since = (at?: number) => (at ? formatElapsed(Math.max(0, Math.floor((now - at) / 1000))) : "");

  return (
    <div className="running-tray" aria-label="Running beside the conversation">
      {runningAgents.map((a) => (
        <button key={a.id} type="button" className="running-chip is-agent" onClick={() => onAgent(a.id)} title={a.detail ? `${a.label} — ${a.detail}` : a.label}>
          <span className="running-chip-icon"><Ring /></span>
          <LuBot className="running-chip-kind" aria-hidden />
          <span className="running-chip-label">{a.label}</span>
          {a.detail && <span className="running-chip-detail">{a.detail}</span>}
          <span className="running-chip-time">{since(a.since)}</span>
        </button>
      ))}
      {runningJobs.map((j) => (
        <button key={j.key} type="button" className="running-chip is-job" onClick={() => onJob(j.key)} title={j.command}>
          <span className="running-chip-icon"><i className="running-dot" /></span>
          <LuSquareTerminal className="running-chip-kind" aria-hidden />
          <span className="running-chip-label is-mono">{j.command}</span>
          <span className="running-chip-time">{j.state === "stopped" ? "paused" : since(j.startedAt)}</span>
        </button>
      ))}
      {statuses.map((s) => (
        <span key={s.key} className="running-chip is-status" title={`${s.key}: ${s.text}`}>
          <span className="running-chip-label">{s.text}</span>
        </span>
      ))}
    </div>
  );
}
