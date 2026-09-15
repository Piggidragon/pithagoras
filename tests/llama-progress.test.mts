import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {startLlamaProxy,proxyBaseUrl,forgetSession} from '../server/src/llama-progress.ts';
test('progress survives split SSE packets while response is forwarded unchanged',async()=>{
 const frames='data: {"prompt_progress":{"total":100,"processed":40,"cache":10,"time_ms":200}}\n\ndata: [DONE]\n\n';
 const upstream=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{assert.equal(JSON.parse(body).return_progress,true);res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(frames.slice(0,35));setTimeout(()=>res.end(frames.slice(35)),30);});});
 upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
 const received:any[]=[];startLlamaProxy((id,p)=>received.push({id,...p}));
 await new Promise(resolve=>setTimeout(resolve,20));
 const origin=`http://127.0.0.1:${(upstream.address() as any).port}`;
 try {const base=proxyBaseUrl('test-progress',origin);assert.ok(base);const r=await fetch(base+'/v1/chat/completions',{method:'POST',body:JSON.stringify({stream:true,model:'test'})});assert.equal(await r.text(),frames);assert.deepEqual(received,[{id:'test-progress',total:100,processed:40,cache:10,timeMs:200}]);}
 finally{forgetSession('test-progress');upstream.closeAllConnections();upstream.close();}
});
