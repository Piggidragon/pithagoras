import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceFirstTurn, AUDIO_SYSTEM_RULE, audioSystemRules, audioMessage } from '../server/src/pi/voice-first.js';
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
});
test('voice mode never injects or mutates messages', () => {
 const { turn, payload, request, handlers } = setup(); turn.arm();
 const result = request();
 assert.equal(result.messages, payload.messages);
 assert.equal(result.messages.length, 2);
 const start = handlers.get('before_agent_start')!({ prompt: audioMessage('Hi'), systemPrompt: 'Base' }, { sessionManager: { getBranch: () => [] } });
 assert.deepEqual(Object.keys(start), ['systemPrompt'], 'the rule only, and no message');
 assert.deepEqual(request(), result);
});
test('the rule is added once a conversation has had voice, and kept', () => {
 const { handlers } = setup();
 let branch: any[] = [{ type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'Typed' }] } }];
 const start = (prompt: string) => handlers.get('before_agent_start')!({ prompt, systemPrompt: 'Base' }, { sessionManager: { getBranch: () => branch } });
 assert.equal(start('Typed'), undefined);
 assert.deepEqual(start(audioMessage('Spoken')), { systemPrompt: `Base\n\n${AUDIO_SYSTEM_RULE}` });
 branch = [];
 assert.deepEqual(start('Typed again'), { systemPrompt: `Base\n\n${AUDIO_SYSTEM_RULE}` });
 // Reopened: known from what the conversation holds, a picture's message too.
 const reopened = setup().handlers;
 branch = [{ type: 'message', message: { role: 'user', content: [{ type: 'text', text: audioMessage('Look') }, { type: 'image', data: '', mimeType: 'image/png' }] } }];
 assert.deepEqual(reopened.get('before_agent_start')!({ prompt: 'Typed', systemPrompt: 'Base' }, { sessionManager: { getBranch: () => branch } }), { systemPrompt: `Base\n\n${AUDIO_SYSTEM_RULE}` });
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
  assert.deepEqual(audioSystemRules(), []);
  assert.equal(audioMessage('Write a detailed report'), 'Write a detailed report');
  delete process.env.VOICE_RESPONSE_INSTRUCTIONS;
  assert.deepEqual(audioSystemRules(), [AUDIO_SYSTEM_RULE]);
  assert.equal(audioMessage('Hello'), '[Audio mode]\nHello');
 } finally {
  if(previous === undefined)delete process.env.VOICE_RESPONSE_INSTRUCTIONS;
  else process.env.VOICE_RESPONSE_INSTRUCTIONS=previous;
 }
});
