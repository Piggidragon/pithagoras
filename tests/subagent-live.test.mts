import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LiveEvents} from '../server/src/live-events.ts';
import {buildTranscript} from '../web/src/transcript.ts';
import {subagents} from '../web/src/subagents.ts';
function stream(){let seq=0;const stored:any[]=[];const live=new LiveEvents((session:string,type:string,payload:any)=>{const row={seq:++seq,session_id:session,type,payload:JSON.stringify(payload),created_at:''};stored.push(row);return row;});return {live,stored};}
const delta=(id:string,type:string,text:string)=>({type:'portal_subagent_live',op:'event',id,event:{type:'message_update',assistantMessageEvent:{type,delta:text}}});
test('a page that opens while a subagent is mid-message gets what it has said so far',()=>{
 const {live}=stream();
 live.record('s','portal_subagent',{type:'portal_subagent',op:'start',id:'r',label:'R'});
 live.subagentLive('s',delta('r','thinking_delta','Hm, '));
 live.subagentLive('s',delta('r','text_delta','The answer '));
 live.subagentLive('s',delta('r','text_delta','is 42'));
 live.subagentLive('s',{type:'portal_subagent_live',op:'event',id:'r',event:{type:'tool_execution_update',toolCallId:'t1',partialResult:{content:[{type:'text',text:'searching'}]}}});
 const snap=live.snapshot('s').map(r=>JSON.parse(r.payload));
 assert.deepEqual(snap.map(p=>[p.id,p.event.type,p.event.assistantMessageEvent?.delta??p.event.toolCallId]),[['r','message_update','Hm, '],['r','message_update','The answer is 42'],['r','tool_execution_update','t1']]);
 assert.ok(live.snapshot('s').every(r=>r.seq<0),'live, never stored');
 // Its message and its tool ended: nothing of them is left to catch up on.
 live.record('s','portal_subagent',{type:'portal_subagent',op:'event',id:'r',event:{type:'message_end',message:{role:'assistant',content:[]}}});
 live.record('s','portal_subagent',{type:'portal_subagent',op:'event',id:'r',event:{type:'tool_execution_end',toolCallId:'t1'}});
 assert.deepEqual(live.snapshot('s'),[]);
});
test('a tool that reported as it ran is still one worth watching once the page is loaded again',()=>{
 const {live,stored}=stream();
 live.record('s','tool_execution_start',{toolCallId:'d',toolName:'deep_research',args:{}});
 live.record('s','tool_execution_update',{toolCallId:'d',toolName:'deep_research',partialResult:{details:{phase:'searching'}}});
 live.record('s','tool_execution_update',{toolCallId:'d',toolName:'deep_research',partialResult:{details:{phase:'reading'}}});
 live.record('s','tool_execution_end',{toolCallId:'d',toolName:'deep_research',result:{content:[{type:'text',text:'Found it'}],details:{phase:'done'}}});
 // Loaded again: only what was stored.
 const events=stored.map(r=>({seq:r.seq,type:r.type,at:0,payload:JSON.parse(r.payload)}));
 const items=buildTranscript(events);
 assert.deepEqual(subagents(events,items).map(s=>[s.kind,s.label,s.status]),[['tool','deep_research','done']]);
});
test('a subagent whose start is further up than the page has loaded is still shown',()=>{
 const events:any[]=[
  {seq:900,type:'portal_subagent',at:0,payload:{op:'event',id:'long',event:{type:'message_end',message:{role:'assistant',content:[{type:'text',text:'Step 150 done'}]}}}},
  {seq:901,type:'portal_subagent',at:0,payload:{op:'end',id:'long',status:'done'}},
 ];
 const [sub]=subagents(events,buildTranscript(events));
 assert.deepEqual([sub?.id,sub?.status,sub?.events.length],['long','done',1]);
});
