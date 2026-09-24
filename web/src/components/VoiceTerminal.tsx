import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { PortalEvent } from '../api';
import { useFollowBottom } from '../use-follow-bottom';
import { SHELL_TOOL } from '../tool-activity';
import { stripAnsi, toolOutputText } from '../transcript';

type Run = { id: string; command: string; output: string; running: boolean; error: boolean };

export function terminalRuns(events: PortalEvent[], limit = 6, maxOutput = 20000) {
  const runs: Run[] = [];
  for (const event of events) {
    const p = event.payload ?? {};
    if (event.type === 'tool_execution_start' && SHELL_TOOL.test(p.toolName ?? p.name ?? '')) {
      const input = p.input ?? p.args ?? p.parameters ?? {};
      runs.push({ id: p.toolCallId ?? String(event.seq), command: input.command ?? input.cmd ?? p.toolName, output: '', running: true, error: false });
    } else if (event.type === 'tool_execution_update' || event.type === 'tool_execution_end') {
      const run = p.toolCallId ? runs.find(r => r.id === p.toolCallId) : [...runs].reverse().find(r => r.running && SHELL_TOOL.test(p.toolName ?? p.name ?? ''));
      if (!run) continue;
      const text = toolOutputText(p.partialResult ?? p.result);
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
 * `onFocused` hands it back once it has been shown, so opening the terminal
 * again later does not scroll back to it.
 */
export function VoiceTerminal({ events, limit, maxOutput, focus, onFocused }: {
  events: PortalEvent[];
  limit?: number;
  maxOutput?: number;
  focus?: { id: string; at: number } | null;
  onFocused?: () => void;
}) {
  const { ref, onScroll, follow } = useFollowBottom<HTMLDivElement>();
  const runs = useMemo(() => terminalRuns(events, limit, maxOutput), [events, limit, maxOutput]);
  // The command being shown, while it is: new output does not scroll away from it.
  const focused = useRef<string | null>(null);
  const release = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(release.current), []);
  // Follows new output, but leaves you where you scrolled to read earlier lines.
  // Before paint, so new lines are never shown at the old scroll position.
  useLayoutEffect(() => { if (!focused.current) follow(); }, [events]);
  useEffect(() => {
    if (!focus || !ref.current) return;
    onFocused?.();
    const el = ref.current.querySelector<HTMLElement>(`[data-run="${CSS.escape(focus.id)}"]`);
    // Not among those drawn: whatever was being shown before keeps its own release.
    if (!el) return;
    window.clearTimeout(release.current);
    focused.current = focus.id;
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    el.classList.remove('is-focused');
    void el.offsetWidth;
    el.classList.add('is-focused');
    release.current = window.setTimeout(() => { focused.current = null; }, 1200);
  }, [focus?.id, focus?.at]);
  return <div ref={ref} onScroll={onScroll} className="voice-terminal-output" aria-label="Agent terminal output">
    {!runs.length && <p className="voice-terminal-empty">No commands yet. What the agent runs shows up here as it runs.</p>}
    {runs.map(run => <TerminalRun key={run.id} {...run} />)}
  </div>;
}

/** One command. Kept apart so a run whose output has not changed is not cleaned of its codes again. */
const TerminalRun = memo(function TerminalRun({ id, command, output, running, error }: Run) {
  const shown = useMemo(() => stripAnsi(output), [output]);
  return <div data-run={id} className="voice-terminal-run">
    <div className="voice-terminal-command"><span aria-hidden>$</span><code>{command}</code>{running && <i aria-label="Command running" />}</div>
    {shown && <pre className={error ? 'is-error' : ''}>{shown}</pre>}
  </div>;
});
