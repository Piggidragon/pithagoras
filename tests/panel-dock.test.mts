import test from 'node:test';
import assert from 'node:assert/strict';
import { across, dockedFrame, dropTarget, fitFrame, isDock, readFrame } from '../web/src/panel-dock.ts';

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
  // Not at the top any more: stored there before, they go back to the right.
  assert.equal(isDock('top'), false);
  assert.equal(isDock(null), false);
  assert.deepEqual(readFrame('{"x":1,"y":2,"w":330,"h":240}'), { x: 1, y: 2, w: 330, h: 240 });
  for (const raw of [null, '', 'nope', '{"x":1}', '{"x":"1","y":2,"w":3,"h":4}', '{"x":null,"y":2,"w":3,"h":4}']) assert.equal(readFrame(raw), null);
  assert.deepEqual(['right', 'left', 'bottom', 'float'].map((d) => across(d as never)), [false, false, true, false]);
});

test('panels let go near an edge dock there; anywhere else, and at the top, they float', () => {
  const area = { w: 1200, h: 700 };
  assert.equal(dropTarget({ x: 30, y: 350 }, area), 'left');
  assert.equal(dropTarget({ x: 1170, y: 350 }, area), 'right');
  assert.equal(dropTarget({ x: 600, y: 680 }, area), 'bottom');
  assert.equal(dropTarget({ x: 600, y: 350 }, area), 'float');
  assert.equal(dropTarget({ x: 600, y: 5 }, area), 'float');
  // A corner: the side, not the bottom.
  assert.equal(dropTarget({ x: 10, y: 690 }, area), 'left');
  // A narrow chat keeps its middle for floating.
  assert.equal(dropTarget({ x: 90, y: 200 }, { w: 400, h: 700 }), 'float');
});

test('where docked panels would go is shown as the frame they take', () => {
  const area = { w: 1200, h: 700 }, size = { width: 560, height: 320 };
  assert.deepEqual(dockedFrame('left', area, size), { x: 0, y: 0, w: 560, h: 700 });
  assert.deepEqual(dockedFrame('right', area, size), { x: 640, y: 0, w: 560, h: 700 });
  assert.deepEqual(dockedFrame('bottom', area, size), { x: 0, y: 380, w: 1200, h: 320 });
  assert.deepEqual(dockedFrame('right', { w: 400, h: 300 }, size), { x: 0, y: 0, w: 400, h: 300 });
});
