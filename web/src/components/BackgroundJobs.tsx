import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LuSquare, LuTrash2 } from "react-icons/lu";
import { api, type BackgroundState } from "../api";
import { useFollowBottom } from "../use-follow-bottom";
import { formatElapsed } from "./ChatActivity";

/** Output kept on screen for one job; the file has the rest. */
const KEEP = 400_000;

/**
 * The agent's background jobs, in the terminal panel: which are running and
 * for how long, and one of them followed as it writes — like a background
 * shell in Claude Code. What extensions show in pi's footer is above them.
 */
export function BackgroundJobs({
  sessionId,
  state,
  selected,
  onSelect,
  onChanged,
}: {
  sessionId: string;
  state: BackgroundState;
  selected: string | null;
  onSelect: (key: string) => void;
  onChanged: () => void;
}) {
  const jobs = state.jobs.filter((j) => !j.attached);
  const job = jobs.find((j) => j.key === selected) ?? jobs[0];
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const took = (from: number, to?: number) => formatElapsed(Math.max(0, Math.floor(((to ?? now) - from) / 1000)));

  return (
    <div className="bg-jobs">
      {(state.statuses.length > 0 || state.widgets.length > 0) && (
        <div className="bg-ext">
          {state.statuses.map((s) => (
            <div key={s.key} className="bg-ext-status"><span>{s.key}</span>{s.text}</div>
          ))}
          {state.widgets.map((w) => (
            <pre key={w.key} className="bg-ext-widget">{w.lines.join("\n")}</pre>
          ))}
        </div>
      )}
      {!state.supported && (
        <p className="bg-jobs-empty">Background jobs can only be followed when pi runs on the host (EXECUTOR=host).</p>
      )}
      {state.supported && !jobs.length && (
        <p className="bg-jobs-empty">Nothing running in the background. What the agent leaves running — a dev server, a watcher, an extension's job — shows up here.</p>
      )}
      {jobs.length > 0 && (
        <>
          <div className="bg-jobs-list">
            <div role="listbox" aria-label="Background jobs" className="contents">
            {jobs.map((j) => (
              <button
                key={j.key}
                type="button"
                role="option"
                aria-selected={j.key === job?.key}
                onClick={() => onSelect(j.key)}
                className={`bg-job is-${j.state}`}
              >
                <i className="bg-job-dot" aria-hidden />
                <span className="bg-job-command">{j.command}</span>
                <span className="bg-job-meta">
                  {j.state === "exited" ? `finished · ran ${took(j.startedAt, j.exitedAt)}` : j.state === "stopped" ? "paused" : took(j.startedAt)}
                </span>
              </button>
            ))}
            </div>
            {jobs.some((j) => j.state === "exited") && (
              <button type="button" className="bg-jobs-clear" onClick={() => void api.clearBackground(sessionId).then(onChanged)} title="Forget the finished jobs">
                <LuTrash2 aria-hidden /> Clear finished
              </button>
            )}
          </div>
          {job && (
            <div className="bg-job-view">
              <div className="bg-job-head">
                <code>{job.command}</code>
                <span className={`bg-job-state is-${job.state}`}>{job.state === "exited" ? "finished" : job.state === "stopped" ? "paused" : "running"}</span>
                {job.pids.length > 0 && <span className="bg-job-pid">pid {job.pids.join(", ")}</span>}
                {job.state !== "exited" && (
                  <button
                    type="button"
                    className="bg-job-stop"
                    onClick={() => {
                      setError(null);
                      api.stopBackground(sessionId, job.key).then(onChanged, (e) => setError((e as Error).message));
                    }}
                  >
                    <LuSquare aria-hidden fill="currentColor" /> Stop
                  </button>
                )}
              </div>
              {error && <p className="bg-jobs-error">{error}</p>}
              {job.hasOutput ? (
                <JobOutput key={job.key} sessionId={sessionId} jobKey={job.key} live={job.state !== "exited"} />
              ) : (
                <p className="bg-jobs-empty">This job's output does not go to a file, so it cannot be followed from here{job.attached ? " — it is a command the chat shows." : "."}</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** One job's output file, followed from where it was last read. */
function JobOutput({ sessionId, jobKey, live }: { sessionId: string; jobKey: string; live: boolean }) {
  const [text, setText] = useState("");
  const [gone, setGone] = useState<string | null>(null);
  const offset = useRef<number | undefined>(undefined);
  const { ref, onScroll, follow } = useFollowBottom<HTMLPreElement>();
  useEffect(() => {
    let stop = false;
    let timer = 0;
    const read = async () => {
      try {
        const out = await api.backgroundOutput(sessionId, jobKey, offset.current);
        if (stop) return;
        offset.current = out.size;
        if (out.text) setText((t) => (t + out.text).slice(-KEEP));
      } catch (e) {
        if (!stop) setGone((e as Error).message);
        return;
      }
      if (!stop && live) timer = window.setTimeout(read, 1000);
    };
    void read();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [sessionId, jobKey, live]);
  useLayoutEffect(() => follow(), [text]);
  if (gone) return <p className="bg-jobs-empty">{gone}</p>;
  return (
    <pre ref={ref} onScroll={onScroll} className="bg-job-output">
      {text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "") || (live ? "Waiting for output…" : "(no output)")}
    </pre>
  );
}
