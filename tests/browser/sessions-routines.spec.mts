import { test, expect, type Page } from '@playwright/test';

async function portal(page: Page) {
  const sent: { method: string; path: string; body: any }[] = [];
  const session = { id: 's1', title: 'Old name', workspace: '/w/site', status: 'idle', kind: 'task', pinned: false, updated_at: new Date().toISOString() };
  const routine = {
    id: 'r1', slug: 'build', name: 'Nightly build', enabled: true, schedule: '0 2 * * *', runAt: null, mode: 'repeats', done: false,
    instructions: 'Build it', freshSession: false, guard: true, browser: false, workspace: null, reportChannel: null, reportTarget: null,
    lastReportAt: null, lastRun: null, lastStatus: null, lastOutput: null, lastMs: null, nextRun: null, createdAt: '', updatedAt: '1',
  };
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const method = route.request().method();
    const body = route.request().postDataJSON?.() ?? null;
    if (method !== 'GET') sent.push({ method, path: p, body });
    let reply: unknown = {};
    if (p === '/api/auth/status') reply = { authed: true, authRequired: false };
    else if (p === '/api/sessions') reply = { sessions: [session], executor: 'host' };
    else if (p === '/api/sessions/s1' && method === 'PATCH') { session.title = body.title; reply = session; }
    else if (p === '/api/routines' && method === 'GET') reply = { routines: [routine] };
    else if (p === '/api/routines/r1' && method === 'PATCH') { Object.assign(routine, body, { updatedAt: String(Date.now()) }); reply = routine; }
    else if (p === '/api/routines/r1/sessions') reply = { sessions: [] };
    else if (p === '/api/routines/report-targets') reply = { targets: [], default: null };
    else if (p === '/api/workspaces') reply = { root: '/w', workspaces: [{ name: 'site', path: '/w/site', isGit: true }, { name: 'notes', path: '/w/notes', isGit: false }] };
    else if (p === '/api/models') reply = { models: [{ provider: 'x', id: 'm', name: 'M', reasoning: false }], providers: {} };
    await route.fulfill({ json: reply });
  });
  await page.addInitScript(() => {
    (window as any).EventSource = class { onmessage: any; onopen: any; onerror: any; addEventListener() {} close() {} };
    localStorage.setItem('pithagoras.setup', 'done');
  });
  return sent;
}

test('a session is renamed from the sessions page', async ({ page }) => {
  const sent = await portal(page);
  await page.goto('/sessions');
  await page.getByRole('button', { name: 'Rename Old name' }).click();
  const field = page.getByLabel('Session name');
  await field.fill('New name');
  await field.press('Enter');
  await expect.poll(() => sent.find((s) => s.method === 'PATCH')?.body).toEqual({ title: 'New name' });
  await expect(page.getByRole('main').getByText('New name')).toBeVisible();
  expect(page.url()).toContain('/sessions');
});

test('a routine is moved from Home into a project', async ({ page }) => {
  const sent = await portal(page);
  await page.goto('/routines');
  await expect(page.getByText('Home', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Nightly build/ }).click();
  const where = page.getByLabel('Where it runs');
  await expect(where).toContainText('Home');
  await where.click();
  await page.getByRole('option', { name: /site/ }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => sent.find((s) => s.method === 'PATCH')?.body?.workspace).toBe('/w/site');
});
