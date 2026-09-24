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
if (phase === 'compacting') events.push(ev('compaction_start', {}, 6));
// The portal restarted mid-command: nothing says the call ended, only that the chat was interrupted.
if (phase === 'interrupted') events.push(ev('turn_start', {}, 20), ...bash('b3', 'npm run test:e2e', 'Running 42 tests using 4 workers\n  ✓ login (1.2s)\n', undefined, 12));

const session: Session = { id: 'preview', title: 'Fix the build', workspace: '/workspaces/pithagoras', executor: 'host', status: phase === 'interrupted' ? 'interrupted' : 'running', created_at: '', updated_at: '', last_error: null, pinned: false, provider: 'llama-server', model: 'Qwen3.6 35B', thinking_level: 'medium' } as Session;
const noop = async () => {};
function Fixture() {
  const [v, setV] = React.useState('b');
  return <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <div style={{ padding: 8, display: 'flex', gap: 8 }}><Select aria-label="Preview select" size="sm" className="w-64" value={v} onChange={setV} options={[{ value: 'a', label: 'Project notes' }, { value: 'b', label: 'Release plan', hint: 'Temporary — not stored' }, { value: 'c', label: 'Meeting summary' }]} /><label className="flex items-center gap-2 text-xs"><input type="checkbox" defaultChecked />Checkbox</label><input type="range" defaultValue={40} /></div>
    <div style={{ flex: 1, minHeight: 0 }}><Chat session={session} events={events} onSend={noop} onEditMessage={noop} onDeleteMessage={noop} onAbort={noop} onClientCommand={noop} onRename={noop} loading={new URLSearchParams(location.search).has('loading')} /></div>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
