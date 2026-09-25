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
const agentEnv=()=>{const [k,v]=MARKER.split('=');return {...process.env,[k]:v};};
test('a workspace reached through a link still has its jobs found',{skip:process.platform!=='linux'},async()=>{
 const ws=realpathSync(mkdtempSync(path.join(tmpdir(),'bg-')));
 const link=path.join(realpathSync(tmpdir()),`bg-link-${process.pid}`);
 (await import('node:fs')).symlinkSync(ws,link);
 const child=spawn('sh',['-c','sleep 30'],{cwd:ws,detached:true,stdio:'ignore',env:agentEnv()});
 child.unref();
 try{
  await wait(300);
  assert.equal((await listJobs(link,new Set())).filter(j=>j.state==='running').length,1);
 }finally{try{process.kill(-child.pid!,'SIGKILL')}catch{} (await import('node:fs')).unlinkSync(link);}
});
test('a job whose shell exits while what it started goes on stays one job',{skip:process.platform!=='linux'},async()=>{
 const ws=realpathSync(mkdtempSync(path.join(tmpdir(),'bg-')));
 const fs=await import('node:fs');
 // `npm run dev > dev.log &` and then the shell ends: the server is the job now.
 const child=spawn('sh',['-c','sleep 30 & sleep 0.4'],{cwd:ws,detached:true,stdio:['ignore',fs.openSync(path.join(ws,'dev.log'),'w'),'ignore'],env:agentEnv()});
 child.unref();
 try{
  await wait(200);
  const [first]=await listJobs(ws,new Set());
  await wait(1300);
  const after=await listJobs(ws,new Set());
  assert.deepEqual(after.map(j=>[j.key,j.state,j.command]),[[first.key,'running','sleep 30 & sleep 0.4']]);
 }finally{try{process.kill(-child.pid!,'SIGKILL')}catch{}}
});
test('what the portal runs in its own session is not a job of the agent\'s',{skip:process.platform!=='linux'},async()=>{
 const ws=realpathSync(mkdtempSync(path.join(tmpdir(),'bg-')));
 const fs=await import('node:fs');
 // The terminal's wrapper, a subagent's pi: started by the portal, marked, and in its session.
 const child=spawn('sh',['-c','sleep 30'],{cwd:ws,stdio:['ignore',fs.openSync(path.join(ws,'out.log'),'w'),'ignore'],env:agentEnv()});
 try{
  await wait(300);
  assert.deepEqual(await listJobs(ws,new Set()),[]);
 }finally{child.kill('SIGKILL');}
});
test('a job whose processes all change between two looks is still the one job',{skip:process.platform!=='linux'},async()=>{
 const ws=realpathSync(mkdtempSync(path.join(tmpdir(),'bg-')));
 const fs=await import('node:fs');
 // `npm install && nohup npm start &`: the install ends, the shell forks the server and ends.
 const child=spawn('sh',['-c','sleep 0.6; sleep 30 & sleep 0.2'],{cwd:ws,detached:true,stdio:['ignore',fs.openSync(path.join(ws,'app.log'),'w'),'ignore'],env:agentEnv()});
 child.unref();
 try{
  await wait(200);
  const [first]=await listJobs(ws,new Set());
  await wait(1500);
  const after=await listJobs(ws,new Set());
  assert.deepEqual(after.map(j=>[j.key,j.state]),[[first.key,'running']]);
 }finally{try{process.kill(-child.pid!,'SIGKILL')}catch{}}
});
test('a job in a workspace inside another is the job of both, for each to follow and stop',{skip:process.platform!=='linux'},async()=>{
 const outer=realpathSync(mkdtempSync(path.join(tmpdir(),'bg-')));
 const inner=path.join(outer,'proj');
 const fs=await import('node:fs');
 fs.mkdirSync(inner);
 const child=spawn('sh',['-c','echo hi; sleep 30'],{cwd:inner,detached:true,stdio:['ignore',fs.openSync(path.join(inner,'out.log'),'w'),'ignore'],env:agentEnv()});
 child.unref();
 try{
  await wait(300);
  const [a]=await listJobs(outer,new Set());
  const [b]=await listJobs(inner,new Set());
  assert.equal(a.key,b.key);
  // The inner chat looked last: the outer one can still read and stop it.
  assert.equal((await readOutput(outer,a.key))?.text,'hi\n');
  assert.equal(await stopJob(outer,a.key,new Set()),true);
 }finally{try{process.kill(-child.pid!,'SIGKILL')}catch{}}
});
