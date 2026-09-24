import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Streamdown } from "streamdown";
import { LuArrowUp, LuBot, LuSquare } from "react-icons/lu";
import { api } from "../api";
import { buildTranscript, type Item } from "../transcript";
import { reportedSteps, type Subagent } from "../subagents";
import { useFollowBottom } from "../use-follow-bottom";
import { CompactionMarker, Ring, Shimmer, ThinkingBlock, ToolCall, formatElapsed } from "./ChatActivity";
import { isEnter } from "../shortcuts";

/**
 * The subagents of a chat, one at a time: what it is doing, drawn like the
 * conversation itself, and — where its extension takes messages — a box to
 * tell it something.
 */
export function SubagentPanel({
  sessionId,
  agents,
  items,
  selected,
  onSelect,
}: {
  sessionId: string;
  agents: Subagent[];
  /** The main conversation, where a tool-reported subagent's output is. */
  items: Item[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const agent = agents.find((a) => a.id === selected) ?? agents[agents.length - 1];
  if (!agents.length || !agent) {
    return (
      <div className="sub-panel">
        <p className="bg-jobs-empty">
          No subagents in this chat yet. An extension's agent shows up here while it works — and takes messages if the extension speaks the subagent protocol.
        </p>
      </div>
    );
  }
  return (
    <div className="sub-panel">
      {agents.length > 1 && (
        <div className="sub-tabs" role="tablist" aria-label="Subagents">
          {agents.map((a) => (
            <button key={a.id} type="button" role="tab" aria-selected={a.id === agent.id} onClick={() => onSelect(a.id)} className={`sub-tab is-${a.status}`}>
              {a.status === "running" ? <Ring /> : <i className="bg-job-dot" aria-hidden />}
              {a.label}
            </button>
          ))}
        </div>
      )}
      <AgentView key={agent.id} sessionId={sessionId} agent={agent} items={items} />
    </div>
  );
}

function AgentView({ sessionId, agent, items }: { sessionId: string; agent: Subagent; items: Item[] }) {
  const [now, setNow] = useState(() => Date.now());
  const running = agent.status === "running";
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [running]);
  const { ref, onScroll, follow } = useFollowBottom<HTMLDivElement>();
  const childItems = useMemo(() => (agent.kind === "protocol" ? buildTranscript(agent.events) : []), [agent]);
  const tool = agent.kind === "tool" ? items.find((i): i is Extract<Item, { kind: "tool" }> => i.kind === "tool" && `tool:${i.callId ?? i.id}` === agent.id) : undefined;
  useLayoutEffect(() => follow(), [childItems, tool?.output, tool?.details]);
  const seconds = agent.since ? Math.max(0, Math.floor(((running ? now : agent.until ?? now) - agent.since) / 1000)) : undefined;

  return (
    <>
      <div className="sub-head">
        <span className="sub-head-icon">{running ? <Ring /> : <LuBot aria-hidden />}</span>
        <div className="min-w-0 flex-1">
          <div className="sub-head-title">{agent.label}</div>
          <div className="sub-head-detail">
            {running ? <Shimmer>{agent.detail ?? "Working"}</Shimmer> : agent.status === "done" ? "Finished" : agent.status === "stopped" ? "Stopped" : agent.error ?? "Failed"}
            {seconds !== undefined && ` · ${formatElapsed(seconds)}`}
          </div>
        </div>
        {agent.stop && running && (
          <button type="button" className="bg-job-stop" onClick={() => void api.subagentStop(sessionId, agent.id).catch(() => undefined)}>
            <LuSquare aria-hidden fill="currentColor" /> Stop
          </button>
        )}
      </div>
      <div ref={ref} onScroll={onScroll} className="sub-body">
        {agent.kind === "protocol" ? (
          childItems.length ? childItems.map((item) => <ChildItem key={item.id} item={item} running={running} />) : <p className="bg-jobs-empty"><Shimmer>Starting…</Shimmer></p>
        ) : (
          tool && <ToolReport tool={tool} running={running} />
        )}
      </div>
      <AgentInput sessionId={sessionId} agent={agent} />
    </>
  );
}

function ChildItem({ item, running }: { item: Item; running: boolean }) {
  switch (item.kind) {
    case "user":
      return <div className="sub-prompt">{item.text}</div>;
    case "assistant":
      return (
        <div className="sub-reply">
          {item.thinking && <ThinkingBlock thinking={item.thinking} streaming={running && !item.done && !item.text} since={item.thinkingSince} until={item.thinkingUntil} />}
          {item.text && (
            <div className="md text-[13px] leading-relaxed text-fg">
              <Streamdown parseIncompleteMarkdown animated={{ animation: "blurIn", duration: 240, sep: "word" }} isAnimating={running && !item.done}>
                {item.text}
              </Streamdown>
            </div>
          )}
        </div>
      );
    case "tool":
      return <div className="tool-row"><ToolCall item={item} /></div>;
    case "compaction":
      return <CompactionMarker item={item} />;
    default:
      return <div className="sub-notice">{item.text}</div>;
  }
}

/** A tool that is not on the protocol: its steps where its details list them, and its text. */
function ToolReport({ tool, running }: { tool: Extract<Item, { kind: "tool" }>; running: boolean }) {
  const steps = reportedSteps(tool.details);
  return (
    <>
      {steps.map((s, i) =>
        s.type === "toolCall" ? (
          <div key={i} className="tool-row">
            <ToolCall item={{ kind: "tool", id: `s${i}`, name: s.name!, status: running && i === steps.length - 1 ? "running" : "done", args: s.args }} />
          </div>
        ) : (
          <div key={i} className="md text-[13px] text-fg-muted"><Streamdown>{s.text!}</Streamdown></div>
        ),
      )}
      {tool.output && (
        <div className="md text-[13px] leading-relaxed text-fg">
          <Streamdown parseIncompleteMarkdown>{tool.output}</Streamdown>
        </div>
      )}
      {!steps.length && !tool.output && running && <p className="bg-jobs-empty"><Shimmer>Working…</Shimmer></p>}
    </>
  );
}

function AgentInput({ sessionId, agent }: { sessionId: string; agent: Subagent }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string[]>([]);
  if (agent.status !== "running") return null;
  if (!agent.input) {
    return (
      <p className="sub-input-note">
        {agent.kind === "tool"
          ? "This extension does not take messages for its agent. It can, by speaking the subagent protocol."
          : "This subagent does not take messages."}
      </p>
    );
  }
  const send = async () => {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    setError(null);
    try {
      await api.subagentInput(sessionId, agent.id, message);
      setSent((s) => [...s, message]);
      setText("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="sub-input">
      {sent.length > 0 && <div className="sub-input-sent">Sent: “{sent[sent.length - 1]}”</div>}
      {error && <p className="bg-jobs-error">{error}</p>}
      <div className="sub-input-box">
        <textarea
          value={text}
          rows={2}
          placeholder={`Tell ${agent.label} something…`}
          aria-label={`Message for ${agent.label}`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (isEnter(e) && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button type="button" className="prompt-action prompt-send" aria-label="Send to the subagent" disabled={!text.trim() || sending} onClick={() => void send()}>
          <LuArrowUp aria-hidden className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
