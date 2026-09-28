import { test, expect, type Page } from '@playwright/test';

/** The portal with no server: Settings → Add-ons, over canned answers for the opt-in features. */
async function portal(page: Page, { reachable = true, available = true } = {}) {
  const sent: { path: string; body: any }[] = [];
  const state = {
    subagent: { available, installed: false, enabled: false, source: null as string | null, mode: 'interrupt', maxParallel: 1 },
    understory: { enabled: false, url: 'http://localhost:3800/mcp', tokenSet: false, adapterInstalled: false, reachable },
  };
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const method = route.request().method();
    let body: unknown = {};
    if (p === '/api/auth/status') body = { authed: true, authRequired: false };
    else if (p === '/api/sessions' && method === 'GET') body = { sessions: [], executor: 'host' };
    else if (p === '/api/settings') body = {
      settings: { provider: 'p', model: 'm', thinkingLevel: 'medium' }, stored: {}, defaults: { provider: 'p', model: 'm', thinkingLevel: 'medium' },
      piSettingsPath: '/a/settings.json', compaction: { keepRecentTokens: 20000 }, compactionDefaults: { keepRecentTokens: 20000 }, contextDefault: null, executor: 'host', workspaceRoot: '/w',
    };
    else if (p === '/api/models') body = { models: [{ provider: 'p', id: 'm', name: 'M', contextWindow: 65536 }], providers: { p: 'p' } };
    else if (p === '/api/extensions') body = { settingsPath: '/a/settings.json', extensions: [] };
    else if (p === '/api/browser') body = { running: false, sessions: [], routines: [], install: { available: false, mode: 'docker', container: 'absent', pulling: { active: false } }, config: {} };
    else if (p === '/api/voice') body = { enabled: false };
    else if (p === '/api/workspaces') body = { root: '/w', workspaces: [] };
    else if (p === '/api/projects') body = { root: '/w', home: '/h', projects: [] };
    else if (p === '/api/features') body = state;
    else if (p === '/api/features/subagent' && method === 'PUT') {
      const patch = route.request().postDataJSON();
      sent.push({ path: p, body: patch });
      if (patch.mode) state.subagent.mode = patch.mode;
      if (patch.maxParallel) state.subagent.maxParallel = patch.maxParallel;
      if (patch.enabled !== undefined) Object.assign(state.subagent, { enabled: patch.enabled, installed: patch.enabled, source: patch.enabled ? '/app/extensions/subagent' : null });
      body = { subagent: state.subagent, reloaded: 1, waiting: 1 };
    } else if (p === '/api/features/understory' && method === 'PUT') {
      const patch = route.request().postDataJSON();
      sent.push({ path: p, body: patch });
      Object.assign(state.understory, { enabled: patch.enabled, adapterInstalled: state.understory.adapterInstalled || patch.enabled, ...(patch.url ? { url: patch.url } : {}) });
      body = { understory: state.understory, reloaded: 0, waiting: 0 };
    }
    await route.fulfill({ json: body });
  });
  await page.addInitScript(() => {
    localStorage.setItem('pithagoras.setup', 'done');
    (window as any).EventSource = class { onmessage: any; onopen: any; onerror: any; addEventListener() {} close() {} };
  });
  return { sent };
}

const addons = (page: Page) => page.getByRole('dialog', { name: 'Settings' });

test('a fresh install has no subagent tool; switching it on installs it, and the mode is its own choice', async ({ page }) => {
  const { sent } = await portal(page);
  await page.goto('/settings/add-ons');
  await addons(page).getByRole('tab', { name: 'Subagents' }).click();
  const tool = addons(page).getByRole('switch', { name: 'Subagent tool' });
  await expect(tool).toHaveAttribute('aria-checked', 'false');
  await expect(addons(page).getByText('Off: the agent has no subagent tool.')).toBeVisible();
  await expect(addons(page).getByRole('radio', { name: /^Interrupt/ })).toBeChecked();

  await tool.click();
  await expect(tool).toHaveAttribute('aria-checked', 'true');
  await expect(addons(page).getByText('Installed as a pi package (/app/extensions/subagent).')).toBeVisible();
  await expect(addons(page).getByText(/one busy chat picks it up/)).toBeVisible();

  await addons(page).getByRole('radio', { name: /^Background/ }).check();
  await expect(addons(page).getByRole('radio', { name: /^Background/ })).toBeChecked();
  expect(sent.map((s) => s.body)).toEqual([{ enabled: true }, { mode: 'background' }]);
  await expect(addons(page).getByText(/two model calls at the same time/)).toBeVisible();
});

test('one subagent at a time unless more are allowed, up and down by one', async ({ page }) => {
  const { sent } = await portal(page);
  await page.goto('/settings/add-ons');
  await addons(page).getByRole('tab', { name: 'Subagents' }).click();
  const at = addons(page).getByRole('group', { name: 'Subagents at once' });
  await expect(at.locator('output')).toHaveText('1');
  await expect(at.getByRole('button', { name: 'Fewer at once' })).toBeDisabled();
  await at.getByRole('button', { name: 'More at once' }).click();
  await expect(at.locator('output')).toHaveText('2');
  await expect(at.getByRole('button', { name: 'Fewer at once' })).toBeEnabled();
  await at.getByRole('button', { name: 'Fewer at once' }).click();
  await expect(at.locator('output')).toHaveText('1');
  expect(sent.map((s) => s.body)).toEqual([{ maxParallel: 2 }, { maxParallel: 1 }]);
});

test('an install without the subagent tool cannot switch it on', async ({ page }) => {
  await portal(page, { available: false });
  await page.goto('/settings/add-ons');
  await addons(page).getByRole('tab', { name: 'Subagents' }).click();
  await expect(addons(page).getByRole('switch', { name: 'Subagent tool' })).toBeDisabled();
  await expect(addons(page).getByText('This install does not carry the subagent tool.')).toBeVisible();
});

test('Understory is off until switched on, then points the agent at the address given and replaces MEMORY.md', async ({ page }) => {
  const { sent } = await portal(page);
  await page.goto('/settings/add-ons');
  await addons(page).getByRole('tab', { name: 'Memory' }).click();
  const memory = addons(page).getByRole('switch', { name: "Use Understory as the agent's memory" });
  await expect(memory).toHaveAttribute('aria-checked', 'false');
  await expect(addons(page).getByText(/Off: the agent's memory is MEMORY\.md\. Switching on also installs pi-mcp-adapter/)).toBeVisible();
  await expect(addons(page).getByText('Something answers there')).toBeVisible();

  await addons(page).getByLabel("Understory's MCP address").fill('http://understory:3800/mcp');
  await memory.click();
  await expect(memory).toHaveAttribute('aria-checked', 'true');
  expect(sent).toEqual([{ path: '/api/features/understory', body: { enabled: true, url: 'http://understory:3800/mcp' } }]);
  await expect(addons(page).getByText(/On: MEMORY\.md is not read while it is/)).toBeVisible();
  await expect(addons(page).getByRole('link', { name: 'Read the memory on the Agent page' })).toHaveAttribute('href', '/agent?tab=memory');

  await memory.click();
  await expect(memory).toHaveAttribute('aria-checked', 'false');
  expect(sent.at(-1)!.body).toEqual({ enabled: false });
});

test('Understory that does not answer is said so before it is switched on', async ({ page }) => {
  await portal(page, { reachable: false });
  await page.goto('/settings/add-ons');
  await addons(page).getByRole('tab', { name: 'Memory' }).click();
  await expect(addons(page).getByText('Nothing answers at http://localhost:3800 — start Understory first')).toBeVisible();
});

test('the four add-on tabs fit a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await portal(page);
  await page.goto('/settings/add-ons');
  const tabs = addons(page).getByRole('tab');
  await expect(tabs).toHaveCount(4);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
  for (const name of ['Browser', 'Voice', 'Subagents', 'Memory']) await expect(addons(page).getByRole('tab', { name })).toBeVisible();
});
