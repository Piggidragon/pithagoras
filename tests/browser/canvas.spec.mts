import { test,expect } from '@playwright/test';
test('canvas streams on the stage, retains a partial draft and supports inline edits and deletion',async({page})=>{
 const failures:string[]=[];page.on('pageerror',e=>failures.push(e.message));
 await page.route('**/api/browser',r=>r.fulfill({json:{running:false,install:{container:'stopped'},sessions:[]}}));
 let deleted=false;
 await page.route('**/api/sessions/test/canvases',r=>r.fulfill({json:deleted?[]:[row]}));
 await page.route('**/api/voice',r=>r.fulfill({json:{enabled:false}}));
 await page.route('**/api/sessions/test/commands',r=>r.fulfill({json:{commands:[]}}));
 await page.route('**/api/sessions/test/config',r=>r.fulfill({status:503,json:{}}));
 await page.addInitScript(()=>{
   class FakeEvents {onmessage:any;onopen:any;onerror:any;constructor(){(window as any).canvasStream=this;setTimeout(()=>{this.onopen?.();this.onmessage?.({data:JSON.stringify({type:'snapshot',canvases:[]})});(window as any).canvasStreamReady=true},100)}close(){}}
   (window as any).EventSource=FakeEvents;
 });
 let row={id:'canvas-1',title:'A live document',content:'',revision:0,status:'writing',active_call:'call-1',updated_at:'',persisted:false};
 await page.route('**/api/sessions/test/canvases/canvas-1',async route=>{
   if(route.request().method()==='DELETE'){deleted=true;return route.fulfill({json:{ok:true}});}
   const body=route.request().postDataJSON();expect(body.revision).toBe(row.revision);row={...row,...body,revision:row.revision+1,status:'edited',active_call:null as any};return route.fulfill({json:row});
 });
 await page.route('**/api/sessions/test/canvases/canvas-1/persist',r=>{row={...row,persisted:true};return r.fulfill({json:row});});
 await page.goto('/tests/voice.html');
 await expect(page.getByLabel('Session canvases')).toBeVisible();
 await page.waitForFunction(()=>(window as any).canvasStreamReady);
 const emit=async()=>page.evaluate(row=>(window as any).canvasStream.onmessage({data:JSON.stringify({type:'update',canvas:row})}),row);
 // Creation should open the panel before the first write.
 await page.evaluate(row=>(window as any).canvasStream.onmessage({data:JSON.stringify({type:'create',canvas:{...row,status:'saved',active_call:null}})}),row);
 await expect(page.getByLabel('Session canvas workspace')).toBeVisible();
 await page.getByLabel('Close canvas',{exact:true}).click();
 row.content='# A live document\n\nThe first sentence.';row.revision=1;await emit();
 await expect(page.getByLabel('Session canvas workspace')).toBeVisible();
 await expect(page.locator('.canvas-document')).toContainText('The first sentence.');
 await expect(page.getByRole('button',{name:'Edit inline'})).toBeDisabled();
 row.content+=' Another sentence appears.';row.revision=2;await emit();
 await expect(page.locator('.canvas-document')).toContainText('Another sentence appears.');
 row.status='interrupted';row.active_call=null as any;await emit();
 await expect(page.getByText('Partial draft retained',{exact:false})).toBeVisible();
 await page.getByRole('button',{name:'Edit inline'}).click();
 await page.getByLabel('Edit canvas content').fill('My own edited document.');
 await page.getByLabel('Canvas title').fill('Human revision');
 await page.getByRole('button',{name:'Apply changes'}).click();
 await expect(page.locator('.canvas-document')).toContainText('My own edited document.');
 await expect(page.getByText('Edited by you',{exact:false})).toBeVisible();
 const downloadEvent=page.waitForEvent('download');await page.getByLabel('Download canvas',{exact:true}).click();expect((await downloadEvent).suggestedFilename()).toBe('Human revision.md');
 await page.getByLabel('Store canvas',{exact:true}).click();await expect(page.getByLabel('Canvas stored',{exact:true})).toBeDisabled();
 await page.getByTestId('workspace').screenshot({path:'/tmp/pithagoras-canvas.png'});
 await page.setViewportSize({width:390,height:844});
 await page.getByTestId('workspace').screenshot({path:'/tmp/pithagoras-canvas-mobile.png'});
 const box=await page.getByLabel('Session canvas workspace').boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(390);
 await page.getByLabel('Delete canvas').click();await page.getByRole('button',{name:'Delete',exact:true}).click();
 await expect(page.getByText('A place for your documents')).toBeVisible();
 await page.evaluate(()=>(window as any).canvasStream.onmessage({data:JSON.stringify({type:'focus',canvas:{id:'read-doc',title:'Document being read',content:'The AI is reading this document.',revision:1,status:'saved',active_call:null}})}));
 await expect(page.getByLabel('Select canvas')).toHaveValue('read-doc');
 await expect(page.locator('.canvas-document')).toContainText('The AI is reading this document.');expect(failures).toEqual([]);
});

test('saved canvas list loads even when its live stream is disconnected',async({page})=>{
 await page.route('**/api/browser',r=>r.fulfill({json:{running:false,install:{container:'stopped'},sessions:[]}}));
 await page.route('**/api/voice',r=>r.fulfill({json:{enabled:false}}));
 await page.route('**/api/sessions/test/commands',r=>r.fulfill({json:{commands:[]}}));
 await page.route('**/api/sessions/test/config',r=>r.fulfill({status:503,json:{}}));
 await page.route('**/api/sessions/test/canvases',r=>r.fulfill({json:[{id:'saved',title:'Saved document',content:'Persisted words',revision:1,status:'saved',active_call:null}]}));
 await page.addInitScript(()=>{(window as any).EventSource=class{close(){}};});
 await page.goto('/tests/voice.html');
 await page.getByLabel('Session canvases',{exact:true}).click();
 await expect(page.getByLabel('Select canvas')).toHaveValue('saved');
 await expect(page.locator('.canvas-document')).toContainText('Persisted words');
 await expect(page.getByText('Reconnecting to live canvas…')).toBeVisible();
});
