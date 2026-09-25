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
test('a model being loaded is said before the prompt is read, and gives way to prefill',()=>{
 const events:any[]=[event('portal_prompt',100),event('agent_start',105),event('portal_model',110,{model:'qwen',state:'loading'})];
 assert.deepEqual(activity(events),{label:'loading the model',since:110,model:'qwen'});
 events.push(event('portal_model',150,{model:'qwen',state:'ready'}));
 assert.equal(activity(events).label,'processing the prompt');
 events.push(event('portal_prefill',160,{total:100,processed:50}));
 assert.equal(activity(events).prefill?.processed,50);
});
test('a provider that reports no progress and no loading still shows the prompt being read, without a measure',()=>{
 // A cloud model, or a llama-server that does not send prompt_progress: none of the portal_* events.
 const events:any[]=[event('portal_prompt',100),event('agent_start',101),event('turn_start',102)];
 assert.deepEqual(activity(events),{label:'processing the prompt',since:102,prefill:undefined});
 events.push(event('message_start',110,{message:{role:'assistant'}}));
 assert.deepEqual(activity(events),{label:'processing the prompt',since:110,prefill:undefined});
 events.push(event('message_update',120,{assistantMessageEvent:{type:'text_delta',delta:'Hi'}}));
 assert.equal(activity(events).label,'writing the reply');
});
test('the last turn\'s progress is not carried into the next one',()=>{
 const events:any[]=[event('portal_prompt',100),event('message_start',110,{message:{role:'assistant'}}),event('portal_prefill',120,{total:100,processed:100}),
  event('message_update',130,{assistantMessageEvent:{type:'text_delta',delta:'Hi'}}),event('message_end',140),event('agent_end',150),
  event('portal_prompt',200),event('agent_start',201),event('message_start',210,{message:{role:'assistant'}})];
 assert.equal(activity(events).prefill,undefined);
});
