import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import subagent from '../extensions/subagent/index.ts';
// A child pi in RPC mode, as far as the extension can tell. `retry`: its first run fails and is retried. `hang`: it works until stopped.
const dir=mkdtempSync(path.join(tmpdir(),'subagent-'));
const bin=path.join(dir,'pi');
writeFileSync(bin,`#!/usr/bin/env node
const out=e=>process.stdout.write(JSON.stringify(e)+'\\n');
const say=t=>out({type:'message_end',message:{role:'assistant',content:[{type:'text',text:t}]}});
if(process.env.FAKE==='die')process.exit(1);
// Its input closed, still running: what the portal sends it next finds no reader.
if(process.env.FAKE==='deaf'){require('node:fs').closeSync(0);setTimeout(()=>process.exit(1),800);}
else
require('node:readline').createInterface({input:process.stdin}).on('line',l=>{const c=JSON.parse(l);
 if(c.type==='prompt'&&process.env.FAKE==='refuse'){out({type:'response',command:'prompt',success:false,error:'No API key for the model'});return;}
 if(c.type==='prompt'&&process.env.FAKE==='noisy'){process.stderr.write('warning: '.repeat(40000));out({type:'agent_start'});say('done despite the noise');out({type:'agent_end'});out({type:'agent_settled'});return;}
 if(c.type==='prompt'){out({type:'agent_start'});
  if(process.env.FAKE==='hang'){say('half of it');return;}
  say('');out({type:'agent_end',willRetry:true});
  setTimeout(()=>{out({type:'agent_start'});say('the whole answer');out({type:'agent_end'});out({type:'agent_settled'});},50);}
 if(c.type==='abort'){out({type:'agent_end'});out({type:'agent_settled'});}
});
`);
chmodSync(bin,0o755);
process.env.PI_SUBAGENT_BIN=bin;
function load(){
 const h=new Map<string,((d:any)=>void)[]>();
 const events={emit:(c:string,d:any)=>h.get(c)?.forEach(f=>f(d)),on:(c:string,f:(d:any)=>void)=>{h.set(c,[...(h.get(c)??[]),f]);return()=>h.set(c,(h.get(c)??[]).filter(x=>x!==f));}};
 let tool:any;subagent({registerTool:(t:any)=>tool=t,events});
 const ends:any[]=[];events.on('subagent:v1:end',d=>ends.push(d));
 return {tool,events,ends};
}
test('a subagent whose run is retried answers with what it said at the end, not before the retry',async()=>{
 delete process.env.FAKE;
 const {tool,ends}=load();
 const result=await tool.execute('c1',{task:'Look into it'},undefined,undefined,{cwd:dir});
 assert.equal(result.content[0].text,'the whole answer');
 assert.equal(ends[0].status,'done');
});
test('a subagent the person stops in the portal is said to be stopped, not finished',async()=>{
 process.env.FAKE='hang';
 const {tool,events,ends}=load();
 events.on('subagent:v1:event',d=>d.event.type==='message_end'&&events.emit('subagent:v1:stop',{id:d.id}));
 const result=await tool.execute('c2',{task:'Look into it'},undefined,undefined,{cwd:dir});
 assert.equal(ends[0].status,'stopped');
 assert.deepEqual(result.details,{phase:'stopped'});
});
test('a child that dies at once fails the subagent, and what is sent to it after cannot bring down the portal',async()=>{
 process.env.FAKE='die';
 const {tool,events,ends}=load();
 let id='';events.on('subagent:v1:start',d=>id=d.id);
 const failed=assert.rejects(tool.execute('c3',{task:'Look into it'},undefined,undefined,{cwd:dir}));
 await new Promise(r=>setTimeout(r,200));
 // The person types to it, and stops it, after it has gone.
 events.emit('subagent:v1:input',{id,text:'and also this'});
 events.emit('subagent:v1:stop',{id});
 await failed;
 await new Promise(r=>setTimeout(r,100));
 assert.equal(ends[0].status,'error');
});
test('a child that writes a great deal to stderr is not left blocked on it',{timeout:5000},async()=>{
 process.env.FAKE='noisy';
 const {tool}=load();
 const result=await tool.execute('c4',{task:'Look into it'},undefined,undefined,{cwd:dir});
 assert.equal(result.content[0].text,'done despite the noise');
});
test('a child that refuses the task fails the subagent with its reason, rather than waiting for good',{timeout:5000},async()=>{
 process.env.FAKE='refuse';
 const {tool,ends}=load();
 await assert.rejects(tool.execute('c5',{task:'Look into it'},undefined,undefined,{cwd:dir}),/No API key for the model/);
 assert.deepEqual(ends[0],{id:ends[0].id,status:'error',error:'No API key for the model'});
});
test('a message for a child that no longer reads cannot bring down the portal',{timeout:5000},async()=>{
 process.env.FAKE='deaf';
 const {tool,events,ends}=load();
 let id='';events.on('subagent:v1:start',d=>id=d.id);
 const done=tool.execute('c6',{task:'Look into it'},undefined,undefined,{cwd:dir}).catch(()=>undefined);
 await new Promise(r=>setTimeout(r,300));
 events.emit('subagent:v1:input',{id,text:'x'.repeat(200_000)});
 events.emit('subagent:v1:stop',{id});
 await done;
 assert.equal(ends[0].status,'stopped');
});
