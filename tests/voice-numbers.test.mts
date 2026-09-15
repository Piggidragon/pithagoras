import test from 'node:test';
import assert from 'node:assert/strict';
import { spokenNumbers, hasNumberPack } from '../server/src/voice-numbers.js';

test('numbers are written out per language, identifiers are left alone', () => {
  assert.equal(spokenNumbers('Die RTX 4070 hat 12 GB.', 'de'), 'Die RTX viertausendsiebzig hat zwölf GB.');
  assert.equal(spokenNumbers('Etwa 3,5 Sekunden und 21 Prozent.', 'de'), 'Etwa drei Komma fünf Sekunden und einundzwanzig Prozent.');
  assert.equal(spokenNumbers('The RTX 4070 has 12 GB.', 'en'), 'The RTX four thousand seventy has twelve GB.');
  assert.equal(spokenNumbers('Around 3.5 seconds and 21%.', 'en'), 'Around three point five seconds and twenty-one percent.');
  // Glued to letters, so an identifier rather than a quantity.
  assert.equal(spokenNumbers('Quantised to Q8_0 in v2.', 'en'), 'Quantised to Q8_0 in v2.');
  // Beyond the packs' range the digits stay readable as they are.
  assert.equal(spokenNumbers('Es sind 1234567 Tokens.', 'de'), 'Es sind 1234567 Tokens.');
});

test('a language without a pack keeps its text unchanged', () => {
  assert.equal(hasNumberPack('de'), true);
  assert.equal(hasNumberPack('sw'), false);
  assert.equal(spokenNumbers('Tokeni 4070 hapa.', 'sw'), 'Tokeni 4070 hapa.');
  assert.equal(spokenNumbers('Tokens 4070 here.', 'auto'), 'Tokens 4070 here.');
});
