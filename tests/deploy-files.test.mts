import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const COMPOSE = ['docker-compose.yml', 'docker-compose.portainer.yml'];

/** The names under `environment:`, in a Compose file written the way these are: one `NAME: value` per line. */
const environmentOf = (file: string): string[] => {
  const lines = read(file).split('\n');
  const from = lines.findIndex((l) => /^ {4}environment:/.test(l));
  assert.ok(from >= 0, `${file} has an environment`);
  const names: string[] = [];
  for (const line of lines.slice(from + 1)) {
    if (/^\S/.test(line) || /^ {0,4}\S/.test(line)) break;
    const name = /^ {6}([A-Z][A-Z0-9_]*):/.exec(line);
    if (name) names.push(name[1]);
  }
  return names;
};

/** Every `${NAME...}` a Compose file reads from the shell or .env. */
const readsOf = (file: string): string[] => [...new Set([...read(file).matchAll(/\$\{([A-Z][A-Z0-9_]*)[:}-]/g)].map((m) => m[1]))];

test('the Portainer stack passes the same environment as the Compose file', () => {
  assert.deepEqual([...environmentOf('docker-compose.portainer.yml')].sort(), [...environmentOf('docker-compose.yml')].sort());
});

test('what the docs tell a deployment to set reaches the container: the clock, the upgrade backup, an open listener, the TLS files', () => {
  for (const file of COMPOSE) {
    const names = environmentOf(file);
    for (const name of ['TZ', 'PORTAL_UPGRADE_BACKUP', 'ALLOW_OPEN', 'PORTAL_ALLOW_NO_PASSWORD', 'PORTAL_TLS_CERT', 'PORTAL_TLS_KEY', 'LLAMA_BASE_URL', 'LLAMA_DISK_CACHE_MODELS', 'OPENAI_API_KEY']) {
      assert.ok(names.includes(name), `${file} passes ${name}`);
    }
    assert.match(read(file), /\$\{PORTAL_TLS_DIR:-\/dev\/null\}:\/certs:ro/, `${file} mounts the certificates`);
  }
});

test('no Compose file mounts a default workspace folder: it is asked for, and no install\'s path is a default', () => {
  for (const file of COMPOSE) {
    assert.match(read(file), /\$\{WORKSPACES_DIR:\?[^}]+\}:\/workspaces/, `${file} refuses to start without WORKSPACES_DIR`);
  }
  for (const file of [...COMPOSE, '.env.example', 'README.md']) assert.doesNotMatch(read(file), /\/root\/repos/, file);
  // Set in .env.example, it would be the default again for everybody who copies the file.
  assert.doesNotMatch(read('.env.example'), /^WORKSPACES_DIR=/m);
});

test('.env.example lists every variable a Compose file reads', () => {
  const example = read('.env.example');
  for (const name of new Set(COMPOSE.flatMap(readsOf))) {
    assert.match(example, new RegExp(`^(# )?${name}=`, 'm'), `${name} is in .env.example`);
  }
});
