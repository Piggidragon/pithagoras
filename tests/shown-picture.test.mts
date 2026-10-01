import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTranscript, shownPicture } from '../web/src/transcript.ts';
import { describeCall } from '../web/src/tool-activity.ts';

// What generate_image answers with: the same details show_image's answer has, so one path draws both.
const generated = { path: 'generated-images/image-20261001-101500-a1b2c3.png', title: 'A lighthouse at dusk' };
const start = (toolName: string, input: any, toolCallId = 'c1') => ({ seq: 1, type: 'tool_execution_start', payload: { toolName, toolCallId, input } });
const end = (toolName: string, details: any, extra: any = {}, toolCallId = 'c1') => ({ seq: 2, type: 'tool_execution_end', payload: { toolName, toolCallId, result: { content: [{ type: 'text', text: 'Generated and shown to the user' }], details }, ...extra } });

test('a generated picture is a shown picture, as one named with show_image is', () => {
  assert.deepEqual(shownPicture(end('generate_image', generated).payload), generated);
  assert.deepEqual(shownPicture(end('show_image', { path: 'a.png' }).payload), { path: 'a.png' });
  assert.equal(shownPicture(end('generate_image', generated, { isError: true }).payload), undefined, 'a failed call shows nothing');
  assert.equal(shownPicture(end('generate_image', undefined).payload), undefined, 'nor one with no path');
  assert.equal(shownPicture(end('some_other_tool', generated).payload), undefined, 'another tool is not taken for one');
});

test('the chat puts a generated picture under the tool line that made it', () => {
  const items = buildTranscript([start('generate_image', { prompt: 'a lighthouse at dusk' }), end('generate_image', generated)]);
  const tool = items.find((i) => i.kind === 'tool') as any;
  assert.equal(tool.name, 'generate_image');
  assert.deepEqual(tool.picture, generated);
});

test('the tool line says a picture is being made, and tapping it opens the pictures', () => {
  assert.deepEqual(describeCall(start('generate_image', { prompt: 'a lighthouse\nat dusk' }).payload, '/work'), { label: 'Making a picture', detail: 'a lighthouse at dusk', target: 'pictures' });
  assert.equal(describeCall(start('generate_image', { prompt: 'x', title: 'Lighthouse' }).payload, '/work').detail, 'Lighthouse');
});
