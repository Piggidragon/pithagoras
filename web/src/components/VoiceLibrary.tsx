import {useEffect,useState} from 'react';
import {LuPlus,LuTrash2} from 'react-icons/lu';
import {samplesWav} from '../voice';
type Preset={id:string;name:string;kind:'design'|'clone';instruction:string;transcript:string};
async function request(path='',method='GET',body?:unknown){const r=await fetch('/api/voice/presets'+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.error||'Voice request failed');return data;}
async function reference(file:File){
 if(file.size>20*1024*1024)throw Error('Choose an audio file smaller than 20 MB');
 const decoder=new OfflineAudioContext(1,16000,16000);
 const decoded=await decoder.decodeAudioData(await file.arrayBuffer());
 if(decoded.duration<1||decoded.duration>30)throw Error('Choose a recording between 1 and 30 seconds');
 const renderer=new OfflineAudioContext(1,Math.round(decoded.duration*16000),16000);
 const source=renderer.createBufferSource();source.buffer=decoded;source.connect(renderer.destination);source.start();
 const rendered=await renderer.startRendering();const blob=samplesWav(rendered.getChannelData(0));
 return new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('Could not read the recording'));reader.readAsDataURL(blob);});
}
export function VoiceLibrary({value,onChange,onError}:{value:string;onChange:(id:string)=>void;onError:(message:string)=>void}){
 const [voices,setVoices]=useState<Preset[]>([]),[adding,setAdding]=useState(false),[busy,setBusy]=useState(false);
 const [name,setName]=useState(''),[kind,setKind]=useState<'design'|'clone'>('clone'),[instruction,setInstruction]=useState('Speak clearly and naturally.'),[transcript,setTranscript]=useState(''),[file,setFile]=useState<File|null>(null);
 useEffect(()=>{void request().then(setVoices).catch(e=>onError(e.message));},[]);
 const selected=voices.find(v=>v.id===value);
 const field='mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-xs';
 return <div className="space-y-2">
  <label className="block text-xs text-fg-muted">Speaking voice<select aria-label="Speaking voice" className={field} value={value} onChange={e=>onChange(e.target.value)}><option value="design">Designed voice</option><option value="aria">Aria · reference clone</option>{voices.map(v=><option key={v.id} value={v.id}>{v.name} · {v.kind==='clone'?'reference clone':'designed'}</option>)}</select></label>
  {selected&&<div className="rounded-lg border border-line p-3 space-y-2"><p className="text-xs text-fg-muted">{selected.instruction}</p>{selected.kind==='clone'&&<><audio aria-label="Voice reference preview" controls preload="none" className="w-full h-9" src={`/api/voice/presets/${selected.id}/audio`}/><p className="text-xs text-fg-faint">{selected.transcript}</p></>}<button type="button" disabled={busy} className="inline-flex items-center gap-1 text-xs text-danger" onClick={async()=>{if(!window.confirm(`Delete voice “${selected.name}”?`))return;setBusy(true);try{await request('/'+selected.id,'DELETE');setVoices(v=>v.filter(p=>p.id!==selected.id));onChange('design');window.dispatchEvent(new Event('voice-config-changed'));}catch(e){onError((e as Error).message);}finally{setBusy(false);}}}><LuTrash2/>Delete voice</button></div>}
  <button type="button" className="inline-flex items-center gap-1.5 rounded-lg bg-accent/12 px-3 py-1.5 text-xs text-accent" onClick={()=>setAdding(v=>!v)}><LuPlus/>{adding?'Close new voice':'Add voice'}</button>
  {adding&&<div className="rounded-lg border border-line bg-surface p-3 space-y-3">
   <label className="block text-xs">Voice name<input className={field} value={name} maxLength={100} onChange={e=>setName(e.target.value)}/></label>
   <label className="block text-xs">Voice type<select className={field} value={kind} onChange={e=>setKind(e.target.value as 'clone'|'design')}><option value="clone">Clone from a recording</option><option value="design">Design from a description</option></select></label>
   <label className="block text-xs">Voice description<textarea className={field} value={instruction} maxLength={1000} onChange={e=>setInstruction(e.target.value)}/></label>
   {kind==='clone'&&<><label className="block text-xs">Reference recording<input type="file" accept="audio/*" className={field} onChange={e=>setFile(e.target.files?.[0]??null)}/></label><p className="text-xs text-fg-faint">Use a clean 1–30 second clip with one speaker and no background music. Browser-supported audio formats are converted automatically.</p><label className="block text-xs">Exact words in the recording<textarea className={field} value={transcript} maxLength={4000} onChange={e=>setTranscript(e.target.value)}/></label></>}
   <button type="button" disabled={busy||!name.trim()||!instruction.trim()||(kind==='clone'&&(!file||!transcript.trim()))} className="rounded-lg bg-accent/12 px-3 py-1.5 text-xs text-accent disabled:opacity-40" onClick={async()=>{setBusy(true);try{const audio=kind==='clone'?await reference(file!):undefined;const row=await request('','POST',{name,kind,instruction,transcript,audio});setVoices(v=>[...v,row]);onChange(row.id);setAdding(false);setName('');setTranscript('');setFile(null);}catch(e){onError((e as Error).message);}finally{setBusy(false);}}}>{busy?'Saving voice…':'Save new voice'}</button>
   <p className="text-xs text-fg-faint">The voice is saved in your portal. Click Save voice settings below to use it for spoken responses.</p>
  </div>}
 </div>;
}
