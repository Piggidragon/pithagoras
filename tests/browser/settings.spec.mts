import { test, expect, type Page } from '@playwright/test';

/** The portal with no server: Settings, its search, and the setup assistant, over canned answers. */
async function portal(page: Page, { models = true, slow = 0, stored = {} as Record<string, string>, probe = undefined as undefined | ((baseUrl: string) => string[] | undefined), homepage = undefined as string | undefined } = {}) {
  const calls: string[] = [];
  const providerSaves: unknown[] = [];
  const available = models ? [{ provider: 'llama-swap', id: 'Ornith', name: 'Ornith 1.5', contextWindow: 65536, reasoning: true }] : [];
  let saved: unknown = null;
  let installed: string[] = [];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const method = route.request().method();
    calls.push(`${method} ${p}`);
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    let body: unknown = {};
    if (p === '/api/auth/status') body = { authed: true, authRequired: false };
    else if (p === '/api/sessions' && method === 'GET') body = { sessions: [], executor: 'host' };
    else if (p === '/api/sessions') body = { id: 'new', title: 'New', workspace: '/w', status: 'idle', kind: 'task', pinned: false };
    else if (p === '/api/settings' && method === 'PUT') { saved = route.request().postDataJSON(); body = { settings: {}, compaction: { keepRecentTokens: 20000 }, refreshed: 0, note: '' }; }
    else if (p === '/api/settings') {
      await wait(slow);
      body = {
        settings: { provider: 'llama-swap', model: 'Ornith', thinkingLevel: 'medium' }, stored, defaults: { provider: 'llama-swap', model: 'Ornith', thinkingLevel: 'medium' },
        piSettingsPath: '/a/settings.json', compaction: { keepRecentTokens: 20000 }, compactionDefaults: { keepRecentTokens: 20000 }, contextDefault: null, executor: 'host', workspaceRoot: '/w',
      };
    } else if (p === '/api/models') { await wait(slow * 2); body = { models: available, providers: { 'llama-swap': 'llama-swap' } }; }
    else if (p === '/api/routines/report-targets') { await wait(slow); body = { targets: [], default: null }; }
    else if (p === '/api/providers') body = {
      presets: [
        { kind: 'llama-cpp', label: 'llama.cpp', description: 'One llama-server', id: 'llama-server', endpoint: true, baseUrl: 'http://127.0.0.1:8080/v1', key: 'optional' },
        { kind: 'custom', label: 'Custom', description: 'Any OpenAI-compatible server', id: 'custom', endpoint: true, key: 'optional' },
      ],
      apis: ['openai-completions'], hosted: [],
      providers: models ? [{ id: 'llama-swap', kind: 'llama-swap', label: 'llama-swap', baseUrl: 'http://gpu:8080/v1', key: { set: false }, models: [{ id: 'Ornith', name: 'Ornith 1.5' }, { id: 'Gone' }], endpoint: true }] : [],
    };
    else if (p === '/api/providers/status') body = { status: { 'llama-swap': { state: 'up', ms: 12, listed: 1, missing: ['Gone'], loaded: ['Ornith'] } } };
    else if (p === '/api/extensions') { await wait(slow * 3); body = { settingsPath: '/a/settings.json', extensions: [{ spec: 'npm:pi-web-access', name: 'pi-web-access', settings: [{ key: 'braveApiKey', value: '', configured: false }, { key: 'safeSearch', value: true, configured: true }] }] }; }
    else if (p === '/api/packages/catalog') body = { packages: [
      { name: 'pi-web-access', version: '0.31.0', description: 'Web search for pi', weekly: 198311, keywords: ['pi-package'], provider: false, homepage },
      { name: 'pi-subagents', version: '0.71.0', description: 'Delegate to helpers', weekly: 100713, keywords: ['pi-package'], provider: false, date: new Date(Date.now() - 2 * 86400_000).toISOString() },
    ] };
    else if (p === '/api/packages' && method === 'POST') { installed.push(route.request().postDataJSON().spec); body = { ok: true, output: '' }; }
    else if (p === '/api/providers/probe' && probe) {
      const listed = probe(route.request().postDataJSON().baseUrl);
      if (!listed) return route.fulfill({ status: 502, json: { error: 'Nothing answered there.' } });
      body = { baseUrl: route.request().postDataJSON().baseUrl, models: listed.map((id) => ({ id })) };
    }
    else if (p.startsWith('/api/providers/') && method === 'PUT') { providerSaves.push(route.request().postDataJSON()); body = { ok: true }; }
    else if (p === '/api/providers/probe') return route.fulfill({ status: 502, json: { error: 'Nothing answered at 127.0.0.1:8080 — is the server running, and reachable from here?' } });
    else if (p === '/api/tool-names') body = { names: {} };
    else if (p === '/api/browser') body = { running: false, sessions: [], routines: [] };
    else if (p === '/api/voice') body = { enabled: false };
    else if (p === '/api/workspaces') body = { root: '/w', workspaces: [] };
    await route.fulfill({ json: body });
  });
  await page.addInitScript(() => {
    (window as any).EventSource = class { onmessage: any; onopen: any; onerror: any; addEventListener() {} close() {} };
  });
  return { calls, saved: () => saved, installed: () => installed, providerSaves };
}

test('search finds a setting on another page and lights it up', async ({ page }) => {
  await portal(page);
  await page.addInitScript(() => localStorage.setItem('pithagoras.setup', 'done'));
  await page.goto('/settings/general');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog.getByLabel('Default model')).toBeVisible();

  // "/" reaches the search from anywhere that is not a field.
  await page.keyboard.press('/');
  await expect(dialog.getByLabel('Search settings')).toBeFocused();
  await page.keyboard.type('dunkel');
  await expect(dialog.getByRole('option').first()).toContainText('Theme');
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('radiogroup', { name: 'Theme' })).toBeInViewport();
  await expect(dialog.locator('[data-setting="Appearance"]')).toHaveClass(/setting-flash/);

  // An extension's own keys are found too, by their readable names.
  await dialog.getByLabel('Search settings').fill('safe search');
  await dialog.getByRole('option').first().click();
  await expect(dialog.getByRole('switch', { name: 'Safe search' })).toBeVisible();

  // Escape clears the search before it closes the dialog.
  await dialog.getByLabel('Search settings').fill('context');
  await dialog.getByLabel('Search settings').press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Search settings')).toHaveValue('');
});

test('Defaults draws once, whole: nothing moves after it appears', async ({ page }) => {
  await portal(page, { slow: 250 });
  await page.addInitScript(() => localStorage.setItem('pithagoras.setup', 'done'));
  await page.goto('/settings/general');
  const context = page.locator('[data-setting="Context"]');
  await expect(context).toBeVisible();
  const first = await context.evaluate((el) => el.getBoundingClientRect().top);
  await page.waitForTimeout(900);
  const later = await context.evaluate((el) => el.getBoundingClientRect().top);
  expect(Math.abs(later - first)).toBeLessThan(8); // no more than its own rise
  await expect(page.getByLabel('Default model')).toContainText('Ornith 1.5');

  // Opened a second time, it is there at once, from what was kept.
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden();
  await page.getByRole('button', { name: /settings/i }).first().click();
  await expect(page.getByLabel('Default model')).toContainText('Ornith 1.5', { timeout: 150 });
});

test('the rail keeps its extension pages from last time, and a provider says it is online', async ({ page }) => {
  await portal(page, { slow: 400 });
  await page.addInitScript(() => {
    localStorage.setItem('pithagoras.setup', 'done');
    localStorage.setItem('pithagoras.settings.extension-rail', JSON.stringify([{ spec: 'npm:pi-web-access', name: 'pi-web-access' }]));
  });
  await page.goto('/settings/models');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  // There before the slow list of extensions has answered.
  await expect(dialog.getByRole('button', { name: 'pi-web-access' })).toBeVisible({ timeout: 800 });
  await expect(dialog.getByText('Online · 12 ms')).toBeVisible();
  await expect(dialog.getByText('Gone is not listed by the server any more.')).toBeVisible();
  await expect(dialog.getByTitle('Ornith — loaded now')).toBeVisible();
});

test('with no model yet, the setup assistant walks through provider, model and packages', async ({ page }) => {
  const api = await portal(page, { models: false });
  await page.goto('/');
  const setup = page.getByRole('dialog', { name: 'Set up Pithagoras' });
  await expect(setup).toBeVisible({ timeout: 5000 });
  await expect(setup.getByLabel('Kind of provider')).toBeVisible();
  await expect(setup.getByRole('button', { name: 'Next' })).toBeDisabled();

  // "From a package" shows provider packages rather than an address.
  await setup.getByLabel('Kind of provider').click();
  await page.getByRole('option', { name: /From a package/ }).click();
  await expect(setup.getByText('pi-web-access')).toBeVisible();

  // Skipped, it stays away after a reload.
  await setup.getByRole('button', { name: 'Skip for now' }).click();
  await expect(setup).toBeHidden();
  await page.reload();
  await page.waitForTimeout(2000);
  await expect(setup).toBeHidden();
  expect(api.calls.some((c) => c === 'GET /api/models')).toBe(true);
});

test('with models, the assistant saves the model and effort, then offers packages to install', async ({ page }) => {
  const api = await portal(page);
  await page.goto('/settings/models');
  await page.getByRole('button', { name: 'Setup assistant' }).click();
  const setup = page.getByRole('dialog', { name: 'Set up Pithagoras' });
  await expect(setup.getByText('llama-swap').first()).toBeVisible();
  await setup.getByRole('button', { name: 'Next' }).click();
  await expect(setup.getByLabel('Model for new chats')).toContainText('Ornith 1.5');
  await setup.getByRole('radio', { name: 'high', exact: true }).click();
  await setup.getByRole('button', { name: 'Next' }).click();
  await expect.poll(() => api.saved()).toEqual({ provider: 'llama-swap', model: 'Ornith', thinkingLevel: 'high' });
  await expect(setup.getByText('pi-subagents')).toBeVisible();
  await setup.getByRole('button', { name: 'Install pi-subagents' }).click();
  await page.getByRole('button', { name: 'Install', exact: true }).click();
  await expect(setup.getByText('Installed')).toBeVisible();
  await expect.poll(() => api.installed()).toEqual(['npm:pi-subagents']);
  await setup.getByRole('button', { name: 'Done' }).click();
  await expect(setup).toBeHidden();
});

test('a stored model no one offers any more is not kept: the assistant offers one that is, and saves it', async ({ page }) => {
  const api = await portal(page, { stored: { provider: 'gone', model: 'foo' } });
  await page.goto('/settings/models');
  await page.getByRole('button', { name: 'Setup assistant' }).click();
  const setup = page.getByRole('dialog', { name: 'Set up Pithagoras' });
  await setup.getByRole('button', { name: 'Next' }).click();
  await expect(setup.getByLabel('Model for new chats')).toContainText('Ornith 1.5');
  await setup.getByRole('button', { name: 'Next' }).click();
  await expect.poll(() => api.saved()).toMatchObject({ provider: 'llama-swap', model: 'Ornith' });
});

test('a new provider keeps only the models its current address lists', async ({ page }) => {
  const api = await portal(page, { probe: (url) => (url.includes('9090') ? ['B'] : url.includes('8080') ? ['A'] : undefined) });
  await page.addInitScript(() => localStorage.setItem('pithagoras.setup', 'done'));
  await page.goto('/settings/models');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('button', { name: 'Add a provider' }).click();
  // The preset's address is asked at once: something answers there.
  await expect(dialog.getByLabel('Use A')).toBeChecked();
  await dialog.getByLabel('Server address').fill('http://gpu:9090/v1');
  await expect(dialog.getByLabel('Use B')).toBeChecked();
  await expect(dialog.getByLabel('Use A')).toHaveCount(0);
  // One named by hand stays, whatever the address.
  await dialog.getByLabel('Model id to add').fill('Mine');
  await dialog.getByLabel('Model id to add').press('Enter');
  await dialog.getByLabel('Server address').fill('http://gpu:9090/v1/');
  await expect(dialog.getByLabel('Use Mine')).toBeChecked();
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect.poll(() => api.providerSaves.length).toBe(1);
  expect((api.providerSaves[0] as { models: { id: string }[] }).models.map((m) => m.id)).toEqual(['B', 'Mine']);
});

test("a package's link that is not a web page is not made a link", async ({ page }) => {
  await portal(page, { homepage: 'javascript:alert(1)' });
  await page.addInitScript(() => localStorage.setItem('pithagoras.setup', 'done'));
  await page.goto('/settings/models');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('button', { name: 'Add a provider' }).click();
  await dialog.getByLabel('Kind of provider').click();
  await page.getByRole('option', { name: /From a package/ }).click();
  // Drawn: its description is there, and so would its link be.
  await expect(dialog.getByText('Web search for pi')).toBeVisible();
  await expect(dialog.getByText('Delegate to helpers')).toBeVisible();
  await expect(dialog.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(dialog.getByRole('link', { name: 'more' })).toHaveCount(0);
});
