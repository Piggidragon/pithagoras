import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trimSilence } from '../web/src/voice-fillers.js';
import { PHRASES, fillerPhrases, phraseLanguage } from '../web/src/voice-phrases.js';
import { toolKind } from '../web/src/tool-kind.js';

test('fillers lose TTS padding but keep a short natural onset and tail', () => {
  const samples = new Float32Array(1000); samples.fill(0.5, 400, 600);
  const trimmed = trimSilence(samples, 1000, 0.01, 50);
  assert.equal(trimmed.length, 300);
  assert.equal(trimmed[50], 0.5); assert.equal(trimmed[0], 0);
  assert.equal(trimSilence(new Float32Array(100), 1000).length, 0);
});

test('every phrase language covers every filler and notice', () => {
  for (const [language, table] of Object.entries(PHRASES)) {
    for (const [kind, texts] of fillerPhrases(language)) assert.ok(texts.length && texts.every(text => text.trim() && text.length <= 80), `${language} ${kind}`);
    assert.ok(table.compacting.length && table.compactionWait && table.compactionDone && table.compactionStopped, language);
  }
});

test('filler language: configured first, then the browser, never guessed wording', () => {
  assert.equal(phraseLanguage('fr', ['de-DE']), 'fr');
  assert.equal(phraseLanguage('auto', ['xx', 'de-AT', 'en']), 'de');
  assert.equal(phraseLanguage(undefined, []), 'en');
  assert.deepEqual(fillerPhrases('ta').map(([kind]) => kind), ['murmur']);
});

test('tool calls are grouped by what a listener hears about', () => {
  assert.equal(toolKind({ toolName: 'bash' }), 'command');
  assert.equal(toolKind({ toolName: 'mcp', input: { tool: 'browser_click' } }), 'browser');
  assert.equal(toolKind({ toolName: 'read' }), 'read');
  assert.equal(toolKind({ toolName: 'edit' }), 'edit');
  assert.equal(toolKind({ toolName: 'todo' }), 'tool');
});
