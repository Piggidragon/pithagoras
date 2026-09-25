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

test('a shell tool called through MCP is a run, and one its run left open is settled, not spinning', () => {
  const events = [
    { seq: 1, type: 'tool_execution_start', payload: { toolName: 'mcp', toolCallId: 'm', input: { tool: 'shell', args: { command: 'ls' } } } },
    { seq: 2, type: 'tool_execution_start', payload: { toolName: 'bash', toolCallId: 'b', input: { command: 'sleep 99' } } },
    { seq: 3, type: 'tool_execution_end', payload: { toolName: 'mcp', toolCallId: 'm', result: { content: [{ type: 'text', text: 'a\nb' }] } } },
    { seq: 4, type: 'agent_end', payload: {} },
  ];
  assert.deepEqual(terminalRuns(events), [
    { id: 'm', command: 'ls', output: 'a\nb', running: false, error: false },
    { id: 'b', command: 'sleep 99', output: '', running: false, error: false, interrupted: true },
  ]);
  assert.equal(terminalRuns(events.slice(0, 2), 6, 20000, true)[1].interrupted, true, 'ended with no event to say so');
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

test('the orb stands in the widest gap the windows leave, when it fits', async () => {
  const { freeStrip } = await import('../web/src/voice-windows.ts');
  const stage = { left: 100, right: 1100 };
  // Two windows with 400px between them: the orb goes in the middle of it.
  assert.deepEqual(freeStrip(stage, [{ left: 100, right: 400 }, { left: 800, right: 1100 }]), { center: 600, width: 400 });
  // One window at the right: the gap is everything to its left.
  assert.deepEqual(freeStrip(stage, [{ left: 600, right: 1100 }]), { center: 350, width: 500 });
  // Too narrow anywhere: back to the dock.
  assert.equal(freeStrip(stage, [{ left: 100, right: 600 }, { left: 700, right: 1100 }]), null);
  // Windows that overlap, or reach past the stage, are taken as they cover it.
  assert.deepEqual(freeStrip(stage, [{ left: 0, right: 300 }, { left: 250, right: 450 }, { left: 900, right: 1300 }]), { center: 675, width: 450 });
});

test('a window the orb comes back to its dock under is made to end above the dock', async () => {
  const { clearOfDock } = await import('../web/src/voice-windows.ts');
  const stage = { left: 0, right: 1000, bottom: 800 };
  // The dock: 520px wide in the middle, its top 90px above the stage's bottom.
  assert.equal(clearOfDock(stage, { left: 400, right: 980, top: 50, bottom: 790 }), 800 - 90 - 16 - 50);
  assert.equal(clearOfDock(stage, { left: 400, right: 980, top: 50, bottom: 690 }), null, 'ends above it already');
  assert.equal(clearOfDock(stage, { left: 780, right: 980, top: 50, bottom: 790 }), null, 'beside the dock, not over it');
  // On a narrow stage the dock is the stage less 16px either side.
  assert.equal(clearOfDock({ left: 0, right: 400, bottom: 800 }, { left: 10, right: 30, top: 50, bottom: 790 }), 644);
});

test('a window dragged by a corner stops at a window off that corner, by the edge that gives up less', async () => {
  const { clear } = await import('../web/src/components/ResizeHandles.tsx');
  const a = { left: 0, top: 0, right: 300, bottom: 300 };
  const b = { left: 400, top: 420, right: 700, bottom: 700 };
  const overlaps = (x: typeof a, y: typeof a) => x.left < y.right && x.right > y.left && x.top < y.bottom && x.bottom > y.top;
  // Down and to the right, over B: the bottom has less to give up, and stops 16px above it.
  const got = clear(a, { ...a, right: 600, bottom: 600 }, 'se', [b]);
  assert.deepEqual(got, { ...a, right: 600, bottom: 404 });
  assert.ok(!overlaps(got, b));
  // Further right than down: the right edge stops instead.
  assert.deepEqual(clear(a, { ...a, right: 450, bottom: 650 }, 'se', [b]), { ...a, right: 384, bottom: 650 });
  // Beside or below alone, as before; and one it does not reach is no matter.
  assert.equal(clear(a, { ...a, right: 900 }, 'e', [{ left: 500, top: 100, right: 700, bottom: 200 }]).right, 484);
  assert.equal(clear(a, { ...a, bottom: 900 }, 's', [{ left: 100, top: 500, right: 200, bottom: 600 }]).bottom, 484);
  assert.deepEqual(clear(a, { ...a, right: 350 }, 'se', [b]), { ...a, right: 350 });
});
