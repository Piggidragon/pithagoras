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

const prompt = (seq: number, message: string, extra = {}) => ({ seq, type: 'portal_prompt', payload: { message, ...extra } });
const said = (seq: number, text: string) => ({ seq, type: 'message_end', payload: { streamId: `r${seq}`, message: { role: 'assistant', content: [{ type: 'text', text }] } } });
const tool = (seq: number, id: string) => [
  { seq, type: 'tool_execution_start', payload: { toolCallId: id, toolName: 'read' } },
  { seq: seq + 1, type: 'tool_execution_end', payload: { toolCallId: id, toolName: 'read' } },
];
// What Chat offers Copy on: the last answer of each run, and the one still the last thing said.
const copyable = (events: any[]) => {
  const items = buildTranscript(events);
  const last = lastReplyId(items);
  return items.filter((i) => i.kind === 'assistant' && (i.final || i.id === last)).map((i) => (i as any).text);
};

test('the answer to an earlier question keeps Copy once another is asked', () => {
  assert.deepEqual(copyable([prompt(1, 'One?'), said(2, 'First answer.'), prompt(3, 'Two?'), said(4, 'Second answer.')]), ['First answer.', 'Second answer.']);
});

test('each turn offers Copy on its last stretch only, and on none that ended in a tool call', () => {
  assert.deepEqual(copyable([
    prompt(1, 'One?'),
    said(2, 'Checking the file first.'),
    ...tool(3, 't'),
    said(5, 'It looks fine.'),
    prompt(6, 'Two?'),
    said(7, 'Running the tests now.'),
    ...tool(8, 'u'),
    prompt(10, 'Three?'),
    said(11, 'Third answer.'),
  ]), ['It looks fine.', 'Third answer.']);
});

test('a command that starts a run ends the turn before it, though no message was sent', () => {
  assert.deepEqual(copyable([
    prompt(1, 'One?'),
    said(2, 'First answer.'),
    { seq: 3, type: 'agent_end', payload: {} },
    { seq: 4, type: 'portal_command', payload: { text: '/review' } },
    { seq: 5, type: 'portal_command_end', payload: { of: 4, outcome: 'started' } },
    { seq: 6, type: 'agent_start', payload: {} },
    said(7, 'Review answer.'),
  ]), ['First answer.', 'Review answer.']);
});

test('a run an extension starts, with a notice in between, ends the turn before it too', () => {
  assert.deepEqual(copyable([
    prompt(1, 'One?'),
    said(2, 'Started it, will report back.'),
    { seq: 3, type: 'agent_end', payload: {} },
    { seq: 4, type: 'message_end', payload: { message: { role: 'custom', display: true, content: 'Subagent done: X' } } },
    { seq: 5, type: 'agent_start', payload: {} },
    said(6, 'The subagent found X.'),
  ]), ['Started it, will report back.', 'The subagent found X.']);
});

test('what only prints something, and a message that has not gone in or never did, leave the answer the last thing said', () => {
  const answered = [prompt(1, 'One?'), said(2, 'First answer.')];
  for (const after of [
    [{ seq: 3, type: 'portal_notice', payload: { text: 'Session: x' } }],
    [prompt(3, 'And then?', { queued: true })],
    [prompt(3, 'Forgotten?', { queued: true }), { seq: 4, type: 'portal_unsent', payload: { seqs: [3], prompts: { 3: { message: 'Forgotten?', queued: true } } } }],
  ]) {
    const events = [...answered, ...after];
    assert.equal(buildTranscript(events).some((i) => i.kind === 'assistant' && i.final), false);
    assert.deepEqual(copyable(events), ['First answer.']);
  }
});

test('reasoning for the next stretch takes Copy off the one before it until it is said', () => {
  const events = [
    prompt(1, 'One?'),
    said(2, 'Let me look.'),
    { seq: 3, type: 'message_update', payload: { streamId: 'b', assistantMessageEvent: { type: 'thinking_delta', delta: 'Hmm' } } },
  ];
  assert.equal(lastReplyId(buildTranscript(events)), undefined);
});

test('a reply that goes on after a new run began is not a finished answer any more', () => {
  const items = buildTranscript([
    prompt(1, 'One?'),
    said(2, 'Part one.'),
    { seq: 3, type: 'agent_start', payload: {} },
    { seq: 4, type: 'message_update', payload: { streamId: 'r2', assistantMessageEvent: { type: 'text_delta', delta: ' and more' } } },
  ]);
  assert.equal(items.filter((i) => i.kind === 'assistant' && i.final).length, 0);
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

test('a long tool output keeps its end and counts the lines of all of it', () => {
 const text=Array.from({length:50_000},(_,i)=>`line ${i}`).join('\n')+'\n';
 const items=buildTranscript([
  {seq:1,type:'tool_execution_start',payload:{toolCallId:'t',toolName:'bash',args:{command:'yes'}}},
  {seq:2,type:'tool_execution_end',payload:{toolCallId:'t',toolName:'bash',result:{content:[{type:'text',text}]}}},
 ] as any);
 const tool=items.find((i:any)=>i.kind==='tool') as any;
 assert.ok(tool.output.length<text.length);
 assert.equal(tool.outputLines,50_000);
});
