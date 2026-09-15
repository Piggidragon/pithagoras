import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
process.env.DATA_DIR=mkdtempSync(tmpdir()+'/voice-presets-');
const {addVoice,readVoice,listVoices,deleteVoice}=await import('../server/src/voice-presets.js');
const {getDb}=await import('../server/src/db.js');
const {validateConfig}=await import('../server/src/api/voice.js');
const {samplesWav}=await import('../web/src/voice.ts');
test('reference voices persist audio privately and can be selected for synthesis',async()=>{
 const audio=Buffer.from(await samplesWav(new Float32Array(16000)).arrayBuffer()).toString('base64');
 const voice=addVoice({name:'Test clone',kind:'clone',instruction:'Warm delivery',transcript:'A reference line',audio});
 assert.equal(readVoice(voice.id).audio?.length,32044);assert.ok(!('audio' in (listVoices()[0] as any)));
 const config=validateConfig({enabled:true,voice:voice.id,instruction:'Clear',whisperUrl:'http://localhost/a',breezeUrl:'http://localhost/b'});assert.equal(config.voice,voice.id);
 getDb().prepare("INSERT INTO settings(key,value) VALUES ('voice',?)").run(JSON.stringify(config));
 deleteVoice(voice.id);assert.throws(()=>readVoice(voice.id),/not found/);
 const saved=JSON.parse((getDb().prepare("SELECT value FROM settings WHERE key='voice'").get() as any).value);assert.equal(saved.voice,'design');assert.equal(saved.breezeUrl,config.breezeUrl);
});
test('designed voices need no recording; invalid references and unknown selections are rejected',()=>{
 const voice=addVoice({name:'Narrator',kind:'design',instruction:'Low, calm voice'});assert.equal(readVoice(voice.id).audio,null);
 assert.throws(()=>addVoice({name:'Bad',kind:'clone',instruction:'Clear',transcript:'Hello',audio:'YWJj'}),/Invalid reference/);
 assert.throws(()=>addVoice({name:'Bad',kind:'clone',instruction:'Clear',transcript:'',audio:''}),/exact words/);
 assert.throws(()=>validateConfig({enabled:true,voice:'missing',instruction:'Clear',whisperUrl:'http://localhost/a',breezeUrl:'http://localhost/b'}),/not found/);
});
