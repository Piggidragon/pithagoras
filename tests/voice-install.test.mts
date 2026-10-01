import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { containerSpec } from '../server/src/extensions/voice-service.js';
test('voice container shares portal networking without publishing host ports',()=>{
 const spec=containerSpec('echo test', 'container:portal-id');
 assert.equal(spec.HostConfig.RestartPolicy.Name,'no');
 assert.deepEqual(spec.HostConfig.DeviceRequests[0].Capabilities,[['gpu']]);
 assert.ok(spec.HostConfig.Binds.includes('pithagoras_voice-models:/voice'));
 assert.equal(spec.HostConfig.NetworkMode,'container:portal-id');
 assert.equal('PortBindings' in spec.HostConfig,false);
 assert.equal('ExposedPorts' in spec,false);
 assert.equal(spec.Tty,true);
});
test('setup publishes only inspected quantized output and retains partial downloads for retry',()=>{
 const script=readFileSync('deploy/voice/setup.sh','utf8');
 assert.ok(script.indexOf('--inspect models/breeze-q8_0.partial.gguf') < script.indexOf('mv models/breeze-q8_0.partial.gguf models/breeze-q8_0.gguf'));
 assert.match(script,/--continue=true/);
 assert.match(script,/-DGGML_CUDA=OFF/);
 assert.doesNotMatch(script,/MODEL_REVISION/);
});

test('services listen on the portal loopback endpoints',()=>{
 const script=readFileSync('deploy/voice/setup.sh','utf8');
 assert.match(script,/--host 127\.0\.0\.1 --port 8188/);
 assert.match(script,/"host":"127\.0\.0\.1","port":7862/);
 assert.equal(containerSpec('', 'host').HostConfig.NetworkMode, 'host');
});

test('the portal settings the voice installer reads reach a portal run with the shipped Compose files',()=>{
 // Compose passes the portal only what it lists: a variable left out is never set in the portal, whatever .env says.
 for(const file of ['docker-compose.yml','docker-compose.portainer.yml']){
  const text=readFileSync(file,'utf8');
  const portal=text.slice(text.indexOf('environment:'),text.lastIndexOf('\nvolumes:'));
  assert.match(portal,/^ {6}VOICE_GPU: \$\{VOICE_GPU:-\}$/m,file);
  assert.match(portal,/^ {6}VOICE_VRAM_RESERVE_MIB: \$\{VOICE_VRAM_RESERVE_MIB:-\}$/m,file);
 }
 const env=readFileSync('.env.example','utf8');
 assert.match(env,/^# VOICE_GPU=\d+$/m);
 assert.match(env,/^# VOICE_VRAM_RESERVE_MIB=\d+$/m);
});
