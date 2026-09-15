import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { LlamaSessionCache } from '../server/src/llama-session-cache.js';
test('save and restore stay serialized with inference, and resident sessions skip restore', async () => {
 const events: string[] = [];
 const server = http.createServer((req,res) => { req.resume(); req.on('end', () => { const action = new URL(req.url!, 'http://local').searchParams.get('action'); events.push(action!); res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ n_saved: 100, n_restored: 100 })); }); });
 await new Promise<void>(r => server.listen(0,'127.0.0.1',r));
 try {
  const origin = `http://127.0.0.1:${(server.address() as any).port}`, cache = new LlamaSessionCache(), signal = new AbortController().signal;
  const run = (session: string) => cache.run(origin,'model',session,signal,async () => { events.push(session); return true; });
  await Promise.all([run('a'),run('a'),run('b')]);
  assert.deepEqual(events,['restore','a','save','a','save','restore','b','save']);
 } finally { await new Promise<void>(r => server.close(()=>r())); }
});
