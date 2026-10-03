import { test, expect, type Page } from '@playwright/test';

/**
 * The model picker of the composer: which provider a pick goes to, and which
 * chat an answer is drawn for.
 */
const at = new Date().toISOString();
const chat = (id: string, title: string, provider: string, model: string) =>
  ({ id, title, workspace: '/w/site', status: 'idle', kind: 'task', pinned: false, updated_at: at, provider, model, thinking_level: null });
const model = (provider: string, id: string, name = id) => ({ id, name, provider });
const catalogue = [model('prov-a', 'Alpha'), model('prov-a', 'Shared'), model('prov-b', 'Beta'), model('prov-b', 'Shared')];
const config = (current: ReturnType<typeof model>) =>
  ({ live: true, state: { model: current, thinkingLevel: 'medium' }, stats: null, thinking: { levels: ['off', 'medium'] }, models: { models: catalogue }, named: { provider: current.provider, model: current.id } });

type Portal = { posts: unknown[]; failWith: { error: string } | null; hold: { a: Promise<void> | null } };

async function portal(page: Page): Promise<Portal> {
  const state: Portal = { posts: [], failWith: null, hold: { a: null } };
  const sessions = [chat('a', 'First chat', 'prov-a', 'Alpha'), chat('b', 'Second chat', 'prov-b', 'Beta')];
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    const method = route.request().method();
    let reply: unknown = {};
    if (p === '/api/auth/status') reply = { authed: true, authRequired: false };
    else if (p === '/api/sessions') reply = { sessions, executor: 'host' };
    else if (/^\/api\/sessions\/\w+$/.test(p)) reply = sessions.find((s) => p.endsWith('/' + s.id));
    else if (p === '/api/sessions/a/config' && method === 'POST') {
      state.posts.push(route.request().postDataJSON());
      if (state.failWith) return route.fulfill({ status: 500, json: { ...state.failWith, applied: [] } });
      reply = { ok: true, applied: ['model'], state: config(model('prov-b', 'Beta')).state };
    } else if (p === '/api/sessions/a/config') {
      await state.hold.a;
      reply = config(model('prov-a', 'Alpha'));
    } else if (p === '/api/sessions/b/config') reply = config(model('prov-b', 'Beta'));
    else if (p.endsWith('/models')) reply = config(model('prov-a', 'Alpha'));
    else if (p.endsWith('/canvases')) reply = [];
    else if (p === '/api/workspaces') reply = { root: '/w', workspaces: [] };
    else if (p === '/api/models') reply = { models: [], providers: {} };
    await route.fulfill({ json: reply });
  });
  await page.addInitScript(() => {
    localStorage.setItem('pithagoras.setup', 'done');
    (window as any).EventSource = class {
      onopen: any;
      constructor() { setTimeout(() => this.onopen?.(), 0); }
      addEventListener() {}
      close() {}
    };
  });
  return state;
}

const modelPill = (page: Page) => page.locator('.composer-settings button').first();

test('a model of another provider is picked with its provider, and a pick that fails says so in the menu', async ({ page }) => {
  const state = await portal(page);
  await page.goto('/s/a');
  await expect(modelPill(page)).toHaveText('Alpha');
  await modelPill(page).click();
  await page.getByRole('button', { name: 'More models' }).click();
  state.failWith = { error: 'Model not found: prov-a/Beta' };
  await page.getByTitle('Beta', { exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Model not found: prov-a/Beta');
  // The menu stays, so the pick can be made again.
  await expect(page.getByRole('button', { name: 'Refresh models' })).toBeVisible();
  state.failWith = null;
  await page.getByTitle('Beta', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh models' })).toHaveCount(0);
  expect(state.posts).toEqual([{ provider: 'prov-b', modelId: 'Beta' }, { provider: 'prov-b', modelId: 'Beta' }]);
});

test('two providers offering a model of one id are told apart, in what is sent and in what is kept as recent', async ({ page }) => {
  const state = await portal(page);
  await page.goto('/s/a');
  await modelPill(page).click();
  await page.getByRole('button', { name: 'More models' }).click();
  // The second of the two: prov-b's.
  await page.getByTitle('Shared', { exact: true }).nth(1).click();
  await expect(page.getByRole('button', { name: 'Refresh models' })).toHaveCount(0);
  expect(state.posts).toEqual([{ provider: 'prov-b', modelId: 'Shared' }]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pithagoras.recentModels')!))).toEqual(['prov-b/Shared']);
  // Recents kept before they named the provider are bare ids: the first model of that id.
  await page.evaluate(() => localStorage.setItem('pithagoras.recentModels', JSON.stringify(['Shared'])));
  await page.reload();
  await modelPill(page).click();
  const quick = page.locator('.composer-menu button[title]');
  await expect(quick.filter({ hasText: 'Shared' })).toHaveCount(1);
  await expect(quick.filter({ hasText: 'Shared' })).toContainText('prov-a');
});

test("an answer for the chat just left does not draw its model in the chat opened", async ({ page }) => {
  const state = await portal(page);
  let release!: () => void;
  state.hold.a = new Promise<void>((resolve) => { release = resolve; });
  await page.goto('/s/a');
  await page.getByText('Second chat').first().click();
  await expect(page).toHaveURL(/\/s\/b$/);
  await expect(modelPill(page)).toHaveText('Beta');
  // First chat's /config answers late, as it does when pi was starting.
  release();
  await page.waitForTimeout(400);
  await expect(modelPill(page)).toHaveText('Beta');
});
