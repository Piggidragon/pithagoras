import { randomUUID } from 'node:crypto';
import { getDb } from './db.js';
type Row={id:string;name:string;kind:'design'|'clone';instruction:string;transcript:string;audio:Buffer|null};
function db(){const db=getDb();db.exec(`CREATE TABLE IF NOT EXISTS voice_presets (id TEXT PRIMARY KEY,name TEXT NOT NULL,kind TEXT NOT NULL,instruction TEXT NOT NULL,transcript TEXT NOT NULL,audio BLOB)`);return db;}
export function listVoices(){return db().prepare('SELECT id,name,kind,instruction,transcript FROM voice_presets ORDER BY name').all();}
export function readVoice(id:string){const row=db().prepare('SELECT * FROM voice_presets WHERE id=?').get(id) as Row|undefined;if(!row)throw new Error('Voice not found');return row;}
export function addVoice(value:any){
 const name=typeof value.name==='string'?value.name.trim():'';
 const instruction=typeof value.instruction==='string'?value.instruction.trim():'';
 const transcript=typeof value.transcript==='string'?value.transcript.trim():'';
 if(!name||name.length>100)throw new Error('Enter a voice name of 1–100 characters');
 if(!['design','clone'].includes(value.kind))throw new Error('Choose a designed voice or reference clone');
 if(!instruction||instruction.length>1000)throw new Error('Describe the voice in 1–1000 characters');
 let audio:Buffer|null=null;
 if(value.kind==='clone'){
  if(!transcript||transcript.length>4000)throw new Error('Enter the exact words spoken in the reference (up to 4,000 characters)');
  if(typeof value.audio!=='string'||value.audio.length>1300000)throw new Error('Upload a reference recording of 1–30 seconds');
  audio=Buffer.from(value.audio,'base64');
  if(audio.length<32044||audio.length>960044||audio.toString('ascii',0,4)!=='RIFF'||audio.toString('ascii',8,16)!=='WAVEfmt '||audio.readUInt32LE(16)!==16||audio.readUInt16LE(20)!==1||audio.readUInt16LE(22)!==1||audio.readUInt32LE(24)!==16000||audio.readUInt16LE(34)!==16||audio.toString('ascii',36,40)!=='data'||audio.readUInt32LE(40)!==audio.length-44||audio.length%2)throw new Error('Invalid reference WAV; upload a 1–30 second audio clip using Settings');
 }
 const id='voice-'+randomUUID();db().prepare('INSERT INTO voice_presets VALUES (?,?,?,?,?,?)').run(id,name,value.kind,instruction,transcript,audio);
 return {id,name,kind:value.kind,instruction,transcript};
}
export function deleteVoice(id:string){readVoice(id);db().transaction(()=>{
 const row=db().prepare("SELECT value FROM settings WHERE key='voice'").get() as {value:string}|undefined;
 if(row){const config=JSON.parse(row.value);if(config.voice===id){config.voice='design';db().prepare("UPDATE settings SET value=? WHERE key='voice'").run(JSON.stringify(config));}}
 db().prepare('DELETE FROM voice_presets WHERE id=?').run(id);
})();}
