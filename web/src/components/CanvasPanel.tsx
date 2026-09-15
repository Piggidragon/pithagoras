import { useEffect, useRef, useState } from 'react';
import { LuFileText, LuPlus, LuX, LuTrash2, LuCheck, LuPencil, LuEye, LuSave, LuDownload } from 'react-icons/lu';
import { Streamdown } from 'streamdown';

type Canvas = { id:string; title:string; content:string; revision:number; status:string; active_call:string|null; updated_at:string; persisted:boolean };
async function request(url:string,method:string,body?:unknown) {
  const res=await fetch(url,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await res.json();if(!res.ok)throw new Error(data.error||'Canvas request failed');return data;
}
export function CanvasPanel({sessionId,open,setOpen,showToggle=true}:{sessionId:string;open:boolean;setOpen:(open:boolean)=>void;showToggle?:boolean}) {
  const [rows,setRows]=useState<Canvas[]>([]),[selected,setSelected]=useState('');
  const [editing,setEditing]=useState(false),[draft,setDraft]=useState(''),[title,setTitle]=useState(''),[base,setBase]=useState(0);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[connected,setConnected]=useState(false);
  const [confirmDelete,setConfirmDelete]=useState(false);
  const editingRef=useRef(editing);editingRef.current=editing;
  const lastActiveCall=useRef<string|null>(null);
  const updates=useRef(0);
  const viewport=useRef<HTMLDivElement>(null),follow=useRef(true);
  const root=`/api/sessions/${encodeURIComponent(sessionId)}/canvases`;
  const canvas=rows.find(row=>row.id===selected);
  useEffect(()=>{
    setRows([]);setSelected('');setOpen(false);setEditing(false);setError('');setConfirmDelete(false);
    const source=new EventSource(root+'/events');
    source.onopen=()=>setConnected(true);source.onerror=()=>setConnected(false);
    source.onmessage=event=>{
      const data=JSON.parse(event.data);updates.current++;
      if(data.type==='snapshot'){setRows(data.canvases);return;}
      if(data.type==='delete'){setRows(prev=>prev.filter(row=>row.id!==data.id));return;}
      const row=data.canvas as Canvas;
      setRows(prev=>[row,...prev.filter(item=>item.id!==row.id)]);
      // Follow an agent's new document unless a different canvas is being edited.
      if(data.type==='create'||data.type==='focus'||row.status==='writing'&&row.active_call!==lastActiveCall.current){lastActiveCall.current=row.active_call;if(!editingRef.current){setOpen(true);setSelected(row.id);}}
    };
    return ()=>source.close();
  },[root]);
  // Load the list independently of the live stream; refresh on opening and while reconnecting.
  useEffect(()=>{
    let disposed=false;
    const load=async()=>{const version=updates.current;try{const data=await request(root,'GET');if(!disposed&&version===updates.current){setRows(data);setError('');}}catch(e){if(!disposed)setError((e as Error).message);}};
    void load();const timer=!connected?setInterval(()=>void load(),5000):undefined;
    return()=>{disposed=true;if(timer)clearInterval(timer);};
  },[root,open,connected]);
  useEffect(()=>{if(!editing&&!rows.some(row=>row.id===selected))setSelected(rows[0]?.id??'');},[rows,selected,editing]);
  useEffect(()=>{if(canvas?.active_call&&follow.current&&viewport.current)viewport.current.scrollTop=viewport.current.scrollHeight;},[canvas?.content,canvas?.active_call]);
  const beginEdit=()=>{if(!canvas)return;setDraft(canvas.content);setTitle(canvas.title);setBase(canvas.revision);setEditing(true);setError('');};
  const save=async()=>{if(!canvas)return;setBusy(true);setError('');try{const row=await request(root+'/'+canvas.id,'PUT',{revision:base,title,content:draft});setRows(prev=>[row,...prev.filter(x=>x.id!==row.id)]);setEditing(false);}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const create=async()=>{setBusy(true);setError('');try{const row=await request(root,'POST',{title:'Untitled document'});setRows(prev=>[row,...prev.filter(x=>x.id!==row.id)]);setSelected(row.id);setOpen(true);setDraft('');setTitle(row.title);setBase(row.revision);setEditing(true);}catch(e){setError((e as Error).message)}finally{setBusy(false)}};
  const remove=async()=>{if(!canvas)return;setBusy(true);try{await request(root+'/'+canvas.id,'DELETE',{revision:canvas.revision});setRows(prev=>prev.filter(x=>x.id!==canvas.id));setSelected('');setConfirmDelete(false);}catch(e){setError((e as Error).message)}finally{setBusy(false)}};
  const store=async()=>{if(!canvas)return;setBusy(true);setError('');try{const row=await request(root+'/'+canvas.id+'/persist','POST');setRows(prev=>[row,...prev.filter(x=>x.id!==row.id)]);}catch(e){setError((e as Error).message)}finally{setBusy(false)}};
  const download=()=>{if(!canvas)return;const url=URL.createObjectURL(new Blob([editing?draft:canvas.content],{type:'text/markdown;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=((editing?title:canvas.title).replace(/[\\/:*?"<>|]/g,'_')||'canvas')+'.md';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  return <div className={`session-canvases ${open?'is-open':''}`}>
    {showToggle && <button className="canvas-toggle" onClick={()=>setOpen(!open)} aria-expanded={open} aria-label="Session canvases" title="Session canvases"><LuFileText/></button>}
    {open&&<section className="canvas-panel" aria-label="Session canvas workspace">
      <header><div><LuFileText/><strong>Session canvases</strong></div><div className="canvas-frame-actions"><button aria-label={canvas?.persisted?"Canvas stored":"Store canvas"} title={canvas?.persisted?"Stored — edits auto-save":"Store canvas permanently"} disabled={!canvas||canvas.persisted||busy||editing} onClick={()=>void store()}>{canvas?.persisted?<LuCheck/>:<LuSave/>}</button><button aria-label="Download canvas" title="Download Markdown" disabled={!canvas} onClick={download}><LuDownload/></button><button aria-label="Close canvas" disabled={editing} onClick={()=>setOpen(false)}><LuX/></button></div></header>
      <div className="canvas-picker"><select aria-label="Select canvas" value={selected} disabled={editing} onChange={e=>{setSelected(e.target.value);setConfirmDelete(false);setError('');follow.current=true}}><option value="" disabled>Choose a document</option>{rows.map(row=><option key={row.id} value={row.id}>{row.title}{row.persisted?"":" (temporary)"}</option>)}</select><button disabled={editing||busy} aria-label="New canvas" onClick={()=>void create()}><LuPlus/></button></div>
      {!connected&&<p className="canvas-notice">Reconnecting to live canvas…</p>}
      {error&&<p role="alert" className="canvas-error">{error}</p>}
      {canvas?<>
        <div className="canvas-document-heading">{editing?<input aria-label="Canvas title" maxLength={200} value={title} onChange={e=>setTitle(e.target.value)}/>:<h3>{canvas.title}</h3>}<span>{canvas.active_call?'Writing live':canvas.status==='edited'?'Edited by you':canvas.status==='interrupted'?'Partial draft retained':canvas.persisted?'Auto-saved':'Temporary'} · {canvas.persisted?"Stored":"Not stored — lost on server restart"} · r{canvas.revision}</span></div>
        {editing&&canvas.revision!==base&&<p className="canvas-error">This document changed. Your draft is preserved here; copy it before cancelling to read the latest version.</p>}
        {editing?<textarea className="canvas-editor" aria-label="Edit canvas content" value={draft} onChange={e=>setDraft(e.target.value)} spellCheck/>:<div ref={viewport} className="canvas-document prose prose-sm max-w-none" onScroll={e=>{const el=e.currentTarget;follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<60}}>{canvas.content?<Streamdown>{canvas.content}</Streamdown>:<p className="canvas-empty">A blank page. Ask the agent to write here, or start editing.</p>}</div>}
        <footer>{editing?<><button disabled={busy||!title.trim()||canvas.revision!==base||!!canvas.active_call} onClick={()=>void save()}><LuCheck/>{canvas.persisted?"Save changes":"Apply changes"}</button><button disabled={busy} onClick={()=>{setEditing(false);setError('')}}><LuEye/>Cancel edit</button></>:<><button disabled={!!canvas.active_call||busy} onClick={beginEdit}><LuPencil/>Edit inline</button><button disabled={!!canvas.active_call||busy} aria-label="Delete canvas" onClick={()=>setConfirmDelete(true)}><LuTrash2/></button></>}{confirmDelete&&!editing&&<span className="canvas-delete-confirm">Delete this document? <button disabled={busy} onClick={()=>void remove()}>Delete</button><button onClick={()=>setConfirmDelete(false)}>Keep</button></span>}</footer>
      </>:<div className="canvas-empty"><LuFileText/><h3>A place for your documents</h3><p>Ask the agent to create a canvas, or start a document here.</p><button disabled={busy} onClick={()=>void create()}>Create canvas</button></div>}
    </section>}
  </div>;
}
