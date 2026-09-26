import test from 'node:test';
import assert from 'node:assert/strict';
import { keyboardInset } from '../web/src/keyboard.ts';

test('the keyboard covers what the visual viewport leaves at the bottom of the page', () => {
  assert.equal(keyboardInset(780, { height: 780, offsetTop: 0, scale: 1 }), 0);
  assert.equal(keyboardInset(780, { height: 460, offsetTop: 0, scale: 1 }), 320);
  // Pushed up by 100 to show the box: that much of the page is above, not under the keyboard.
  assert.equal(keyboardInset(780, { height: 460, offsetTop: 100, scale: 1 }), 220);
  // Chrome with resizes-content: the page itself got shorter, nothing is covered.
  assert.equal(keyboardInset(460, { height: 460, offsetTop: 0, scale: 1 }), 0);
  // Zoomed in, not a keyboard.
  assert.equal(keyboardInset(780, { height: 390, offsetTop: 120, scale: 2 }), 0);
});
