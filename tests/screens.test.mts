import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createEventBus} from '@earendil-works/pi-coding-agent';
import {bridgeScreens, cleanScreen, SCREENS_MAX} from '../server/src/screens.ts';
import {fakePi, todoExtension} from './fixtures/todo-extension.mts';
import glue from '../skills/extension-screens/templates/glue.mts';
const bus=()=>{const h=new Map<string,((d:unknown)=>void)[]>();return{emit:(c:string,d:unknown)=>h.get(c)?.forEach(f=>f(d)),on:(c:string,f:(d:unknown)=>void)=>{h.set(c,[...(h.get(c)??[]),f]);return()=>h.set(c,(h.get(c)??[]).filter(x=>x!==f));}};};
test('a screen is what has an id and blocks, and a block is what says its type',()=>{
 assert.equal(cleanScreen(undefined),undefined);
 assert.equal(cleanScreen({blocks:[]}),undefined,'no id');
 assert.equal(cleanScreen({id:'  ',blocks:[]}),undefined,'a blank id');
 assert.equal(cleanScreen({id:'a'}),undefined,'no blocks');
 assert.deepEqual(cleanScreen({id:' todo ',title:' Todos ',blocks:[{type:'text',text:'hi'},{text:'no type'},'text',[1],{type:3},null]}),{id:'todo',title:'Todos',blocks:[{type:'text',text:'hi'}]});
 assert.deepEqual(cleanScreen({id:'a',title:'  ',blocks:[]}),{id:'a',blocks:[]},'a blank title is none');
});
test('only plain data gets through: what JSON could not hold, and what is bounded, is left out',()=>{
 const loop:any={type:'text',text:'x'};loop.self=loop;
 const screen=cleanScreen({id:'a',blocks:[
  {type:'list',items:[{text:'one',run:()=>1,gone:undefined,nan:NaN,inf:Infinity,sym:Symbol('s'),big:1n},'two',3,true,null]},
  loop,
 ]})!;
 assert.deepEqual(screen.blocks[0],{type:'list',items:[{text:'one'},'two',3,true]});
 // The loop is cut where it gets too deep, not followed.
 assert.equal(screen.blocks[1].text,'x');
 assert.ok(JSON.stringify(screen).length<20_000);
});
test('text, lists and depth are held to their limits',()=>{
 const long=cleanScreen({id:'a',title:'t'.repeat(500),blocks:[{type:'text',text:'x'.repeat(10_000)}]})!;
 assert.equal(long.title!.length,120);
 assert.equal((long.blocks[0].text as string).length,2000);
 const many=cleanScreen({id:'a',blocks:Array.from({length:500},()=>({type:'text',text:'x'}))})!;
 assert.equal(many.blocks.length,200);
 let deep:any={type:'group',blocks:[]};const top=deep;
 for(let i=0;i<30;i++){const next={type:'group',blocks:[]};deep.blocks.push(next);deep=next;}
 const levels=(b:any):number=>1+Math.max(0,...((b.blocks??[]) as any[]).map(levels));
 assert.ok(levels(cleanScreen({id:'a',blocks:[top]})!.blocks[0])<=5,'a group in a group in a group stops somewhere');
 // The whole screen has a budget, so a list longer than anybody meant is cut and not refused.
 const wide=cleanScreen({id:'a',blocks:Array.from({length:200},()=>({type:'list',items:Array.from({length:200},(_,i)=>`item ${i}`)}))})!;
 assert.ok(wide.blocks.length>0&&wide.blocks.length<200);
 assert.ok(JSON.stringify(wide).length<400_000);
});
test('a screen is held to a size however long its texts are, since it is sent whole with every change and poll',()=>{
 // Every one inside the count limits: 30 lists of 200 items of 5000 characters is some 30 MB asked for.
 const huge=cleanScreen({id:'a',blocks:Array.from({length:30},()=>({type:'list',items:Array.from({length:200},()=>'x'.repeat(5000))}))})!;
 assert.ok(JSON.stringify(huge).length<250_000,'cut, not sent');
 assert.ok(huge.blocks.length>0&&(huge.blocks[0].items as unknown[]).length>0,'what comes first is kept');
 // A text that is cut at the budget keeps its start, and the ones after it are left out.
 const texts=cleanScreen({id:'a',blocks:Array.from({length:100},(_,i)=>({type:'text',text:`${i}:`+'y'.repeat(1990)}))})!;
 assert.ok(texts.blocks.length>=45&&texts.blocks.length<100);
 assert.ok((texts.blocks[0].text as string).startsWith('0:'));
 // Short texts are not touched: a long todo list is well inside.
 const todos=cleanScreen({id:'a',blocks:[{type:'checklist',items:Array.from({length:200},(_,i)=>({text:`Task ${i}`,detail:'d'.repeat(300),state:'todo'}))}]})!;
 assert.equal((todos.blocks[0].items as unknown[]).length,200);
 assert.equal(((todos.blocks[0].items as any[])[199]).detail.length,300);
});
test('what an extension shows reaches the portal as session events, and is kept as it stands',()=>{
 const b=bus();const out:any[]=[];const screens=bridgeScreens(b,e=>out.push(e));
 b.emit('screen:v1:set',{id:'nothing'});
 b.emit('screen:v1:clear',{id:'never-shown'});
 assert.deepEqual(out,[],'nothing for what is not a screen, and for one that was never there');
 b.emit('screen:v1:set',{id:'todo',title:'Todos',blocks:[{type:'text',text:'a'}]});
 b.emit('screen:v1:set',{id:'build',blocks:[{type:'status',text:'green'}]});
 assert.deepEqual(out,[{type:'portal_screen',op:'set',id:'todo',title:'Todos',blocks:[{type:'text',text:'a'}]},{type:'portal_screen',op:'set',id:'build',blocks:[{type:'status',text:'green'}]}]);
 assert.deepEqual(screens.list().map(s=>s.id),['todo','build']);
 // Said again, a screen replaces the last and keeps its place; the same twice is not news.
 b.emit('screen:v1:set',{id:'todo',title:'Todos',blocks:[{type:'text',text:'a'}]});
 assert.equal(out.length,2);
 b.emit('screen:v1:set',{id:'todo',title:'Todos',blocks:[{type:'text',text:'b'}]});
 assert.equal(out.length,3);
 assert.deepEqual(screens.list().map(s=>[s.id,s.blocks[0].text]),[['todo','b'],['build','green']]);
 b.emit('screen:v1:clear',{id:'todo'});
 assert.deepEqual(out.at(-1),{type:'portal_screen',op:'clear',id:'todo'});
 assert.deepEqual(screens.list().map(s=>s.id),['build']);
 b.emit('screen:v1:clear',{id:'todo'});
 assert.equal(out.length,4,'cleared once');
 screens();b.emit('screen:v1:set',{id:'late',blocks:[]});
 assert.equal(out.length,4,'not once the chat\'s pi is gone');
});
test('a chat has only so many screens, and the ones it has are always replaced',()=>{
 const b=bus();const out:any[]=[];const screens=bridgeScreens(b,e=>out.push(e));
 for(let i=0;i<SCREENS_MAX+5;i++)b.emit('screen:v1:set',{id:`s${i}`,blocks:[]});
 assert.equal(screens.list().length,SCREENS_MAX);
 b.emit('screen:v1:set',{id:'s0',blocks:[{type:'text',text:'still'}]});
 assert.equal(screens.list()[0].blocks.length,1);
 b.emit('screen:v1:clear',{id:'s1'});
 b.emit('screen:v1:set',{id:'fits-now',blocks:[]});
 assert.ok(screens.list().some(s=>s.id==='fits-now'));
});
test('a todo list extension is on screen from its data, as it changes, and as the chat is opened again',async()=>{
 const events=createEventBus();const out:any[]=[];const screens=bridgeScreens(events,e=>out.push(e));
 const pi=fakePi(events);todoExtension(pi.api);glue(pi.api as any);
 // Nothing in the conversation yet: no screen.
 await pi.start();
 assert.deepEqual(screens.list(),[]);
 await pi.call('todo',{action:'add',text:'Write the docs'});
 await pi.call('todo',{action:'add',text:'Ship it',after:1});
 await pi.call('todo',{action:'start',id:1});
 const shown=()=>screens.list()[0];
 assert.equal(shown().title,'Todos');
 assert.deepEqual(shown().blocks[0],{type:'status',label:'Done',text:'0 of 2'});
 assert.deepEqual((shown().blocks[1] as any).items,[{text:'Write the docs',state:'doing'},{text:'Ship it',state:'blocked',detail:'after #1'}]);
 await pi.call('todo',{action:'complete',id:1});
 assert.deepEqual((shown().blocks[1] as any).items.map((i:any)=>i.state),['done','todo']);
 await pi.call('todo',{action:'complete',id:2});
 assert.deepEqual(shown().blocks[0],{type:'status',label:'Done',text:'2 of 2',tone:'ok'});
 // A call that changes nothing on screen is no news to the page.
 await pi.call('todo',{action:'start',id:99});
 assert.deepEqual(out.map(e=>e.op),['set','set','set','set','set']);
 // The chat is opened again: the screen is gone with the process that held it, and said again from what the conversation holds.
 await pi.shutdown();
 assert.deepEqual(screens.list(),[]);
 await pi.start('resume');
 assert.equal(shown().blocks[0].text,'2 of 2');
 await pi.call('todo',{action:'clear'});
 assert.deepEqual((shown().blocks[1] as any).items,[]);
 assert.equal((shown().blocks[1] as any).empty,'Nothing to do yet.');
});
test('the glue says no screen for data it does not know, and leaves the screen alone for a result that is none of it',async()=>{
 const events=createEventBus();const out:any[]=[];const screens=bridgeScreens(events,e=>out.push(e));
 const pi=fakePi(events);todoExtension(pi.api);glue(pi.api as any);
 await pi.start();
 await pi.call('todo',{action:'add',text:'Write the docs'});
 assert.equal(out.length,1);
 // Another tool's result, and one of the tool's own that carries no list (a failed call): the screen stays as it was.
 await pi.result('bash',{todos:[]});
 await pi.result('todo',undefined);
 await pi.result('todo',{error:'no such task'});
 assert.equal(out.length,1);
 assert.equal(screens.list().length,1);
 // The conversation moves to another branch with the same list: nothing to say again, and the failed calls do not take it away.
 await pi.tree();
 assert.equal(out.length,1);
 await pi.start('resume');
 assert.equal(out.length,1);
 // Nothing in the conversation has the list in it, as after an update of the extension that changed what it keeps: a wrong screen is worse than none.
 const events2=createEventBus();const out2:any[]=[];const screens2=bridgeScreens(events2,e=>out2.push(e));
 const pi2=fakePi(events2);glue(pi2.api as any);
 await pi2.result('todo',{todos:'three',tasks:[]});
 await pi2.start();
 assert.deepEqual(screens2.list(),[]);
 // A list of what it does not expect is no list, and never throws into the extension.
 await pi2.result('todo',{todos:[null,{text:'x'}]});
 await pi2.result('todo',{todos:[{text:'x',status:'pending'}]});
 assert.equal(screens2.list().length,1);
});
