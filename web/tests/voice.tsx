// Development-only fixture using the actual chat and extension dialog.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Chat } from '../src/components/Chat';
import { ExtensionDialog } from '../src/components/ExtensionDialog';
import type { PortalEvent, Session } from '../src/api';
import '../src/index.css';
const microphone = new AudioContext();
let destination = microphone.createMediaStreamDestination();
Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
  if (destination.stream.getTracks().every(t => t.readyState === 'ended')) destination = microphone.createMediaStreamDestination();
  return destination.stream;
} });
function Fixture() {
  const [events, setEvents] = useState<PortalEvent[]>([
    { seq: 1, type: 'portal_prompt', payload: { message: 'Help me plan the next step.' } },
    { seq: 2, type: 'message_update', payload: { assistantMessageEvent: { type: 'text_delta', delta: 'We can work through it together.' } } },
    { seq: 3, type: 'message_end', payload: {} },
  ]);
  const [running, setRunning] = useState(false);
  const [sent, setSent] = useState(0);
  const [voiceSend, setVoiceSend] = useState(false);
  const [aborted, setAborted] = useState(0);
  const [options, setOptions] = useState(false);
  const [selected, setSelected] = useState(0);
  const session: Session = { id: 'test', title: 'A little room to think', workspace: '/workspaces/pithagoras', executor: 'host', status: running ? 'running' : 'idle', created_at: '', updated_at: '', last_error: null, pinned: false, provider: 'llama-server', model: 'Qwen3.6 35B', thinking_level: 'medium' };
  return <>
    <main data-testid="workspace" style={{ maxWidth: 980, height: 'calc(100vh - 96px)', minHeight: 540, margin: '16px auto 0' }}>
      <Chat session={session} events={events} onClientCommand={() => {}} onAbort={async () => { setAborted(n => n + 1); setRunning(false); }} onSend={async (message, options) => {
        setVoiceSend(options?.voice === true);
        setSent(n => n + 1); setRunning(true);
        setEvents(previous => [...previous,
          { seq: previous.length + 1, type: 'portal_prompt', payload: { message } },
          { seq: previous.length + 2, type: 'message_update', payload: { assistantMessageEvent: { type: 'text_delta', delta: 'Here is the spoken response.' } } },
          { seq: previous.length + 3, type: 'message_end', payload: {} },
        ]);
      }} />
    </main>
    {options && <ExtensionDialog sessionId="test" request={{ id: 'choice', method: 'select', title: 'Choose the next step', options: ['Review changes', 'Run tests'] }} onDone={() => { setSelected(n => n + 1); setOptions(false); }} />}
    <aside style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 10, padding: 8 }}>
      <button onClick={async () => {
        await microphone.resume();
        const source = microphone.createBufferSource();
        source.buffer = await microphone.decodeAudioData(await (await fetch('/test-speech.wav')).arrayBuffer());
        source.connect(destination); source.start(0, 0, 2.5);
      }}>Inject speech</button>
      <button onClick={() => { setRunning(true); setEvents(previous => [...previous, { seq: previous.length + 1, type: 'message_update', payload: { assistantMessageEvent: { type: 'text_delta', delta: 'Here is the first sentence. More' } } }]); }}>Stream reply</button>
      <button onClick={() => { setRunning(false); setEvents(previous => [...previous, { seq: previous.length + 1, type: 'message_update', payload: { assistantMessageEvent: { type: 'text_delta', delta: ' text follows.' } } }, { seq: previous.length + 2, type: 'message_end', payload: {} }]); }}>Finish reply</button>
      <button onClick={() => setEvents(previous => [...previous, { seq: previous.length + 1, type: 'tool_execution_start', payload: { toolName: 'mcp', toolCallId: 'browser-demo', input: { tool: 'browser_navigate', args: { url: 'https://example.com' } } } }])}>Use browser</button>
      <button onClick={() => setEvents(previous => [...previous, { seq: previous.length + 1, type: 'tool_execution_start', payload: { toolName: 'bash', toolCallId: 'terminal-demo', input: { command: 'npm run build' } } }, { seq: previous.length + 2, type: 'tool_execution_update', payload: { toolCallId: 'terminal-demo', partialResult: { content: [{ type: 'text', text: 'Building application…\n✓ 42 modules transformed.' }] } } }])}>Use terminal</button>
      <button onClick={() => setEvents(previous => [...previous, { seq: previous.length + 1, type: 'tool_execution_end', payload: { toolName: 'bash', toolCallId: 'terminal-demo', result: { content: [{ type: 'text', text: 'Building application…\n✓ 42 modules transformed.\nBuild completed successfully.' }] } } }])}>Finish terminal</button>
      <button onClick={() => { setRunning(true); const at=Date.now(); setEvents(previous=>[...previous,{seq:previous.length+1,type:'portal_prompt',at,payload:{message:'Process a long conversation'}},{seq:previous.length+2,type:'message_start',at,payload:{message:{role:'assistant'}}},{seq:previous.length+3,type:'portal_prefill',at:Date.now(),payload:{total:40000,processed:16000,cache:8000}}]); }}>Show prefill</button>
      <button onClick={() => { setRunning(true); setEvents(previous=>[...previous,{seq:previous.length+1,type:'compaction_start',at:Date.now()-15000,payload:{}}]); }}>Start compaction</button>
      <button onClick={() => { setRunning(false); setEvents(previous=>[...previous,{seq:previous.length+1,type:'compaction_end',at:Date.now(),payload:{}}]); }}>End compaction</button>
      <button onClick={() => setOptions(true)}>Show options</button>
      <button onClick={() => setEvents(previous => [...previous, { seq: previous.length + 1, type: 'message_update', payload: { assistantMessageEvent: { type: 'thinking_delta', delta: 'Checking the latest build results and comparing the browser state. The next step is to verify the page layout.' } } }])}>Stream thinking</button>
      <span data-testid="voice-send">{String(voiceSend)}</span><span data-testid="sent">{sent}</span><span data-testid="aborted">{aborted}</span><span data-testid="selected">{selected}</span>
      <button onClick={() => { document.querySelector('[data-testid=tracks]')!.textContent = destination.stream.getTracks().map(t => `${t.readyState}:${t.enabled}`).join(','); }}>Check mic tracks</button>
      <span data-testid="tracks" />
    </aside>
  </>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
