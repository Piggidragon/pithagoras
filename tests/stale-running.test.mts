import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTranscript } from '../web/src/transcript.ts';
import { shellOutcome } from '../web/src/components/ChatActivity.tsx';

const ev = (seq: number, type: string, payload: any = {}) => ({ seq, at: seq * 1000, type, payload });
const start = (seq: number, id: string, toolName = 'bash') => ev(seq, 'tool_execution_start', { toolCallId: id, toolName, args: { command: 'sleep 99' } });

test('a tool still open when the run ends is shown as interrupted, not running', () => {
  const items = buildTranscript([start(1, 't1'), ev(2, 'agent_end')] as any);
  assert.equal((items[0] as any).status, 'error');
  assert.equal((items[0] as any).interrupted, true);
});

test('a status that is not running settles open tools and compactions', () => {
  const items = buildTranscript([start(1, 't1'), ev(2, 'compaction_start'), ev(3, 'portal_status', { status: 'error', error: 'pi exited' })] as any);
  assert.equal((items[0] as any).interrupted, true);
  assert.equal((items[1] as any).status, 'failed');
});

test('a running status settles nothing', () => {
  const items = buildTranscript([ev(1, 'portal_status', { status: 'running' }), start(2, 't1')] as any);
  assert.equal((items[0] as any).status, 'running');
});

test('a tool that ended keeps how it ended', () => {
  const items = buildTranscript([
    start(1, 't1'),
    ev(2, 'tool_execution_end', { toolCallId: 't1', toolName: 'bash', result: { content: [{ type: 'text', text: 'ok' }] } }),
    ev(3, 'agent_end'),
  ] as any);
  assert.equal((items[0] as any).status, 'done');
  assert.equal((items[0] as any).interrupted, undefined);
});

test('a restart records nothing, so the caller says the run is over', () => {
  const events = [start(1, 't1')] as any;
  assert.equal((buildTranscript(events)[0] as any).status, 'running');
  assert.equal((buildTranscript(events, { ended: true })[0] as any).interrupted, true);
});

test('an interrupted shell command says so rather than "failed"', () => {
  assert.deepEqual(shellOutcome('error', '', true), { label: 'interrupted', tone: 'warn' });
  assert.deepEqual(shellOutcome('error', ''), { label: 'failed', tone: 'error' });
});

test('a tool is pictured from the words in its name, whichever extension it comes from', async () => {
  const { toolIconKind } = await import('../web/src/components/ChatActivity.tsx');
  const kinds = Object.fromEntries(['Bash', 'brave_web_search', 'webFetch', 'tavily_search', 'github.list_issues', 'read', 'apply_patch', 'get_details', 'call_tools', 'mystery'].map((n) => [n, toolIconKind(n)]));
  assert.deepEqual(kinds, {
    Bash: 'shell', brave_web_search: 'web', webFetch: 'web', tavily_search: 'search', 'github.list_issues': 'find',
    read: 'read', apply_patch: 'edit', get_details: 'tool', call_tools: 'tool', mystery: 'tool',
  });
});

test('a call through the MCP adapter is named by the tool it asked for', async () => {
  const { toolName } = await import('../web/src/tool-activity.ts');
  assert.equal(toolName('mcp', { tool: 'web_search_exa', args: { query: 'x' } }), 'web_search_exa');
  assert.equal(toolName('mcp', { server: 'exa' }), 'mcp');
  assert.equal(toolName('web_search', { query: 'x' }), 'web_search');
});

test('an extension setting is named as a person would, and kept as the kind of value it was', async () => {
  const { humanKey, typed } = await import('../web/src/setting-values.ts');
  assert.equal(humanKey('llamaServerUrl'), 'Llama server URL');
  assert.equal(humanKey('mcp_timeout_ms'), 'MCP timeout ms');
  assert.equal(humanKey('HTTPProxy'), 'HTTP proxy');
  assert.equal(typed(5, ' 12 '), 12);
  assert.equal(typed(true, 'false'), false);
  assert.deepEqual(typed({ a: 1 }, '{"a":2}'), { a: 2 });
  assert.equal(typed('x', ''), '');
  assert.equal(typed(undefined, '42'), '42', 'a key never set stays text: nothing says it is a number');
});
