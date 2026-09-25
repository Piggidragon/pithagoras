import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bridgeSubagents} from '../server/src/subagent-protocol.ts';
const bus=()=>{const h=new Map<string,((d:unknown)=>void)[]>();return{emit:(c:string,d:unknown)=>h.get(c)?.forEach(f=>f(d)),on:(c:string,f:(d:unknown)=>void)=>{h.set(c,[...(h.get(c)??[]),f]);return()=>h.set(c,(h.get(c)??[]).filter(x=>x!==f));}};};
test('a subagent an extension announces reaches the portal as session events',()=>{
 const b=bus();const out:any[]=[];const off=bridgeSubagents(b,e=>out.push(e));
 b.emit('subagent:v1:event',{id:'x',event:{type:'agent_start'}});
 assert.equal(out.length,0,'nothing about a subagent that was never started');
 b.emit('subagent:v1:start',{id:'r1',label:'Research',input:true});
 b.emit('subagent:v1:event',{id:'r1',event:{type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'Hi',partial:{huge:true}}}});
 b.emit('subagent:v1:event',{id:'r1',event:{type:'tool_execution_end',toolCallId:'t',toolName:'web_search',result:{content:[{type:'text',text:'found'},{type:'image',data:'…'}]}}});
 b.emit('subagent:v1:event',{id:'r1',event:{type:'something_else'}});
 b.emit('subagent:v1:end',{id:'r1',status:'bogus'});
 assert.deepEqual(out.map(e=>[e.type,e.op]),[['portal_subagent','start'],['portal_subagent_live','event'],['portal_subagent','event'],['portal_subagent','end']]);
 assert.deepEqual(out[0],{type:'portal_subagent',op:'start',id:'r1',label:'Research',input:true,stop:false});
 assert.deepEqual(out[1].event,{type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'Hi'}});
 assert.deepEqual(out[2].event.result,{content:[{type:'text',text:'found'}]});
 assert.equal(out[3].status,'done');
 off();b.emit('subagent:v1:start',{id:'r2'});assert.equal(out.length,4);
});
test('a subagent\'s finished message says how long it thought',()=>{
 const b=bus();const out:any[]=[];bridgeSubagents(b,e=>out.push(e));
 b.emit('subagent:v1:start',{id:'r',label:'R'});
 b.emit('subagent:v1:event',{id:'r',event:{type:'message_update',assistantMessageEvent:{type:'thinking_delta',delta:'Hm'}}});
 b.emit('subagent:v1:event',{id:'r',event:{type:'message_end',message:{role:'assistant',content:[{type:'thinking',thinking:'Hm'}]}}});
 const end=out.find(e=>e.event?.type==='message_end').event;
 assert.equal(typeof end.thinkingSince,'number');
 assert.ok(end.thinkingUntil>=end.thinkingSince);
});
