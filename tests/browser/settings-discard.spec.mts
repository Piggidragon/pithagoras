import { type Locator, type Page } from '@playwright/test';
import { test, expect, mockPortal, type Ask } from './portal-mock';
import { DEFAULT_ORB } from '../../server/src/orb-style';

/**
 * Escape over a form in Settings that has something typed in and not saved asks
 * first, as the skill and provider editors do; a form that was only opened
 * closes at once. Over canned answers.
 */
async function portal(page: Page, answers: Record<string, unknown>, live?: (ask: Ask) => unknown) {
  await mockPortal(page, (ask) => live?.(ask) ?? answers[ask.path], { settings: true });
}

const settings = (page: Page) => page.getByRole('dialog', { name: 'Settings' });

/** Escape asks, and "Cancel" leaves Settings as it was. */
async function asksBeforeClosing(page: Page, field: Locator, typed: string) {
  await page.keyboard.press('Escape');
  const ask = page.getByRole('alertdialog', { name: 'Discard your changes?' });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await expect(settings(page)).toBeVisible();
  await expect(field).toHaveValue(typed);
}

const MCP = { path: '/a/mcp.json', exists: true, adapterInstalled: true, adapterSpec: 'npm:pi-mcp-adapter', servers: [], settings: {}, raw: '{}', parseError: null };

test('Escape over an MCP server form that was filled in asks first; one that was only opened closes at once', async ({ page }) => {
  await portal(page, { '/api/mcp': MCP });
  await page.goto('/settings/mcp');
  await settings(page).getByRole('button', { name: 'Add server' }).click();
  await page.keyboard.press('Escape');
  await expect(settings(page)).toBeHidden();

  await page.goto('/settings/mcp');
  await settings(page).getByRole('button', { name: 'Add server' }).click();
  const command = settings(page).getByRole('textbox', { name: 'Command' });
  await command.fill('notes-mcp --token abc');
  await asksBeforeClosing(page, command, 'notes-mcp --token abc');
});

test('Escape over a pasted config and over the raw file that were typed in asks first', async ({ page }) => {
  await portal(page, { '/api/mcp': MCP });
  await page.goto('/settings/mcp');
  await settings(page).getByRole('button', { name: 'Paste JSON' }).click();
  const pasted = settings(page).locator('textarea').first();
  await pasted.fill('{"mcpServers":{}}');
  await asksBeforeClosing(page, pasted, '{"mcpServers":{}}');

  await page.goto('/settings/mcp');
  await settings(page).getByRole('button', { name: 'Edit the file directly' }).click();
  const raw = settings(page).getByRole('textbox', { name: 'mcp.json' });
  await raw.fill('{ "mcpServers": { "a": { "command": "x" } } }');
  await asksBeforeClosing(page, raw, '{ "mcpServers": { "a": { "command": "x" } } }');
});

test("Escape over a person's notes that were typed in asks first", async ({ page }) => {
  const kim = { key: 'tg:kim', name: 'Kim', role: 'colleague', notes: '', first_seen: '', last_seen: null, announced_at: null, renamed: 0 };
  await portal(page, { '/api/people': { people: [kim] }, '/api/tool-rules': { rules: [] } });
  await page.goto('/settings/people');
  await settings(page).getByRole('button', { name: /Kim/ }).click();
  await page.keyboard.press('Escape');
  await expect(settings(page)).toBeHidden();

  await page.goto('/settings/people');
  await settings(page).getByRole('button', { name: /Kim/ }).click();
  const notes = settings(page).getByPlaceholder(/Their role, what they work on/);
  await notes.fill('Reviews the pull requests.');
  await asksBeforeClosing(page, notes, 'Reviews the pull requests.');
});

const CHANNEL = {
  id: 'c1', slug: 'ops', kind: 'bot', name: 'Ops bot', enabled: true, config: {}, secretsSet: [], instructions: '', relayProgress: true, relayTools: false,
  agentId: 'home', sessionCount: 0, state: 'running', log: [], created_at: '', updated_at: '1',
};
const CHANNELS = {
  '/api/channels': { channels: [CHANNEL], kinds: [{ id: 'bot', label: 'Chat bot', blurb: 'A bot', fields: [], packageName: 'pi-bot', builtin: true, runnable: true }], broken: [], channelsDir: '/a/channels' },
  '/api/agents': { agents: [{ id: 'home', name: 'Home', home: '/a', first: true, initialised: true, chats: 0, channels: [], orb: DEFAULT_ORB, voice: '', unread: 0 }] },
};

test("Escape over a channel's settings that were changed, and over a channel being added, asks first", async ({ page }) => {
  await portal(page, CHANNELS);
  await page.goto('/settings/channels');
  await settings(page).getByRole('button', { name: /Ops bot/ }).click();
  await page.keyboard.press('Escape');
  await expect(settings(page)).toBeHidden();

  await page.goto('/settings/channels');
  await settings(page).getByRole('button', { name: /Ops bot/ }).click();
  const name = settings(page).getByRole('textbox').first();
  await name.fill('Ops bot, renamed');
  await asksBeforeClosing(page, name, 'Ops bot, renamed');

  await page.goto('/settings/channels');
  await settings(page).getByRole('button', { name: 'Chat bot', exact: true }).click();
  const added = settings(page).getByRole('textbox', { name: 'Name', exact: true });
  await added.fill('A bot of mine');
  await asksBeforeClosing(page, added, 'A bot of mine');
});

test('Escape over a new skill that was begun asks first', async ({ page }) => {
  await portal(page, { '/api/skills': { root: '/agent/skills', skills: [], diagnostics: [] } });
  await page.goto('/settings/skills');
  await settings(page).getByRole('button', { name: '+ New' }).click();
  await page.keyboard.press('Escape');
  await expect(settings(page)).toBeHidden();

  await page.goto('/settings/skills');
  await settings(page).getByRole('button', { name: '+ New' }).click();
  const name = settings(page).getByPlaceholder('cut-a-release');
  await name.fill('release-notes');
  await asksBeforeClosing(page, name, 'release-notes');
});

test('Escape over an MCP paste that every server was skipped for, and then edited, asks first', async ({ page }) => {
  // A server that is already there is skipped, with the reason, and the box stays open with the text for the person to go on with.
  await portal(page, { '/api/mcp': MCP }, ({ path, method }) => (path === '/api/mcp/import' && method === 'POST' ? { added: [], skipped: [{ name: 'filesystem', reason: 'A server called filesystem already exists' }] } : undefined));
  await page.goto('/settings/mcp');
  await settings(page).getByRole('button', { name: 'Paste JSON' }).click();
  const pasted = settings(page).locator('textarea').first();
  await pasted.fill('{"mcpServers":{"filesystem":{"command":"npx"}}}');
  await settings(page).getByRole('button', { name: 'Import', exact: true }).click();
  await expect(settings(page).getByText('Skipped filesystem: A server called filesystem already exists')).toBeVisible();
  await pasted.fill('{"mcpServers":{"filesystem-data":{"command":"npx"}}}');
  await asksBeforeClosing(page, pasted, '{"mcpServers":{"filesystem-data":{"command":"npx"}}}');
});

test("Escape over pi's settings.json typed in under Advanced asks first, and over one that was saved does not", async ({ page }) => {
  const file = { path: '/a/settings.json', content: '{ "theme": "dark" }' };
  await portal(page, { '/api/pi-settings': file });
  await page.goto('/settings/advanced');
  const raw = settings(page).getByRole('textbox', { name: 'settings.json' });
  await expect(raw).toHaveValue(file.content);
  // Only opened: nothing to ask about.
  await page.keyboard.press('Escape');
  await expect(settings(page)).toBeHidden();

  await page.goto('/settings/advanced');
  await raw.fill('{ "theme": "dark", "packages": ["npm:pi-web"] }');
  await asksBeforeClosing(page, raw, '{ "theme": "dark", "packages": ["npm:pi-web"] }');
  // Saved, it is on disk: the copy in the form is not the only one.
  await settings(page).getByRole('button', { name: 'Save file' }).click();
  await expect(settings(page).getByRole('button', { name: 'Saved' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settings(page)).toBeHidden();
});

test("Escape over an extension's setting that was typed in asks first, and once it is stored does not", async ({ page }) => {
  const stored = { value: '' };
  const extension = () => ({ name: 'pi-web', spec: 'npm:pi-web', enabled: true, description: '', homepage: '', settings: [{ key: 'token', value: stored.value, configured: stored.value !== '' }] });
  await portal(page, {}, ({ path, method, json }) => {
    if (path === '/api/extensions' && method === 'GET') return { settingsPath: '/a/settings.json', extensions: [extension()] };
    if (path === '/api/extensions/settings' && method === 'PUT') {
      stored.value = json().value;
      return { ok: true };
    }
  });
  const open = async () => {
    await page.goto('/settings/extensions');
    await settings(page).getByRole('listitem').filter({ hasText: 'npm:pi-web' }).getByRole('button', { name: /^Configure/ }).click();
    return settings(page).getByRole('textbox', { name: 'Token' });
  };
  let field = await open();
  await page.keyboard.press('Escape');
  await expect(settings(page)).toBeHidden();

  field = await open();
  await field.fill('sk-secret');
  await asksBeforeClosing(page, field, 'sk-secret');
  await settings(page).getByRole('button', { name: 'Save', exact: true }).click();
  // Stored, and the check that says so has gone: "Save" is back, with nothing to save.
  await expect(settings(page).getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  expect(stored.value).toBe('sk-secret');
  await page.keyboard.press('Escape');
  await expect(settings(page)).toBeHidden();
});

const PROVIDERS = {
  presets: [{ kind: 'llama-swap', label: 'llama-swap', id: 'llama-swap', baseUrl: 'http://gpu:8080/v1', endpoint: true, key: 'none' }],
  apis: ['openai-completions'],
  hosted: [],
  providers: [{ id: 'llama-swap', kind: 'llama-swap', label: 'llama-swap', baseUrl: 'http://gpu:8080/v1', api: 'openai-completions', key: { set: false }, models: [{ id: 'model-a', name: 'Model A', contextWindow: 65536 }, { id: 'model-b', name: 'Model B' }], endpoint: true }],
};

test("Escape over a provider's models that were unticked or given a window asks first, and a probe that only found more does not", async ({ page }) => {
  // The server lists one more than the provider has: a model found, which the editor offers and does not tick.
  const listed = [{ id: 'model-a', name: 'Model A' }, { id: 'model-b', name: 'Model B' }, { id: 'model-c', name: 'Model C' }];
  await portal(page, { '/api/providers': PROVIDERS, '/api/providers/status': { status: {} } }, ({ path }) => (path === '/api/providers/probe' ? { baseUrl: 'http://gpu:8080/v1', models: listed } : undefined));
  const open = async () => {
    await page.goto('/settings/models');
    await settings(page).getByRole('button', { name: /^Edit/ }).first().click();
    await expect(settings(page).getByText('3 models found')).toBeVisible();
  };
  await open();
  await page.keyboard.press('Escape');
  await expect(settings(page)).toBeHidden();

  await open();
  const untick = settings(page).getByRole('checkbox', { name: 'Use model-b' });
  await untick.uncheck();
  await page.keyboard.press('Escape');
  const ask = page.getByRole('alertdialog', { name: 'Discard your changes?' });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await expect(untick).not.toBeChecked();
  await untick.check();

  const window = settings(page).getByRole('textbox', { name: 'Context window of model-a' });
  await window.fill('32768');
  await asksBeforeClosing(page, window, '32768');
});

test("Escape over the voice settings that were changed asks first, and over ones that were saved does not", async ({ page }) => {
  let config: Record<string, unknown> = { enabled: false, whisperUrl: 'http://127.0.0.1:8178/inference', breezeUrl: 'http://127.0.0.1:7860/v1/audio/speech', instruction: 'Clear speech', voice: 'design', runtime: 'breeze', language: 'auto', cfgScale: 4, responseInstructions: 'Be short.', defaultResponseInstructions: 'Be short.' };
  await portal(page, {
    '/api/voice/install': { available: true, state: 'absent', busy: false, progress: '', error: '' },
    '/api/voice/presets': [],
    '/api/voice/hardware': { gpus: [], source: 'none', error: '', checked: false, cpuOnly: false, host: { totalMiB: 16384, freeMiB: 12000, threads: 8 }, selected: null, reserveMiB: 0, suggestion: { tts: 'breeze', asr: 'whisper', asrModel: 'base' } },
  }, ({ path, method, json }) => {
    if (path !== '/api/voice') return undefined;
    if (method === 'PUT') config = json();
    return config;
  });
  const open = async () => {
    await page.goto('/settings/add-ons');
    await settings(page).getByRole('tab', { name: 'Voice' }).click();
    await settings(page).getByText('Speaking instructions').first().click();
    return settings(page).getByRole('textbox', { name: 'Speaking instructions' });
  };
  let instructions = await open();
  await expect(instructions).toHaveValue('Be short.');
  await page.keyboard.press('Escape');
  await expect(settings(page)).toBeHidden();

  instructions = await open();
  await instructions.fill('Answer in one sentence.');
  await asksBeforeClosing(page, instructions, 'Answer in one sentence.');
  await settings(page).getByRole('button', { name: 'Save voice settings' }).click();
  await expect(settings(page).getByRole('button', { name: 'Saved' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settings(page)).toBeHidden();
  expect(config.responseInstructions).toBe('Answer in one sentence.');
});

test('Escape over the avatar dialog with a change in it asks first, and over one that was only opened does not', async ({ page }) => {
  const orb = { personality: 'balanced', palette: 'aurora', colors: { idle: '#82bcff', input: '#7fe0b4', output: '#c9a2ff', muted: '#8a91a0' }, speed: 1, reactivity: 1, glow: 1, pattern: 'ribbons', finish: 'glossy', eyes: 'none', eyeColor: '#111111', hat: 'none', hatColor: 'auto', prop: 'none', propColor: 'auto' };
  await portal(page, {
    '/api/agents': { agents: [{ id: 'home', name: 'Home', home: '/a', first: true, initialised: true, chats: 0, channels: [], orb, voice: '', heartbeat: { minutes: 0, quietStart: '', quietEnd: '', timeZone: 'UTC', last: null, status: null, running: false, watching: false, available: true }, unread: 0 }] },
    '/api/agent/sessions': { sessions: [], agentHome: '/a' },
    '/api/agents/home/setup': { home: '/a', initialised: true, files: [{ name: 'SOUL.md', exists: true, content: 'Kind.', mtime: 1 }] },
    '/api/voice/presets': [],
  });
  const avatar = page.getByRole('dialog', { name: 'Avatar' });
  await page.goto('/agents?agent=home');
  await page.getByRole('button', { name: 'Customize the avatar' }).click();
  await expect(avatar).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(avatar).toBeHidden();

  await page.getByRole('button', { name: 'Customize the avatar' }).click();
  const lively = avatar.getByRole('button', { name: /^Lively/ });
  await lively.click();
  await expect(lively).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  const ask = page.getByRole('alertdialog', { name: 'Discard your changes?' });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await expect(avatar).toBeVisible();
  await expect(lively).toHaveAttribute('aria-pressed', 'true');
});
