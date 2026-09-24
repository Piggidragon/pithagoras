import {test} from 'node:test';
import assert from 'node:assert/strict';
import {shellOutcome} from '../web/src/components/ChatActivity.tsx';
test('a shell command says how it ended',()=>{
 assert.equal(shellOutcome('running','x'),undefined);
 assert.deepEqual(shellOutcome('done','ok'),{label:'exit 0',tone:'ok'});
 assert.deepEqual(shellOutcome('error','boom\n\nCommand exited with code 127'),{label:'exit 127',tone:'error'});
 assert.deepEqual(shellOutcome('error','…\n\nCommand timed out after 30 seconds'),{label:'timed out · 30s',tone:'warn'});
 assert.deepEqual(shellOutcome('error','\n\nCommand aborted'),{label:'stopped',tone:'warn'});
});
