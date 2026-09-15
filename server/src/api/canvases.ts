import express from 'express';
import { getDb } from '../db.js';
import { persistCanvas, canvasEvents, listCanvases, createCanvas, editCanvas, deleteCanvas } from '../canvases.js';
export function canvasesRouter() {
  const router=express.Router();
  router.use('/sessions/:sessionId/canvases', (req,res,next)=> {
    if(!getDb().prepare('SELECT id FROM sessions WHERE id = ?').get(req.params.sessionId)) return res.status(404).json({error:'Session not found'});
    next();
  });
  router.get('/sessions/:sessionId/canvases', (req,res)=>res.json(listCanvases(String(req.params.sessionId))));
  router.get('/sessions/:sessionId/canvases/events',(req,res)=> {
    const session=String(req.params.sessionId);
    res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});res.flushHeaders();
    const send=(data: unknown)=>res.write(`data: ${JSON.stringify(data)}\n\n`);
    canvasEvents.on(session,send);
    send({type:'snapshot',canvases:listCanvases(session)});
    const timer=setInterval(()=>res.write(': keepalive\n\n'),15000);
    res.on('close',()=>{clearInterval(timer);canvasEvents.off(session,send)});
  });
  router.post('/sessions/:sessionId/canvases',(req,res)=> {
    try { if(typeof req.body?.title!=='string') throw new Error('Title required');res.json(createCanvas(String(req.params.sessionId),req.body.title)); }
    catch(e){res.status(400).json({error:(e as Error).message})}
  });
  router.post('/sessions/:sessionId/canvases/:id/persist',(req,res)=>{
    try {res.json(persistCanvas(String(req.params.sessionId),String(req.params.id)));}
    catch(e){res.status(400).json({error:(e as Error).message})}
  });
  router.put('/sessions/:sessionId/canvases/:id',(req,res)=> {
    try { const {revision,title,content}=req.body??{};if(!Number.isInteger(revision)||typeof title!=='string'||typeof content!=='string') throw new Error('Revision, title and content required');res.json(editCanvas(String(req.params.sessionId),String(req.params.id),revision,title,content)); }
    catch(e){res.status(409).json({error:(e as Error).message})}
  });
  router.delete('/sessions/:sessionId/canvases/:id',(req,res)=> {
    try {const revision=req.body?.revision;if(!Number.isInteger(revision)) throw new Error('Revision required');deleteCanvas(String(req.params.sessionId),String(req.params.id),revision);res.json({ok:true});}
    catch(e){res.status(409).json({error:(e as Error).message})}
  });
  return router;
}
