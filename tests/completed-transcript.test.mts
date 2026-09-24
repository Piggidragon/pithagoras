import test from 'node:test';
import assert from 'node:assert/strict';
import { activity, buildTranscript, lastReplyId } from '../web/src/transcript.ts';
import { appendLiveEvent, resetLiveEvents } from '../web/src/live-events.ts';
const done = { seq: 12, type: 'message_end', payload: { streamId: 'reply', message: { role: 'assistant', content: [{type: 'thinking', thinking: 'Plan'}, {type: 'text', text: 'Hello world'}] } } };
const update = {seq: -1, type: 'message_update', payload: {streamId: 'reply', assistantMessageEvent: {type: 'text_delta', delta: 'Hello'}}};
test('completed messages replay without saved deltas', () => {
 assert.deepEqual(buildTranscript([done]), [{kind:'assistant', id:'areply', text:'Hello world', thinking:'Plan', done:true, audio:false}]);
});
test('final message replaces live deltas with a stable id and no duplicate speech', () => {
 const before=buildTranscript([update]);
 const events=appendLiveEvent([update],done);
 assert.equal(events.length,1);
 const after=buildTranscript(events);
 assert.equal(before[0].id,after[0].id);
 assert.equal(after.length,1);
 assert.equal((after[0] as any).text,'Hello world');
});
test('old stored deltas plus completed snapshots are not duplicated', () => {
 assert.equal((buildTranscript([{...update,seq:1},done])[0] as any).text,'Hello world');
});
test('reconnect clears stale live updates and restores one current snapshot', () => {
 const snapshot={seq:-3,type:'message_snapshot',payload:done.payload};
 const events=appendLiveEvent(resetLiveEvents([update]),snapshot);
 assert.equal((buildTranscript(events)[0] as any).text,'Hello world');
 assert.equal((buildTranscript(events)[0] as any).done,false);
});
test('tool updates replace prior snapshots and disappear on completion', () => {
 const a={seq:-1,type:'tool_execution_update',payload:{toolCallId:'t',partialResult:{content:[]}}};
 const b={...a,seq:-2};
 const events=appendLiveEvent([a],b); assert.equal(events.length,1);
 const final={seq:3,type:'tool_execution_end',payload:{toolCallId:'t'}};
 assert.deepEqual(appendLiveEvent(events,final),[final]);
});

test('restored live snapshots show writing activity instead of prefill', () => {
 assert.equal(activity([{seq:-4,type:'message_snapshot',payload:done.payload}]).label,'writing the reply');
});

test('Copy belongs only on the last stretch of an answer split by a tool call', () => {
  const events = [
    { seq: 1, type: 'message_end', payload: { streamId: 'a', message: { role: 'assistant', content: [{ type: 'text', text: 'Checking the file first.' }] } } },
    { seq: 2, type: 'tool_execution_start', payload: { toolCallId: 't', toolName: 'read' } },
    { seq: 3, type: 'tool_execution_end', payload: { toolCallId: 't', toolName: 'read' } },
    { seq: 4, type: 'message_end', payload: { streamId: 'b', message: { role: 'assistant', content: [{ type: 'text', text: 'It looks fine.' }] } } },
  ];
  const items = buildTranscript(events);
  const replies = items.filter((i) => i.kind === 'assistant');
  assert.equal(replies.length, 2);
  assert.equal(lastReplyId(items), replies[1].id);
});

test('a reply still streaming after the last tool call is not offered yet', () => {
  const events = [
    { seq: 1, type: 'message_end', payload: { streamId: 'a', message: { role: 'assistant', content: [{ type: 'text', text: 'One.' }] } } },
    { seq: 2, type: 'tool_execution_start', payload: { toolCallId: 't', toolName: 'read' } },
    { seq: 3, type: 'tool_execution_end', payload: { toolCallId: 't', toolName: 'read' } },
    { seq: 4, type: 'message_update', payload: { streamId: 'b', assistantMessageEvent: { type: 'text_delta', delta: 'Still going' } } },
  ];
  assert.equal(lastReplyId(buildTranscript(events)), undefined);
});

test('a paragraph followed by a tool call is not offered Copy', () => {
  const events = [
    { seq: 1, type: 'message_end', payload: { streamId: 'a', message: { role: 'assistant', content: [{ type: 'text', text: 'Running the tests now.' }] } } },
    { seq: 2, type: 'tool_execution_start', payload: { toolCallId: 't', toolName: 'bash' } },
  ];
  assert.equal(lastReplyId(buildTranscript(events)), undefined);
});

test('nothing to copy before anything has been said', () => {
  assert.equal(lastReplyId([]), undefined);
});
test('tool calls keep their arguments, output and timing; compaction shows where it happened', () => {
  const items = buildTranscript([
    { seq: 1, at: 1000, type: 'tool_execution_start', payload: { toolCallId: 't', toolName: 'bash', args: { command: 'ls -la' } } },
    { seq: 2, at: 1200, type: 'tool_execution_update', payload: { toolCallId: 't', partialResult: { content: [{ type: 'text', text: 'a' }] } } },
    { seq: 3, at: 1500, type: 'tool_execution_end', payload: { toolCallId: 't', toolName: 'bash', result: { content: [{ type: 'text', text: 'a\nb' }] } } },
    { seq: 4, at: 2000, type: 'compaction_start', payload: {} },
    { seq: 5, at: 3000, type: 'compaction_end', payload: { result: { summary: 'S', tokensBefore: 90000 } } },
  ] as any);
  const tool = items[0] as any;
  assert.deepEqual([tool.args, tool.output, tool.status, tool.until - tool.since], [{ command: 'ls -la' }, 'a\nb', 'done', 500]);
  assert.deepEqual(items[1], { kind: 'compaction', id: 'c4', status: 'done', since: 2000, until: 3000, tokensBefore: 90000, summary: 'S' });
});
test('a finished reply keeps how long it thought, though the deltas that timed it are gone', async () => {
 const { LiveEvents } = await import('../server/src/live-events.ts');
 let stored: any;
 const live = new LiveEvents((session, type, payload) => (stored = { seq: 1, session_id: session, type, payload: JSON.stringify(payload), created_at: '' }));
 const t0 = Date.now();
 live.record('s', 'message_update', { assistantMessageEvent: { type: 'thinking_delta', delta: 'Hm' } });
 live.record('s', 'message_end', { message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'Hm' }] } });
 const payload = JSON.parse(stored.payload);
 assert.ok(payload.thinkingSince >= t0 && payload.thinkingUntil >= payload.thinkingSince);
 // As a reload has it: the stored end alone, stamped well after the thinking.
 const [item] = buildTranscript([{ seq: 1, at: 99_000, type: 'message_end', payload: { ...payload, thinkingSince: 1_000, thinkingUntil: 13_000 } }]) as any[];
 assert.equal(item.thinkingSince, 1_000);
 assert.equal(item.thinkingUntil, 13_000);
});
