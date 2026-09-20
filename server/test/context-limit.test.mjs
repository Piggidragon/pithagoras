import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dataDir = mkdtempSync(join(tmpdir(), 'pithagoras-ctx-'));
process.env.DATA_DIR = dataDir;
const { getContextLimit, setContextLimit, getDefaultContextLimit, setDefaultContextLimit, contextWindowFor, contextLimitProblem, getDb } =
  await import('../dist/db.js');
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

test('the default is a ceiling: it lowers a model, never raises one, and a model of its own beats it', () => {
  assert.equal(getDefaultContextLimit(), undefined);
  assert.equal(contextWindowFor('p', 'a', 262144), 262144, 'no default: what the model says');
  setDefaultContextLimit(131072);
  assert.equal(getDefaultContextLimit(), 131072);
  assert.equal(contextWindowFor('p', 'a', 262144), 131072, 'a bigger model is held to it');
  assert.equal(contextWindowFor('p', 'a', 32768), 32768, 'a smaller one keeps its own');
  assert.equal(contextWindowFor('p', 'a', undefined), 131072, 'a model that says nothing gets it');
  setContextLimit('p', 'a', 200000);
  assert.equal(contextWindowFor('p', 'a', 262144), 200000, 'the setting for the model wins, even above the default');
  setContextLimit('p', 'a', null);
  setDefaultContextLimit(null);
  assert.equal(contextWindowFor('p', 'a', 262144), 262144);
  assert.equal(contextWindowFor('p', 'a', undefined), undefined);
});

test('a session follows the default, and lets go of it when it is removed', () => {
  const { client, session } = clientFor({ provider: 'p', id: 'd', contextWindow: 262144 }, 262144);
  setDefaultContextLimit(131072);
  client.applyContextLimit();
  assert.equal(session.model.contextWindow, 131072);
  setDefaultContextLimit(null);
  client.applyContextLimit();
  assert.equal(session.model.contextWindow, 262144);
});

test('only whole numbers in range are accepted as a window', () => {
  assert.equal(contextLimitProblem(131072), undefined);
  for (const bad of [0, 1023, 10_000_001, 1.5, '131072', NaN, null, undefined, {}]) {
    assert.match(contextLimitProblem(bad), /whole number between 1,024 and 10,000,000/, String(bad));
  }
});
