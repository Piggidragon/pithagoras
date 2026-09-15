import {test} from 'node:test';
import assert from 'node:assert/strict';
import {activity} from '../web/src/transcript.ts';
const event=(type:string,at:number,payload:any={})=>({type,at,payload,seq:at});
test('empty assistant events retain prefill percentage and stable elapsed start',()=>{
 const events=[event('portal_prompt',100),event('message_start',110,{message:{role:'assistant'}}),event('portal_prefill',120,{total:10000,processed:3000,cache:1000}),event('message_update',130,{assistantMessageEvent:{type:'start'}})];
 assert.deepEqual(activity(events),{label:'processing the prompt',since:110,prefill:{total:10000,processed:3000,cache:1000}});
 events.push(event('message_update',140,{assistantMessageEvent:{type:'thinking_delta',delta:'Considering'}}));
 assert.equal(activity(events).label,'thinking');
});
test('compaction stays identified through model events and ends cleanly',()=>{
 const events=[event('compaction_start',100),event('message_start',110,{message:{role:'assistant'}}),event('portal_prefill',120,{total:1000,processed:500}),event('message_update',130,{assistantMessageEvent:{type:'text_delta',delta:'Summary'}})];
 assert.deepEqual(activity(events),{label:'compacting the conversation',since:100});
 events.push(event('compaction_end',140));assert.equal(activity(events).label,'thinking');
 events.push(event('portal_prompt',150));assert.deepEqual(activity(events),{label:'processing the prompt',since:150,prefill:undefined});
});
