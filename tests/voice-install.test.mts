import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { containerSpec } from '../server/src/extensions/voice-service.js';
test('voice container keeps models on disk and publishes only loopback endpoints',()=>{
 const spec=containerSpec('echo test');
 assert.equal(spec.HostConfig.RestartPolicy.Name,'no');
 assert.deepEqual(spec.HostConfig.DeviceRequests[0].Capabilities,[['gpu']]);
 assert.ok(spec.HostConfig.Binds.includes('pithagoras_voice-models:/voice'));
 for(const bindings of Object.values(spec.HostConfig.PortBindings))assert.equal(bindings[0].HostIp,'127.0.0.1');
 assert.equal(spec.Tty,true);
});
test('setup publishes only inspected quantized output and retains partial downloads for retry',()=>{
 const script=readFileSync('deploy/voice/setup.sh','utf8');
 assert.ok(script.indexOf('--inspect models/breeze-q8_0.partial.gguf') < script.indexOf('mv models/breeze-q8_0.partial.gguf models/breeze-q8_0.gguf'));
 assert.match(script,/--continue=true/);
 assert.match(script,/-DGGML_CUDA=OFF/);
 assert.doesNotMatch(script,/MODEL_REVISION/);
});
