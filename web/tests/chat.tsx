// Development-only fixture: the chat's activity, thinking, tools and compaction, without a server.
// Open /tests/chat.html?phase=model|prefill|thinking|compacting|tools|agents|interrupted to see each state,
// and add &loading=1 for the conversation still arriving.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Chat } from '../src/components/Chat';
import { Select } from '../src/components/Select';
import type { PortalEvent, Session } from '../src/api';
import '../src/styles';
import { installTooltips } from '../src/tooltips';
installTooltips();

const phase = new URLSearchParams(location.search).get('phase') ?? 'tools';
const now = Date.now();
let seq = 0;
const ev = (type: string, payload: any = {}, ago = 0): PortalEvent => ({ seq: ++seq, type, at: now - ago * 1000, payload });
const bash = (id: string, command: string, output: string, end?: { error?: boolean; text?: string }, ago = 30) => [
  ev('tool_execution_start', { toolCallId: id, toolName: 'bash', args: { command } }, ago),
  ev('tool_execution_update', { toolCallId: id, partialResult: { content: [{ type: 'text', text: output }] } }, ago - 1),
  ...(end ? [ev('tool_execution_end', { toolCallId: id, toolName: 'bash', isError: end.error, result: { content: [{ type: 'text', text: end.text ?? output }] } }, ago - 3)] : []),
];
const events: PortalEvent[] = [
  ev('portal_prompt', { message: 'Find out why the build fails and fix it.' }, 120),
  ev('message_end', { message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'The user wants the build fixed.\nFirst I should run the build and read the error.' }, { type: 'text', text: 'Let me run the build first.' }] } }, 110),
  ev('tool_execution_start', { toolCallId: 'r1', toolName: 'read', args: { path: 'web/src/main.tsx', offset: 1, limit: 40 } }, 100),
  ev('tool_execution_end', { toolCallId: 'r1', toolName: 'read', result: { content: [{ type: 'text', text: 'import React from "react";\n…' }] } }, 99.6),
  ...bash('b1', 'npm run build -w web', '> vite build\n✓ 1532 modules transformed.\n✓ built in 6.12s\n', {}, 90),
  ...bash('b2', 'npm test -- --grep "shell outcome"', 'not ok 1 - a shell command says how it ended\n', { error: true, text: 'not ok 1 - a shell command says how it ended\n\nCommand exited with code 1' }, 80),
  ev('compaction_start', {}, 70),
  ev('compaction_end', { result: { summary: 'The user asked to fix the build. The build passes; one test fails.', tokensBefore: 84210 } }, 60),
];
if (phase === 'tools') events.push(ev('turn_start', {}, 20), ...bash('b3', 'for i in $(seq 1 40); do echo "step $i"; sleep 1; done', Array.from({ length: 12 }, (_, i) => `step ${i + 1}`).join('\n'), undefined, 12));
if (phase === 'model') events.push(ev('turn_start', {}, 8), ev('portal_model', { model: 'Qwen3.6-35B-A3B-UD-Q4_K_XL', state: 'loading' }, 7));
if (phase === 'prefill') events.push(ev('turn_start', {}, 8), ev('message_start', { message: { role: 'assistant' } }, 7), ev('portal_prefill', { total: 48000, processed: 20160, cache: 12000 }, 1));
if (phase === 'thinking') events.push(ev('turn_start', {}, 8), ev('message_update', { streamId: 's', assistantMessageEvent: { type: 'thinking_delta', delta: 'The test fails because the regex expects the status at the very end.\nI should check how pi appends it' } }, 5), ev('message_update', { streamId: 's', assistantMessageEvent: { type: 'thinking_delta', delta: ' — it adds two newlines before "Command exited".' } }, 1));
// Slash commands and how each went: quiet, answered, a run, terminal-only, failed.
if (phase === 'commands') {
  const c = (text: string, end: any, ...between: PortalEvent[]) => { const start = ev('portal_command', { text }, 10); return [start, ...between, ev('portal_command_end', { of: start.seq, ...end }, 9)]; };
  events.push(
    ...c('/bg-clear', { outcome: 'handled', quiet: true }),
    ...c('/bg-update', { outcome: 'handled' }, ev('portal_notice', { text: 'pi-background-tasks 2.6.2 is installed; 2.6.5 is the latest published version.\nUpdate from npm:\n  pi install npm:pi-background-tasks@latest', from: 'extension' }, 9)),
    ...c('/bg-tasks', { outcome: 'handled' }, ev('portal_notice', { text: "/bg-tasks opens a view made for pi's terminal, which the browser cannot show.", warning: true, from: 'extension' }, 9)),
    ...c('/broken', { error: 'boom: the thing it needed was not there' }),
    ev('portal_command', { text: '/compact' }, 1),
  );
}
if (phase === 'compacting') events.push(ev('compaction_start', {}, 6));
// The portal restarted mid-command: nothing says the call ended, only that the chat was interrupted.
if (phase === 'interrupted') events.push(ev('turn_start', {}, 20), ...bash('b3', 'npm run test:e2e', 'Running 42 tests using 4 workers\n  ✓ login (1.2s)\n', undefined, 12));
if (phase === 'agents') {
  events.push(
    ev('tool_execution_start', { toolCallId: 'dr', toolName: 'deep_research', args: { query: 'Which vector DB fits a homelab?' } }, 50),
    ev('tool_execution_update', { toolCallId: 'dr', partialResult: { content: [{ type: 'text', text: '## Findings so far\n- **pgvector** is enough below 10M vectors' }], details: { phase: 'researching (4 searches)', items: [{ type: 'toolCall', name: 'web_search', args: { query: 'pgvector vs qdrant 2026' } }, { type: 'text', text: 'Comparing memory use.' }, { type: 'toolCall', name: 'fetch', args: { url: 'https://qdrant.tech/benchmarks' } }] } } }, 5),
    ev('tool_execution_start', { toolCallId: 'sa', toolName: 'subagent', args: { task: 'Audit the deploy script', label: 'Deploy audit' } }, 40),
    ev('portal_subagent', { op: 'start', id: 'sub1', label: 'Deploy audit', toolCallId: 'sa', input: true, stop: true }, 40),
    ev('portal_subagent', { op: 'event', id: 'sub1', event: { type: 'message_end', message: { role: 'user', content: 'Audit the deploy script for anything that could lose data.' } } }, 39),
    ev('portal_subagent', { op: 'event', id: 'sub1', event: { type: 'tool_execution_start', toolCallId: 'x1', toolName: 'read', args: { path: 'deploy/setup.sh' } } }, 38),
    ev('portal_subagent', { op: 'event', id: 'sub1', event: { type: 'tool_execution_end', toolCallId: 'x1', toolName: 'read', result: { content: [{ type: 'text', text: '#!/bin/sh…' }] } } }, 37),
    ev('portal_subagent', { op: 'event', id: 'sub1', event: { type: 'message_end', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'rm -rf on the old dir runs before the copy is verified.' }, { type: 'text', text: 'The script deletes `/opt/pithagoras.old` **before** checking that the new build started. I will look at the restart step next.' }] } } }, 20),
    ev('portal_subagent_live', { op: 'event', id: 'sub1', event: { type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'Now the systemd restart: does it wait for health?' } } }, 2),
  );
  const jobs = { supported: true, statuses: [{ key: 'background-tasks', text: 'bg 1 running' }, { key: 'bg-update', text: 'bg ⬆ v2.6.5 /bg-update' }, { key: 'paths', text: 'logs in /tmp/bg' }], widgets: [], jobs: [
    { key: 'j1', sid: 4242, pids: [4242, 4250], command: 'npm run dev -- --port 5173', startedAt: now - 754_000, state: 'running', hasOutput: true, attached: false },
    { key: 'j2', sid: 4300, pids: [], command: 'python -m http.server 8000', startedAt: now - 3_600_000, exitedAt: now - 1_200_000, state: 'exited', hasOutput: true, attached: false },
  ] };
  const realFetch = window.fetch;
  window.fetch = (async (url: any, init?: any) => {
    const u = String(url);
    const reply = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    if (u.endsWith('/background')) return reply(jobs);
    if (u.endsWith('/commands')) return reply({ commands: [{ name: 'bg-update', description: 'Update pi-background', source: 'extension' }] });
    if (u.includes('/background/') && u.includes('/output')) return reply({ text: u.includes('from=') ? '' : '> vite\n\n  VITE v5.4  ready in 312 ms\n\n  ➜  Local:   http://localhost:5173/\n  ➜  Network: use --host to expose\n', from: 0, size: 120 });
    return realFetch(url, init);
  }) as typeof fetch;
}

// An extension fills the chat box twice in one millisecond, the way pi's RPC mode names it and then as a paste.
if (phase === 'editor') {
  const at = -now;
  events.push(
    { seq: at, type: 'extension_ui_request', at: now, payload: { method: 'set_editor_text', text: '/deploy ' } },
    { seq: at, type: 'extension_ui_request', at: now, payload: { method: 'setEditorText', text: '--prod', paste: true } },
  );
}
// Two chats: the first has a status that names a command, the second nothing. Which chats are asked for their commands is kept.
if (phase === 'switch') {
  const realFetch = window.fetch;
  (window as any).commandsAsked = [];
  window.fetch = (async (url: any, init?: any) => {
    const u = String(url);
    const reply = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    if (u.endsWith('/background')) return reply({ supported: true, jobs: [], widgets: [], statuses: u.includes('/sessions/first/') ? [{ key: 'bg', text: 'bg ⬆ v2.6.5 /bg-update' }] : [] });
    if (u.endsWith('/commands')) {
      (window as any).commandsAsked.push(u.split('/')[3]);
      return reply({ commands: [{ name: 'bg-update', description: 'Update', source: 'extension' }] });
    }
    return realFetch(url, init);
  }) as typeof fetch;
}

const session: Session = { id: 'preview', title: 'Fix the build', workspace: '/workspaces/pithagoras', executor: 'host', status: phase === 'interrupted' ? 'interrupted' : 'running', created_at: '', updated_at: '', last_error: null, pinned: false, provider: 'llama-server', model: 'Qwen3.6 35B', thinking_level: 'medium' } as Session;
const noop = async () => {};
function Fixture() {
  const [v, setV] = React.useState('b');
  const [which, setWhich] = React.useState(phase === 'switch' ? 'first' : session.id);
  const shown = which === session.id ? session : { ...session, id: which, title: which === 'first' ? 'First chat' : 'Second chat', status: 'idle' as const };
  return <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <div style={{ padding: 8, display: 'flex', gap: 8 }}><Select aria-label="Preview select" size="sm" className="w-64" value={v} onChange={setV} options={[{ value: 'a', label: 'Project notes' }, { value: 'b', label: 'Release plan', hint: 'Temporary — not stored' }, { value: 'c', label: 'Meeting summary' }]} /><label className="flex items-center gap-2 text-xs"><input type="checkbox" defaultChecked />Checkbox</label><input type="range" defaultValue={40} />{phase === 'switch' && <button onClick={() => setWhich('second')}>Open the second chat</button>}</div>
    <div style={{ flex: 1, minHeight: 0 }}><Chat session={shown} events={events} onSend={async (message) => { (window as any).sent = [...((window as any).sent ?? []), message]; }} onEditMessage={noop} onDeleteMessage={noop} onAbort={noop} onClientCommand={noop} onRename={noop} loading={new URLSearchParams(location.search).has('loading')} /></div>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
