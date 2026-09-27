import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioRule, VoiceFirstTurn, AUDIO_SYSTEM_RULE, voiceRulesOn, audioMessage, spokenIn } from '../server/src/pi/voice-first.js';
function setup() {
 const turn = new VoiceFirstTurn(), handlers = new Map<string, (...args: any[]) => any>();
 turn.extension({ on: (name: string, fn: any) => handlers.set(name, fn) });
 const payload = { messages: [{ role: 'system', content: AUDIO_SYSTEM_RULE }, { role: 'user', content: audioMessage('Latest request') }], thinking_budget_tokens: 1024, chat_template_kwargs: { existing: true } };
 const request = () => handlers.get('before_provider_request')!({ payload }, { model: { provider: 'llama.cpp' } });
 return { turn, handlers, payload, request };
}
test('audio requests carry a persistent marker and a stable conditional system rule', () => {
 assert.equal(audioMessage('Hello'), '[Audio mode]\nHello');
 assert.match(AUDIO_SYSTEM_RULE, /latest user request only/);
 assert.match(AUDIO_SYSTEM_RULE, /typed requests/);
 assert.match(AUDIO_SYSTEM_RULE, /normal chat formatting/);
 assert.match(AUDIO_SYSTEM_RULE, /plain conversational text/);
 assert.match(AUDIO_SYSTEM_RULE, /Before every tool call or group of tool calls/);
 assert.match(AUDIO_SYSTEM_RULE, /including subsequent actions after earlier tool results/);
 // Not to be read as saying the message in hand has the marker: issue #26.
 assert.match(AUDIO_SYSTEM_RULE, /does not mean any request has it/);
});
test('voice mode never injects or mutates messages', () => {
 const { turn, payload, request, handlers } = setup(); turn.arm();
 const result = request();
 assert.equal(result.messages, payload.messages);
 assert.equal(result.messages.length, 2);
 assert.equal(handlers.has('before_agent_start'), false, 'the rule is in pi\'s own prompt: see AudioRule');
 assert.deepEqual(request(), result);
});
test('a conversation is spoken when a user message on its path has the marker', () => {
 const user = (content: unknown) => ({ type: 'message', message: { role: 'user', content } });
 assert.equal(spokenIn([user('Typed'), { type: 'message', message: { role: 'assistant', content: audioMessage('echo') } }]), false);
 assert.equal(spokenIn([user(audioMessage('Hi'))]), true);
 // With a picture, as pi keeps it.
 assert.equal(spokenIn([user([{ type: 'text', text: audioMessage('Look') }, { type: 'image', data: '', mimeType: 'image/png' }])]), true);
 assert.equal(spokenIn([user([{ type: 'text', text: 'Look [Audio mode]' }])]), false);
});
test('a prompt built elsewhere is made to say what the rule says now', () => {
 const rule = new AudioRule();
 assert.equal(rule.into('Base\n\nAppended', 'Appended'), 'Base\n\nAppended', 'off, and not there: as it is');
 rule.set(true);
 assert.equal(rule.into('Base\n\nAppended\n\nPolicy', 'Appended'), `Base\n\nAppended\n\n${AUDIO_SYSTEM_RULE}\n\nPolicy`, 'after what pi appends');
 assert.equal(rule.into('Own prompt', 'Appended'), `Own prompt\n\n${AUDIO_SYSTEM_RULE}`, 'at the end when that is not there');
 const said = `Base\n\nAppended\n\n${AUDIO_SYSTEM_RULE}`;
 assert.equal(rule.into(said, 'Appended'), said, 'there already');
 rule.set(false);
 assert.equal(rule.into(`${said}\n\nPolicy`, 'Appended'), 'Base\n\nAppended\n\nPolicy', 'out again');
});
test('the rule says whether it changed, so the prompt is built again only then', () => {
 const rule = new AudioRule();
 assert.deepEqual(rule.lines(), []);
 assert.equal(rule.set(true), true);
 assert.deepEqual(rule.lines(), [AUDIO_SYSTEM_RULE]);
 assert.equal(rule.set(true), false);
 // Its spoken message edited away.
 assert.equal(rule.set(false), true);
 assert.deepEqual(rule.lines(), []);
});
test('only the first call skips thinking, preserving saved settings', () => {
 const { turn, handlers, payload, request } = setup(); turn.arm();
 assert.equal(request().chat_template_kwargs.enable_thinking, false);
 assert.equal(request().thinking_budget_tokens, undefined);
 assert.equal(payload.thinking_budget_tokens, 1024);
 handlers.get('turn_end')!(); assert.equal(request(), undefined);
 turn.arm(); turn.reset(); assert.equal(request(), undefined);
 turn.arm(false); assert.equal(request(), undefined);
});

test('comparison instance preserves model thinking on the first voice request', () => {
 const previous = process.env.VOICE_SKIP_FIRST_THINKING;
 try {
  process.env.VOICE_SKIP_FIRST_THINKING = 'false';
  const {turn,payload,request} = setup();turn.arm();
  assert.equal(request(), undefined);
  assert.equal(payload.thinking_budget_tokens,1024);
  assert.deepEqual(payload.chat_template_kwargs,{existing:true});
 } finally {
  if(previous === undefined)delete process.env.VOICE_SKIP_FIRST_THINKING;
  else process.env.VOICE_SKIP_FIRST_THINKING=previous;
 }
});

test('unoptimized voice baseline omits voice instructions and the audio marker', () => {
 const previous = process.env.VOICE_RESPONSE_INSTRUCTIONS;
 try {
  process.env.VOICE_RESPONSE_INSTRUCTIONS = 'false';
  assert.equal(voiceRulesOn(), false);
  assert.equal(audioMessage('Write a detailed report'), 'Write a detailed report');
  const rule = new AudioRule();
  assert.equal(rule.set(true), false);
  assert.deepEqual(rule.lines(), []);
  delete process.env.VOICE_RESPONSE_INSTRUCTIONS;
  assert.equal(voiceRulesOn(), true);
  assert.equal(audioMessage('Hello'), '[Audio mode]\nHello');
 } finally {
  if(previous === undefined)delete process.env.VOICE_RESPONSE_INSTRUCTIONS;
  else process.env.VOICE_RESPONSE_INSTRUCTIONS=previous;
 }
});
