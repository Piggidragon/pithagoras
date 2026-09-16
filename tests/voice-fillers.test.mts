import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trimSilence } from '../web/src/voice-fillers.js';

test('murmurs lose TTS padding but keep a short natural onset and tail', () => {
  const samples = new Float32Array(1000); samples.fill(0.5, 400, 600);
  const trimmed = trimSilence(samples, 1000, 0.01, 50);
  assert.equal(trimmed.length, 300);
  assert.equal(trimmed[50], 0.5); assert.equal(trimmed[0], 0);
  assert.equal(trimSilence(new Float32Array(100), 1000).length, 0);
});
