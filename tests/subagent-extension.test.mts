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
require('node:readline').createInterface({input:process.stdin}).on('line',l=>{const c=JSON.parse(l);
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
