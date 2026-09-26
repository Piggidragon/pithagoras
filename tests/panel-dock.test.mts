import test from 'node:test';
import assert from 'node:assert/strict';
import { across, fitFrame, isDock, readFrame } from '../web/src/panel-dock.ts';

test('a floating window placed for the first time goes to the top right, inside the chat', () => {
  assert.deepEqual(fitFrame(null, { w: 1200, h: 700 }), { x: 664, y: 16, w: 520, h: 560 });
  // A short chat: as tall as there is room for, with its margin.
  assert.deepEqual(fitFrame(null, { w: 1200, h: 400 }), { x: 664, y: 16, w: 520, h: 368 });
});

test('a floating window stays wholly inside the chat, however it was moved or the chat resized', () => {
  const area = { w: 1000, h: 600 };
  assert.deepEqual(fitFrame({ x: -300, y: 900, w: 400, h: 300 }, area), { x: 0, y: 300, w: 400, h: 300 });
  assert.deepEqual(fitFrame({ x: 900, y: -20, w: 400, h: 300 }, area), { x: 600, y: 0, w: 400, h: 300 });
  // Larger than the chat: the chat's size.
  assert.deepEqual(fitFrame({ x: 10, y: 10, w: 2000, h: 900 }, area), { x: 0, y: 0, w: 1000, h: 600 });
  // Smaller than of use: the least it may be.
  assert.deepEqual(fitFrame({ x: 10, y: 10, w: 50, h: 40 }, area), { x: 10, y: 10, w: 320, h: 200 });
  // In a chat smaller than that, the chat.
  assert.deepEqual(fitFrame({ x: 10, y: 10, w: 50, h: 40 }, { w: 300, h: 150 }), { x: 0, y: 0, w: 300, h: 150 });
});

test('where the panels go is read back only when it is a place they can go', () => {
  assert.equal(isDock('left'), true);
  assert.equal(isDock('float'), true);
  assert.equal(isDock('middle'), false);
  assert.equal(isDock(null), false);
  assert.deepEqual(readFrame('{"x":1,"y":2,"w":330,"h":240}'), { x: 1, y: 2, w: 330, h: 240 });
  for (const raw of [null, '', 'nope', '{"x":1}', '{"x":"1","y":2,"w":3,"h":4}', '{"x":null,"y":2,"w":3,"h":4}']) assert.equal(readFrame(raw), null);
  assert.deepEqual(['right', 'left', 'top', 'bottom', 'float'].map((d) => across(d as never)), [false, false, true, true, false]);
});
