import {test,expect} from '@playwright/test';
test('settings install progress, ready connection, and stop',async({page})=>{
 let state='absent'; const actions:string[]=[];
 const config={enabled:false,whisperUrl:'http://127.0.0.1:8178/inference',breezeUrl:'http://127.0.0.1:7860/v1/audio/speech',instruction:'Clear speech',voice:'design',runtime:'breeze',language:'auto',cfgScale:4};
 await page.route('**/api/voice/presets',r=>r.fulfill({json:[]}));
 await page.route('**/api/voice',r=>r.fulfill({json:{...config,enabled:state==='running'}}));
 await page.route('**/api/voice/install',async r=>{
  if(r.request().method()==='POST'){actions.push('install');state='starting';return r.fulfill({json:{ok:true}});}
  return r.fulfill({json:{available:true,state,busy:false,progress:state==='starting'?'Quantizing Breeze to Q8_0 on CPU':'',error:''}});
 });
 await page.route('**/api/voice/stop',r=>{actions.push('stop');state='stopped';return r.fulfill({json:{ok:true}});});
 await page.goto('/tests/voice-addon.html');
 await expect(page.getByLabel('Speech recognition URL')).toBeHidden();
 await page.locator('summary').filter({hasText:'Voice service'}).click();
 await page.getByRole('button',{name:'Install voice',exact:true}).click();
 await expect(page.getByLabel('Voice setup log')).toContainText('Quantizing');
 await expect(page.getByRole('button',{name:'Start voice',exact:true})).toBeDisabled();
 state='running';
 await expect(page.getByRole('checkbox',{name:'Enable voice controls in sessions'})).toBeChecked({timeout:8000});
 await page.getByRole('button',{name:'Stop · release VRAM'}).click();
 await expect(page.getByRole('button',{name:'Start voice',exact:true})).toBeEnabled();
 expect(actions).toEqual(['install','stop']);
 await page.screenshot({path:'/tmp/pithagoras-voice-addon.png'});
});

test('speech detection settings save and restore defaults',async({page})=>{
 let config:any={enabled:true,whisperUrl:'http://localhost:8188/inference',breezeUrl:'http://localhost:7862/v1/audio/speech',instruction:'Clear speech',voice:'aria',runtime:'audio-cpp'};
 await page.route('**/api/voice/presets',r=>r.fulfill({json:[]}));
 await page.route('**/api/voice/install',r=>r.fulfill({json:{available:true,state:'running',busy:false}}));
 await page.route('**/api/voice',async r=>{if(r.request().method()==='PUT')config=r.request().postDataJSON();await r.fulfill({json:config});});
 await page.goto('/tests/voice-addon.html');
 await page.locator('summary').filter({hasText:'Speech detection'}).click();
 const silence=page.getByRole('slider',{name:/End-of-turn silence/});
 await expect(silence).toHaveValue('1000');await silence.fill('500');
 await page.getByRole('button',{name:'Save voice settings'}).click();
 await expect.poll(()=>config.vad?.redemptionMs).toBe(500);
 await page.reload();await page.locator('summary').filter({hasText:'Speech detection'}).click();
 await expect(silence).toHaveValue('500');
 await page.getByRole('button',{name:'Reset speech detection'}).click();
 await expect(silence).toHaveValue('1000');
 await page.screenshot({path:'/tmp/pithagoras-vad-settings.png'});
});

test('speaking instructions show the built-in text, save an edit and reset to the built-in text',async({page})=>{
 const builtIn='Built-in speaking instructions for this test.';
 let config:any={enabled:true,whisperUrl:'http://localhost:8188/inference',breezeUrl:'http://localhost:7862/v1/audio/speech',instruction:'Clear speech',voice:'aria',runtime:'audio-cpp'};
 const puts:any[]=[];
 await page.route('**/api/voice/presets',r=>r.fulfill({json:[]}));
 await page.route('**/api/voice/install',r=>r.fulfill({json:{available:true,state:'running',busy:false}}));
 // As the server answers: the text in use and the built-in one, and the built-in text saved as nothing.
 const shown=()=>({...config,responseInstructions:config.responseInstructions||builtIn,defaultResponseInstructions:builtIn,responseInstructionsOff:false});
 await page.route('**/api/voice',async r=>{
  if(r.request().method()==='PUT'){const body=r.request().postDataJSON();puts.push(body);config={...body,responseInstructions:body.responseInstructions.trim()===builtIn?'':body.responseInstructions.trim()};}
  return r.fulfill({json:shown()});
 });
 await page.goto('/tests/voice-addon.html');
 await expect(page.getByText('This portal is set to send no speaking instructions')).toBeHidden();
 await page.locator('summary').filter({hasText:'Speaking instructions'}).click();
 const text=page.getByRole('textbox',{name:'Speaking instructions'});
 const reset=page.getByRole('button',{name:'Reset to default'});
 await expect(text).toHaveValue(builtIn);
 await expect(reset).toBeDisabled();
 await text.fill('Answer in one word.');
 await expect(reset).toBeEnabled();
 const save=page.getByRole('button',{name:'Save voice settings'}),saved=page.getByRole('button',{name:'Saved',exact:true});
 await save.click();
 await expect(saved).toBeVisible();
 expect(puts.at(-1).responseInstructions).toBe('Answer in one word.');
 // Saved as it is, and the built-in text still there to reset to.
 await expect(text).toHaveValue('Answer in one word.');
 await reset.click();
 await expect(text).toHaveValue(builtIn);
 await expect(reset).toBeDisabled();
 await save.click();
 await expect(saved).toBeVisible();
 expect(puts).toHaveLength(2);
 expect(config.responseInstructions).toBe('');
 // Emptied to write a new text, it stays empty while being written, and is the built-in text once saved.
 await text.fill('');
 await expect(text).toHaveValue('');
 await save.click();
 await expect(saved).toBeVisible();
 await expect(text).toHaveValue(builtIn);
 await page.reload();
 await page.locator('summary').filter({hasText:'Speaking instructions'}).click();
 await expect(text).toBeVisible();
 await expect(text).toHaveValue(builtIn);
 await reset.scrollIntoViewIfNeeded();
 await page.screenshot({path:'/tmp/pithagoras-speaking-instructions.png'});
});

test('speaking instructions say when the portal is set to send none',async({page})=>{
 await page.route('**/api/voice/presets',r=>r.fulfill({json:[]}));
 await page.route('**/api/voice/install',r=>r.fulfill({json:{available:true,state:'running',busy:false}}));
 await page.route('**/api/voice',r=>r.fulfill({json:{enabled:true,whisperUrl:'http://localhost:8188/inference',breezeUrl:'http://localhost:7862/v1/audio/speech',instruction:'Clear speech',voice:'aria',runtime:'audio-cpp',responseInstructions:'Kept text.',defaultResponseInstructions:'Built-in.',responseInstructionsOff:true}}));
 await page.goto('/tests/voice-addon.html');
 await page.locator('summary').filter({hasText:'Speaking instructions'}).click();
 await expect(page.getByRole('status').filter({hasText:'VOICE_RESPONSE_INSTRUCTIONS=false'})).toBeVisible();
 await expect(page.getByRole('textbox',{name:'Speaking instructions'})).toHaveValue('Kept text.');
});
