import {test,expect} from '@playwright/test';
import path from 'node:path';
test('upload a voice reference, select it, save settings, and delete it',async({page})=>{
 let config={enabled:true,voice:'design',whisperUrl:'http://localhost/a',breezeUrl:'http://localhost/b',instruction:'Clear',cfgScale:4};
 let voices:any[]=[];
 await page.route('**/api/voice/install',r=>r.fulfill({json:{available:true,state:'absent',busy:false,progress:'',error:''}}));
 await page.route('**/api/voice',r=>{if(r.request().method()==='PUT')config=r.request().postDataJSON();return r.fulfill({json:config});});
 await page.route('**/api/voice/presets',r=>{
  if(r.request().method()==='POST'){
   const body=r.request().postDataJSON();const audio=Buffer.from(body.audio,'base64');expect(audio.toString('ascii',0,4)).toBe('RIFF');expect(audio.readUInt32LE(24)).toBe(16000);expect(audio.readUInt16LE(22)).toBe(1);
   const row={...body,id:'voice-test'};delete row.audio;voices=[row];return r.fulfill({json:row});
  }return r.fulfill({json:voices});
 });
 await page.route('**/api/voice/presets/voice-test',r=>{voices=[];config.voice='design';return r.fulfill({json:{ok:true}});});
 await page.goto('/tests/voice-addon.html');
 await page.getByRole('button',{name:'Add voice',exact:true}).click();
 await page.getByLabel('Voice name',{exact:true}).fill('New narrator');
 await page.getByLabel('Reference recording').setInputFiles(path.resolve('tests/fixtures/jfk.wav'));
 await page.getByLabel('Exact words in the recording').fill('And so my fellow Americans, ask not what your country can do for you, ask what you can do for your country.');
 await page.getByRole('button',{name:'Save new voice',exact:true}).click();
 await expect(page.getByRole('combobox',{name:'Speaking voice',exact:true})).toHaveValue('voice-test');
 await expect(page.getByLabel('Voice reference preview')).toBeVisible();
 await page.getByRole('button',{name:'Save voice settings',exact:true}).click();
 expect(config.voice).toBe('voice-test');
 await page.screenshot({path:'/tmp/pithagoras-voice-library.png',fullPage:true});
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Delete voice',exact:true}).click();
 await expect(page.getByRole('combobox',{name:'Speaking voice',exact:true})).toHaveValue('design');
 await expect(page.locator('#error')).toBeEmpty();
});
