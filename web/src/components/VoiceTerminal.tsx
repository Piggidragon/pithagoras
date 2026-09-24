import { useEffect, useLayoutEffect, useRef } from 'react';
import type { PortalEvent } from '../api';
import { useFollowBottom } from '../use-follow-bottom';

export const SHELL_TOOL = /^(bash|shell|terminal|exec_command)$/;

export function terminalRuns(events: PortalEvent[], limit = 6, maxOutput = 20000) {
  const runs: { id: string; command: string; output: string; running: boolean; error: boolean }[] = [];
  for (const event of events) {
    const p = event.payload ?? {};
    if (event.type === 'tool_execution_start' && SHELL_TOOL.test(p.toolName ?? p.name ?? '')) {
      const input = p.input ?? p.args ?? p.parameters ?? {};
      runs.push({ id: p.toolCallId ?? String(event.seq), command: input.command ?? input.cmd ?? p.toolName, output: '', running: true, error: false });
    } else if (event.type === 'tool_execution_update' || event.type === 'tool_execution_end') {
      const run = p.toolCallId ? runs.find(r => r.id === p.toolCallId) : [...runs].reverse().find(r => r.running && SHELL_TOOL.test(p.toolName ?? p.name ?? ''));
      if (!run) continue;
      const result = p.partialResult ?? p.result;
      const text = result?.content?.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
      if (typeof text === 'string') run.output = text.slice(-maxOutput);
      if (event.type === 'tool_execution_end') { run.running = false; run.error = !!p.isError; }
    }
  }
  return runs.slice(-limit);
}

/**
 * What the agent ran and what came back, as a terminal would show it.
 *
 * `focus` is a tool call to bring into view — "Show the whole output" on a call
 * in the chat — marked for a moment so the eye finds it among the others.
 */
export function VoiceTerminal({ events, limit, maxOutput, focus }: { events: PortalEvent[]; limit?: number; maxOutput?: number; focus?: { id: string; at: number } | null }) {
  const { ref, onScroll, follow } = useFollowBottom<HTMLDivElement>();
  const runs = terminalRuns(events, limit, maxOutput);
  const focused = useRef<string | null>(null);
  // Follows new output, but leaves you where you scrolled to read earlier lines.
  // Before paint, so new lines are never shown at the old scroll position.
  useLayoutEffect(() => { if (!focused.current) follow(); }, [events]);
  useEffect(() => {
    if (!focus || !ref.current) return;
    const el = ref.current.querySelector<HTMLElement>(`[data-run="${CSS.escape(focus.id)}"]`);
    if (!el) return;
    focused.current = focus.id;
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    el.classList.remove('is-focused');
    void el.offsetWidth;
    el.classList.add('is-focused');
    const t = window.setTimeout(() => { focused.current = null; }, 1200);
    return () => window.clearTimeout(t);
  }, [focus?.id, focus?.at]);
  return <div ref={ref} onScroll={onScroll} className="voice-terminal-output" aria-label="Agent terminal output">
    {!runs.length && <p className="voice-terminal-empty">No commands yet. What the agent runs shows up here as it runs.</p>}
    {runs.map(run => <div key={run.id} data-run={run.id} className="voice-terminal-run">
      <div className="voice-terminal-command"><span aria-hidden>$</span><code>{run.command}</code>{run.running && <i aria-label="Command running" />}</div>
      {run.output && <pre className={run.error ? 'is-error' : ''}>{run.output.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')}</pre>}
    </div>)}
  </div>;
}
