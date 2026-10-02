import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BLOCK_TYPES,CHECK_STATES,TONES,isBlockType,itemsOf,screensOf,stateOf,toneOf,withScreen} from '../web/src/screens.ts';
import {cleanScreen} from '../server/src/screens.ts';
import {markOf,withLiveUi} from '../web/src/use-background.ts';
import {appendLiveEvent} from '../web/src/live-events.ts';
const empty={supported:true,jobs:[],statuses:[],widgets:[],screens:[]};
const live=(n:number,payload:any)=>({seq:-n,type:'portal_screen',at:0,payload:{type:'portal_screen',...payload}});
test('a screen said whole replaces the one of its id where it was, and one cleared is gone',()=>{
 let screens=withScreen([],{op:'set',id:'todo',title:'Todos',blocks:[{type:'text',text:'a'}]});
 screens=withScreen(screens,{op:'set',id:'build',blocks:[]});
 screens=withScreen(screens,{op:'set',id:'todo',blocks:[{type:'text',text:'b'}]});
 assert.deepEqual(screens,[{id:'todo',blocks:[{type:'text',text:'b'}]},{id:'build',blocks:[]}]);
 assert.deepEqual(withScreen(screens,{op:'clear',id:'todo'}),[{id:'build',blocks:[]}]);
 // What is not a screen's event changes nothing.
 assert.equal(withScreen(screens,{op:'set',id:'x'}),screens);
 assert.equal(withScreen(screens,{op:'set',blocks:[]}),screens);
 assert.equal(withScreen(screens,{op:'rename',id:'todo',blocks:[]}),screens);
});
test('the portal\'s answer is only what is a screen: an older server, or a proxy in its place, sends something else',()=>{
 assert.deepEqual(screensOf(undefined),[]);
 assert.deepEqual(screensOf('<html>'),[]);
 assert.deepEqual(screensOf([{id:'a',blocks:[]},{id:3,blocks:[]},{id:'b'},null]),[{id:'a',blocks:[]}]);
});
test('what extensions show comes with their events after the portal answered, like their status lines',()=>{
 const asked=markOf([]);
 const events=[live(1,{op:'set',id:'todo',blocks:[{type:'text',text:'a'}]}),{seq:-2,type:'extension_ui_request',at:0,payload:{method:'setStatus',statusKey:'k',statusText:'busy'}},live(3,{op:'set',id:'build',blocks:[]})];
 const shown=withLiveUi(empty,events,asked);
 assert.deepEqual(shown.screens.map(s=>s.id),['todo','build']);
 assert.deepEqual(shown.statuses,[{key:'k',text:'busy'}]);
 // Said before the portal answered, they are in its answer already.
 const later=withLiveUi({...empty,screens:[{id:'todo',blocks:[]}]},events,markOf(events.slice(0,1)));
 assert.deepEqual(later.screens.map(s=>s.id),['todo','build']);
 assert.deepEqual(later.screens[0].blocks,[],'what the answer had is not said over again by an older event');
 assert.deepEqual(withLiveUi(empty,[...events,live(4,{op:'clear',id:'todo'})],asked).screens.map(s=>s.id),['build']);
});
test('the page keeps the last of what a screen said, since each says all of it',()=>{
 let list=appendLiveEvent([],live(1,{op:'set',id:'todo',blocks:[{type:'text',text:'a'}]}) as any);
 list=appendLiveEvent(list,live(2,{op:'set',id:'build',blocks:[]}) as any);
 list=appendLiveEvent(list,live(3,{op:'set',id:'todo',blocks:[{type:'text',text:'b'}]}) as any);
 assert.deepEqual(list.map(e=>[e.payload.id,e.seq]),[['build',-2],['todo',-3]]);
 // Stored events are never taken for them.
 list=appendLiveEvent([{seq:7,type:'portal_screen',at:0,payload:{id:'todo'}}],live(1,{op:'set',id:'todo',blocks:[]}) as any);
 assert.equal(list.length,2);
});
test('items are read as far as they make sense: strings and objects with words, the rest left out',()=>{
 assert.deepEqual(itemsOf(undefined),[]);
 assert.deepEqual(itemsOf(['a',{text:'b',detail:'d',tone:'warn',state:'doing',items:['c']},{nothing:1},null,7,{text:'e',tone:'loud',state:'lost'}]),[
  {text:'a',detail:undefined,tone:undefined,state:'todo',items:[]},
  {text:'b',detail:'d',tone:'warn',state:'doing',items:[{text:'c',detail:undefined,tone:undefined,state:'todo',items:[]}]},
  {text:'7',detail:undefined,tone:undefined,state:'todo',items:[]},
  {text:'e',detail:undefined,tone:undefined,state:'todo',items:[]},
 ]);
 assert.equal(toneOf('ok'),'ok');assert.equal(toneOf('loud'),undefined);
 assert.equal(stateOf('blocked'),'blocked');assert.equal(stateOf(undefined),'todo');
 assert.ok(BLOCK_TYPES.includes('checklist'));
});
test('the blocks reference the agent reads says what the page draws, and its examples are blocks',()=>{
 const reference=readFileSync(new URL('../skills/extension-screens/reference/blocks.md',import.meta.url),'utf8');
 const sections=[...reference.matchAll(/^## `(\w+)`$/gm)].map(m=>m[1]);
 assert.deepEqual(sections,[...BLOCK_TYPES],'a section for each block, in the order the page lists them');
 assert.ok(reference.includes(`Block types: ${BLOCK_TYPES.map(t=>`\`${t}\``).join(', ')}.`));
 for(const word of [...TONES,...CHECK_STATES]) assert.ok(reference.includes(`\`${word}\``),`${word} is explained`);
 const examples=[...reference.matchAll(/```json\n([\s\S]*?)\n```/g)].map(m=>JSON.parse(m[1]));
 assert.equal(examples.length,BLOCK_TYPES.length,'one example each');
 for(const example of examples){
  assert.ok(isBlockType(example.type),`${example.type} is a block`);
  // What the examples show is kept whole by the portal, nothing of it cut.
  assert.deepEqual(cleanScreen({id:'x',blocks:[example]})!.blocks,[example]);
 }
});
