import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latestBrowserActivity, latestTerminalActivity } from '../web/src/voice-browser.js';
import { terminalRuns } from '../web/src/components/VoiceTerminal.js';

test('only browser tool calls activate the browser; plain mentions and old text do not', () => {
  const events = [
    { seq: 1, type: 'message_update', payload: { text: 'browser' } },
    { seq: 2, type: 'tool_execution_start', payload: { toolName: 'bash', input: { command: 'echo browser' } } },
    { seq: 3, type: 'tool_execution_start', payload: { toolName: 'mcp', input: { tool: 'browser_navigate' } } },
  ];
  assert.equal(latestBrowserActivity(events.slice(0, 2)), 0);
  assert.equal(latestBrowserActivity(events), 3);
  assert.equal(latestTerminalActivity(events), 2);
});
test('terminal follows cumulative streamed output and final tool errors by call id', () => {
  const events = [
    { seq: 1, type: 'tool_execution_start', payload: { toolName: 'bash', toolCallId: 'a', input: { command: 'npm test' } } },
    { seq: 2, type: 'tool_execution_update', payload: { toolCallId: 'a', partialResult: { content: [{ type: 'text', text: 'Starting' }] } } },
    { seq: 3, type: 'tool_execution_end', payload: { toolCallId: 'a', isError: true, result: { content: [{ type: 'text', text: 'Starting\nFailed' }] } } },
  ];
  assert.deepEqual(terminalRuns(events), [{ id: 'a', command: 'npm test', output: 'Starting\nFailed', running: false, error: true }]);
});

test('files and pictures take the side first, and the middle when the side is taken', async () => {
  const { placeWindows } = await import('../web/src/voice-windows.js');
  const none = { browser: false, terminal: false, files: false, pictures: false };
  assert.deepEqual(placeWindows({ ...none, pictures: true }), { main: undefined, side: 'pictures' });
  assert.deepEqual(placeWindows({ ...none, files: true, terminal: true }), { main: 'files', side: 'terminal' });
  assert.deepEqual(placeWindows({ ...none, pictures: true, browser: true }), { main: 'browser', side: 'pictures' });
  assert.deepEqual(placeWindows({ ...none, pictures: true, files: true }), { main: 'pictures', side: 'files' });
  assert.deepEqual(placeWindows({ ...none, browser: true, terminal: true }), { main: 'browser', side: 'terminal' });
  // The conversation is a window like them, not something drawn over them.
  assert.deepEqual(placeWindows({ ...none, conversation: true }), { main: undefined, side: 'conversation' });
  assert.deepEqual(placeWindows({ ...none, conversation: true, terminal: true }), { main: 'conversation', side: 'terminal' });
  assert.deepEqual(placeWindows({ ...none, conversation: true, pictures: true }), { main: 'pictures', side: 'conversation' });
});
