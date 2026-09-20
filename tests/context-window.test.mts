import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWindow } from '../web/src/context-window.ts';

test('a typed window is read the way it is written, grouping and all', () => {
  assert.deepEqual(parseWindow('131072'), { kind: 'ok', tokens: 131072 });
  assert.deepEqual(parseWindow(' 131,072 '), { kind: 'ok', tokens: 131072 });
  assert.deepEqual(parseWindow('131_072'), { kind: 'ok', tokens: 131072 });
  assert.deepEqual(parseWindow('1 024'), { kind: 'ok', tokens: 1024 });
});

test('nothing typed is not an error, so an emptied field can go back to what it showed', () => {
  assert.deepEqual(parseWindow(''), { kind: 'empty' });
  assert.deepEqual(parseWindow('  '), { kind: 'empty' });
});

test('what the server would refuse is refused here, with the range in the message', () => {
  for (const bad of ['abc', '12.5', '1023', '0', '-5', '10000001', '99999999999']) {
    const r = parseWindow(bad);
    assert.equal(r.kind, 'bad', bad);
    assert.match((r as { message: string }).message, /1,024 to 10,000,000/);
  }
  assert.deepEqual(parseWindow('10000000'), { kind: 'ok', tokens: 10_000_000 });
});
