import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync, realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {listJobs, readOutput, stopJob, MARKER} from '../server/src/background.ts';
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
test('a detached job the agent left running is found, followed and stopped',{skip:process.platform!=='linux'},async()=>{
 const ws=realpathSync(mkdtempSync(path.join(tmpdir(),'bg-')));
 const [k,v]=MARKER.split('=');
 const child=spawn('sh',['-c','echo started; sleep 30; true'],{cwd:ws,detached:true,stdio:['ignore',(await import('node:fs')).openSync(path.join(ws,'out.log'),'w'),'ignore'],env:{...process.env,[k]:v}});
 child.unref();
 const stranger=spawn('sh',['-c','sleep 30'],{cwd:ws,detached:true,stdio:'ignore',env:{...process.env,[k]:''}});
 try{
  await wait(300);
  const jobs=await listJobs(ws,new Set());
  assert.equal(jobs.length,1);
  const job=jobs[0];
  assert.deepEqual([job.command,job.state,job.hasOutput],['echo started; sleep 30; true','running',true]);
  assert.equal((await readOutput(ws,job.key))?.text,'started\n');
  assert.equal((await listJobs(ws,new Set([job.sid]))).filter(j=>j.state==='running').length,0,'a shell of the person is left out');
  await listJobs(ws,new Set());
  assert.equal(await stopJob(ws,job.key,new Set()),true);
  await wait(300);
  const after=(await listJobs(ws,new Set())).find(j=>j.key===job.key);
  assert.equal(after?.state,'exited');
 }finally{try{process.kill(-child.pid!,'SIGKILL')}catch{} try{process.kill(-stranger.pid!,'SIGKILL')}catch{}}
});
