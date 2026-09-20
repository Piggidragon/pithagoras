import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dataDir = mkdtempSync(join(tmpdir(), 'pithagoras-ctx-'));
process.env.DATA_DIR = dataDir;
const { getContextLimit, setContextLimit, getDb } = await import('../dist/db.js');
const { SdkPiClient } = await import('../dist/pi/sdk-client.js');
test.after(() => { getDb().close(); rmSync(dataDir, { recursive: true, force: true }); });

/** A client around a stand-in session: only what applyContextLimit touches. */
function clientFor(model, declared) {
  const session = {
    agent: { state: { model } },
    get model() { return this.agent.state.model; },
  };
  const client = Object.create(SdkPiClient.prototype);
  client.session = session;
  client.modelRuntime = { getModel: () => ({ ...model, contextWindow: declared }) };
  return { client, session };
}

test('a limit belongs to one model, and can be taken away', () => {
  assert.equal(getContextLimit('llama-swap', 'big'), undefined);
  setContextLimit('llama-swap', 'big', 131072);
  assert.equal(getContextLimit('llama-swap', 'big'), 131072);
  assert.equal(getContextLimit('llama-swap', 'small'), undefined);
  assert.equal(getContextLimit('other', 'big'), undefined);
  setContextLimit('llama-swap', 'big', 65536);
  assert.equal(getContextLimit('llama-swap', 'big'), 65536);
  setContextLimit('llama-swap', 'big', null);
  assert.equal(getContextLimit('llama-swap', 'big'), undefined);
});

test('the session runs on the limit, not on what the model definition says', () => {
  setContextLimit('p', 'm', 131072);
  const model = { provider: 'p', id: 'm', name: 'M', contextWindow: 262144 };
  const { client, session } = clientFor(model, 262144);
  client.applyContextLimit();
  assert.equal(session.model.contextWindow, 131072);
  assert.equal(session.model.id, 'm');
  assert.equal(model.contextWindow, 262144, 'the definition itself is not touched');
});

test('taking the limit away puts the definition back, in a session that is already open', () => {
  setContextLimit('p', 'm2', 131072);
  const { client, session } = clientFor({ provider: 'p', id: 'm2', contextWindow: 262144 }, 262144);
  client.applyContextLimit();
  assert.equal(session.model.contextWindow, 131072);
  setContextLimit('p', 'm2', null);
  client.applyContextLimit();
  assert.equal(session.model.contextWindow, 262144);
});

test('a model with no limit is left exactly as it was', () => {
  const model = { provider: 'p', id: 'none', contextWindow: 200000 };
  const { client, session } = clientFor(model, 200000);
  client.applyContextLimit();
  assert.equal(session.agent.state.model, model);
});
