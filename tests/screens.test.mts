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
 // Nesting is held to seven levels (a block in a group, an item in an item); what is deeper goes whole, and the block that held it.
 const chain=(n:number)=>{let g:any={type:'group',title:'g',blocks:[{type:'text',text:'leaf'}]};for(let i=1;i<n;i++)g={type:'group',title:'g',blocks:[g]};return g;};
 const levels=(b:any):number=>1+Math.max(0,...((b.blocks??[]) as any[]).map(levels));
 assert.equal(levels(cleanScreen({id:'a',blocks:[chain(6)]})!.blocks[0]),7,'six groups and what is in the last: seven levels');
 assert.deepEqual(cleanScreen({id:'a',blocks:[chain(7)]})!.blocks,[],'one more is left out, not cut to groups with nothing in them');
 assert.deepEqual(cleanScreen({id:'a',blocks:[chain(30)]})!.blocks,[]);
 // Lists in lists count too, so that a cyclic one is cut as well.
 const loop:any[]=[];loop.push(loop,'x');
 assert.ok(JSON.stringify(cleanScreen({id:'a',blocks:[{type:'list',items:loop}]})!).length<2000);
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
 // It is cut between the blocks: the one that does not fit is left out whole, and so are the ones after it.
 const texts=cleanScreen({id:'a',blocks:Array.from({length:100},(_,i)=>({type:'text',text:`${i}:`+'y'.repeat(1990)}))})!;
 assert.ok(texts.blocks.length>=45&&texts.blocks.length<100);
 assert.ok(texts.blocks.every((b,i)=>b.type==='text'&&(b.text as string).length===(i<10?1992:i<100?1993:1994)),'none of them cut');
 // Short texts are not touched: a long todo list is well inside.
 const todos=cleanScreen({id:'a',blocks:[{type:'checklist',items:Array.from({length:200},(_,i)=>({text:`Task ${i}`,detail:'d'.repeat(300),state:'todo'}))}]})!;
 assert.equal((todos.blocks[0].items as unknown[]).length,200);
 assert.equal(((todos.blocks[0].items as any[])[199]).detail.length,300);
});
test('what is cut at the limits is cut between values, so that what stays is what was said',()=>{
 // A task of a long list that is done is done on the page, or it is not there: not shown as to do for a missing `state`.
 const tasks=cleanScreen({id:'a',blocks:[{type:'checklist',items:Array.from({length:60},(_,i)=>({text:`Task ${i}`,detail:'d'.repeat(1700),state:'done'}))}]})!;
 const items=tasks.blocks[0].items as any[];
 assert.ok(items.length>40&&items.length<60,'cut before the end');
 items.forEach((item,i)=>assert.deepEqual(item,{text:`Task ${i}`,detail:'d'.repeat(1700),state:'done'}));
 assert.equal(tasks.blocks[0].type,'checklist');
 // Nor does a block lose its type to the limit, or a group keep blocks that are empty.
 const rest=cleanScreen({id:'a',blocks:[{type:'text',text:'a'.repeat(1990)},...Array.from({length:60},()=>({type:'text',text:'b'.repeat(1990)})),{type:'checklist',items:['one']}]})!;
 assert.ok(rest.blocks.every(b=>b.type==='text'&&typeof b.text==='string'&&(b.text as string).length===1990),'whole or not there');
 const groups=cleanScreen({id:'a',blocks:Array.from({length:4},()=>({type:'group',title:'Part',blocks:Array.from({length:30},()=>({type:'text',text:'t'.repeat(1200)}))}))})!;
 assert.ok(groups.blocks.length>=2&&groups.blocks.length<=4);
 for(const group of groups.blocks){
  assert.equal(group.type,'group');assert.equal(group.title,'Part');
  for(const block of group.blocks as any[]) assert.deepEqual(block,{type:'text',text:'t'.repeat(1200)});
 }
 // The same at the count of values: an item of a long list is whole, or it is not there.
 const many=cleanScreen({id:'a',blocks:[{type:'checklist',items:Array.from({length:199},(_,i)=>({text:`T${i}`,state:'done',detail:'x',tone:'ok',items:[{text:'sub',state:'done'}]}))},{type:'checklist',items:Array.from({length:199},(_,i)=>({text:`U${i}`,state:'done',detail:'x',tone:'ok'}))}]})!;
 for(const block of many.blocks) for(const item of block.items as any[]) assert.equal(item.state,'done',`${item.text} keeps its state`);
});
test('a list the limit leaves nothing of is left out, not kept empty, since the page would say there is nothing in it',()=>{
 const empties=(blocks:any[]):any[]=>blocks.flatMap(b=>[...((b.items?.length===0||b.blocks?.length===0)?[b]:[]),...empties(b.blocks??[])]);
 // The first task of the last list is the one that does not fit.
 const last=cleanScreen({id:'a',blocks:[...Array.from({length:49},()=>({type:'text',text:'a'.repeat(1990)})),{type:'checklist',empty:'Nothing to do yet.',items:[{text:'Task',detail:'d'.repeat(1900),state:'todo'}]}]})!;
 assert.equal(last.blocks.length,49,'the checklist is out whole');
 // A screen in parts, a checklist to each, the limit falling anywhere in the last: at no length is one kept without its tasks.
 for(let size=1500;size<=2000;size+=7){
  const parts=cleanScreen({id:'a',blocks:Array.from({length:30},(_,n)=>({type:'group',title:`Milestone ${n}`,blocks:[{type:'checklist',empty:'No tasks.',items:Array.from({length:3},(_,i)=>({text:`Task ${i}`,detail:'d'.repeat(size),state:'done'}))}]}))})!;
  assert.ok(parts.blocks.length>0&&parts.blocks.length<30,`cut before the end at ${size}`);
  assert.deepEqual(empties(parts.blocks),[],`nothing kept empty at ${size}`);
 }
 // What was given empty stays empty, and is no reason to leave the object out.
 assert.deepEqual(cleanScreen({id:'a',blocks:[{type:'checklist',empty:'Nothing yet.',items:[]},{type:'group',title:'Part',blocks:[]}]})!.blocks,[{type:'checklist',empty:'Nothing yet.',items:[]},{type:'group',title:'Part',blocks:[]}]);
});
test('the depth limit never leaves a list with no items for tasks it was given, and counts a group and an item as one level each',()=>{
 const empties=(node:any):any[]=>Array.isArray(node)?node.flatMap(empties):node&&typeof node==='object'?[...((Array.isArray(node.items)&&node.items.length===0)||(Array.isArray(node.blocks)&&node.blocks.length===0)?[node]:[]),...Object.values(node).flatMap(empties)]:[];
 const tasks=()=>[{text:'Write',state:'done',detail:'the docs'},{text:'Ship',state:'todo'}];
 const inGroups=(n:number)=>{let b:any={type:'checklist',empty:'No tasks.',items:tasks()};for(let i=0;i<n;i++)b={type:'group',title:`Part ${i}`,blocks:[b]};return b;};
 for(let n=0;n<=10;n++){
  const out=cleanScreen({id:'a',blocks:[inGroups(n)]})!.blocks;
  assert.deepEqual(empties(out),[],`no empty list in ${n} groups`);
  // The groups and the checklist are n+1 levels, and its tasks one more: whole up to there, and not there after it.
  assert.equal(out.length,n<=5?1:0,`${n} groups`);
 }
 assert.deepEqual(cleanScreen({id:'a',blocks:[inGroups(3)]})!.blocks,[inGroups(3)],'three groups round a checklist are kept as said');
 // A board by project, milestone and owner, a checklist and a list to each owner.
 const board={type:'group',title:'Project',blocks:[{type:'group',title:'Milestone',blocks:[{type:'group',title:'Owner',blocks:[
  {type:'checklist',empty:'No tasks.',items:tasks()},
  {type:'list',items:['a string note',{text:'an object note'}]},
 ]}]}]};
 assert.deepEqual(cleanScreen({id:'a',blocks:[board]})!.blocks,[board]);
 // Sub-tasks: as deep as the limit allows in a group, and no list left empty past it.
 const sub=(depth:number):any=>({text:`T${depth}`,state:'done',...(depth>0?{items:[sub(depth-1)]}:{})});
 assert.deepEqual(cleanScreen({id:'a',blocks:[{type:'group',blocks:[{type:'checklist',items:[sub(4)]}]}]})!.blocks[0].blocks[0].items,[sub(4)],'five levels of tasks in a group');
 for(let depth=5;depth<12;depth++) assert.deepEqual(empties(cleanScreen({id:'a',blocks:[{type:'group',blocks:[{type:'checklist',items:[sub(depth),{text:'Other',state:'done'}]}]}]})!.blocks),[],`${depth} deep`);
});
test('a list of nothing that was data is as good as an empty one: only a list that lost data to a limit goes',()=>{
 const sprint={type:'checklist',empty:'Nothing to do yet.',items:[{text:'Ship it',state:'doing',items:[undefined]},{text:'Write the docs',state:'done',items:[]}]};
 const out=(blocks:any[])=>cleanScreen({id:'a',blocks})!.blocks;
 // A glue that says undefined for the sub-task it cannot read still has the task.
 assert.deepEqual(out([sprint]),[{...sprint,items:[{text:'Ship it',state:'doing',items:[]},{text:'Write the docs',state:'done',items:[]}]}]);
 assert.deepEqual(out([{type:'group',title:'Sprint 3',blocks:[{type:'checklist',items:[{text:'Ship it',state:'doing',items:[undefined]}]}]}]),
  [{type:'group',title:'Sprint 3',blocks:[{type:'checklist',items:[{text:'Ship it',state:'doing',items:[]}]}]}]);
 // A list of nothing is kept, so that its block says what it was given to say.
 for(const items of [[undefined,undefined],[null,undefined],[()=>1,NaN,Symbol('s'),1n]]) assert.deepEqual(out([{type:'checklist',empty:'Nothing to do yet.',items}]),[{type:'checklist',empty:'Nothing to do yet.',items:[]}]);
 assert.deepEqual(out([{type:'text',text:'Build green',actions:[()=>1]}]),[{type:'text',text:'Build green',actions:[]}]);
 // Where data was lost it is as before: a list that held a task the limit took goes, with its block.
 const long=Array.from({length:49},()=>({type:'text',text:'a'.repeat(1990)}));
 assert.equal(out([...long,{type:'checklist',empty:'x',items:[null,{text:'Task',detail:'d'.repeat(1900),state:'todo'}]}]).length,49,'a list that lost its task to the limit is out, with the null before it no reason to keep it');
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
