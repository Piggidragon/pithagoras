import { test, expect, type Page } from '@playwright/test';

async function portal(page: Page, opts: { routine?: Record<string, unknown>; renameFails?: boolean; listFailsAfterRename?: boolean } = {}) {
  const sent: { method: string; path: string; body: any }[] = [];
  const session = { id: 's1', title: 'Old name', workspace: '/w/site', status: 'idle', kind: 'task', pinned: false, updated_at: new Date().toISOString() };
  const other = { ...session, id: 's2', title: 'Other chat', workspace: '/w/notes' };
  const routine = {
    id: 'r1', slug: 'build', name: 'Nightly build', enabled: true, schedule: '0 2 * * *', runAt: null, mode: 'repeats', done: false,
    instructions: 'Build it', freshSession: false, guard: true, browser: false, workspace: null, reportChannel: null, reportTarget: null,
    lastReportAt: null, lastRun: null, lastStatus: null, lastOutput: null, lastMs: null, nextRun: null, createdAt: '', updatedAt: '1',
    workspaceProblem: null, ...opts.routine,
  };
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const method = route.request().method();
    const body = route.request().postDataJSON?.() ?? null;
    if (method !== 'GET') sent.push({ method, path: p, body });
    let reply: unknown = {};
    if (p === '/api/auth/status') reply = { authed: true, authRequired: false };
    else if (p === '/api/sessions' && opts.listFailsAfterRename && sent.some((s) => s.method === 'PATCH')) return route.fulfill({ status: 502, json: { error: 'bad gateway' } });
    else if (p === '/api/sessions') reply = { sessions: [session, other], executor: 'host' };
    else if (p === '/api/sessions/s1' && method === 'PATCH' && opts.renameFails) return route.fulfill({ status: 500, json: { error: 'disk full' } });
    else if (p === '/api/sessions/s1' && method === 'PATCH') { session.title = body.title; reply = session; }
    else if (p === '/api/routines' && method === 'GET') reply = { routines: [routine] };
    else if (p === '/api/routines/r1' && method === 'PATCH') { Object.assign(routine, body, { updatedAt: String(Date.now()) }); reply = routine; }
    else if (p === '/api/routines/r1/sessions') reply = { sessions: [] };
    else if (p === '/api/routines/report-targets') reply = { targets: [], default: null };
    // The routines page offers the agents' homes beside the projects; the first one is Home.
    else if (p === '/api/agents') reply = { agents: [{ id: 'home', name: 'Home', home: '/a', first: true, initialised: true, chats: 0, channels: [], orb: {}, voice: '' }] };
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

test('double-clicking a name on the sessions page renames it, and a single click opens the chat', async ({ page }) => {
  const sent = await portal(page);
  await page.goto('/sessions');
  const name = page.getByRole('main').getByText('Old name', { exact: true });
  await name.dblclick();
  const field = page.getByLabel('Session name');
  await expect(field).toBeVisible();
  expect(page.url()).toContain('/sessions');
  await field.fill('Twice');
  await field.press('Enter');
  await expect.poll(() => sent.find((s) => s.method === 'PATCH')?.body).toEqual({ title: 'Twice' });

  await page.getByRole('main').getByText('Twice', { exact: true }).click();
  await expect(page).toHaveURL(/\/s\/s1$/);
});

test('a rename that fails says so, and the old name comes back', async ({ page }) => {
  await portal(page, { renameFails: true });
  await page.goto('/sessions');
  await page.getByRole('button', { name: 'Rename Old name' }).click();
  const field = page.getByLabel('Session name');
  await field.fill('Never');
  await field.press('Enter');
  await expect(page.getByRole('alert')).toContainText('disk full');
  await expect(page.getByRole('main').getByText('Old name', { exact: true })).toBeVisible();
});

test('a routine whose project has gone says so, and saves another change without a new place', async ({ page }) => {
  const sent = await portal(page, { routine: { workspace: '/w/gone', workspaceProblem: 'workspace does not exist' } });
  await page.goto('/routines');
  await expect(page.getByText('gone (gone)')).toBeVisible();
  await page.getByRole('button', { name: /Nightly build/ }).click();
  const where = page.getByLabel('Where it runs');
  await expect(where).toContainText('gone');
  await expect(page.getByText('/w/gone is not there any more')).toBeVisible();
  await where.click();
  await expect(page.getByRole('option', { name: /gone/ })).toContainText('Not there any more');
  await page.keyboard.press('Escape');

  await page.getByText('Build it').fill('Build it again');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => sent.find((s) => s.method === 'PATCH')?.body?.instructions).toBe('Build it again');
  expect('workspace' in sent.find((s) => s.method === 'PATCH')!.body).toBe(false);
});

test('a folder in a project is shown as a place, not as gone, and the hint does not open the menu', async ({ page }) => {
  await portal(page, { routine: { workspace: '/w/site/docs' } });
  await page.goto('/routines');
  await expect(page.getByText('site/docs', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Nightly build/ }).click();
  await page.getByText('Its runs work in this directory.').click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await page.getByLabel('Where it runs').click();
  const option = page.getByRole('option', { name: /site\/docs/ });
  await expect(option).toContainText('/w/site/docs');
  await expect(option).not.toContainText('Not there any more');
});

test('a click on another row overtakes a click on a name that was waiting for a second one', async ({ page }) => {
  await portal(page);
  await page.goto('/sessions');
  await page.getByRole('main').getByText('Old name', { exact: true }).click();
  await page.getByRole('main').getByText('/w/notes', { exact: true }).click();
  await expect(page).toHaveURL(/\/s\/s2$/);
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(/\/s\/s2$/);
});

test('ending a rename with a click elsewhere in its row does not open the chat', async ({ page }) => {
  const sent = await portal(page);
  await page.goto('/sessions');
  await page.getByRole('button', { name: 'Rename Old name' }).click();
  await page.getByLabel('Session name').fill('Kept here');
  await page.getByRole('main').getByText('/w/site', { exact: true }).click();
  await expect.poll(() => sent.find((s) => s.method === 'PATCH')?.body).toEqual({ title: 'Kept here' });
  await page.waitForTimeout(500);
  expect(page.url()).toMatch(/\/sessions$/);
});

test('a rename that was saved is shown as saved, even when the list then fails to load', async ({ page }) => {
  await portal(page, { listFailsAfterRename: true });
  await page.goto('/sessions');
  await page.getByRole('button', { name: 'Rename Old name' }).click();
  const field = page.getByLabel('Session name');
  await field.fill('Saved anyway');
  await field.press('Enter');
  await expect(page.getByRole('main').getByText('Saved anyway', { exact: true })).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.getByRole('main').getByText('Saved anyway', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a routine\'s switches say what they switch and whether they are on, and its choice of timing is a radio group', async ({ page }) => {
  await portal(page);
  await page.goto('/routines');
  await page.getByRole('button', { name: /Nightly build/ }).click();
  // The one beside the name, and the three rows: each is a switch with its state, not a button.
  await expect(page.getByRole('switch', { name: 'Nightly build' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('switch', { name: /^Injection guard/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('switch', { name: /^Fresh session each run/ })).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('switch', { name: /^Browser/ })).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('switch', { name: /^Fresh session each run/ }).click();
  await expect(page.getByRole('switch', { name: /^Fresh session each run/ })).toHaveAttribute('aria-checked', 'true');
  // The knob moves by the switch's own motion, which is keyed on the track being the switch's child.
  await expect(page.getByRole('switch', { name: /^Fresh session each run/ }).locator('> span > span')).toHaveCount(1);

  const timing = page.getByRole('radiogroup', { name: 'Schedule' });
  await expect(timing.getByRole('radio', { name: 'Repeats' })).toHaveAttribute('aria-checked', 'true');
  await expect(timing.getByRole('radio', { name: 'Once' })).toHaveAttribute('aria-checked', 'false');
  await timing.getByRole('radio', { name: 'Once' }).click();
  await expect(timing.getByRole('radio', { name: 'Once' })).toHaveAttribute('aria-checked', 'true');
});

test('a second save soon after the first keeps its "Saved" for as long as the first had', async ({ page }) => {
  const sent = await portal(page);
  await page.clock.install({ time: new Date('2026-01-01T10:00:00Z') });
  await page.goto('/routines');
  await page.getByRole('button', { name: /Nightly build/ }).click();
  const instructions = page.getByText('Build it');
  await expect(instructions).toBeVisible();
  await page.clock.pauseAt(new Date('2026-01-01T10:00:10Z'));
  // The save is over when its button has stopped spinning.
  const save = page.getByRole('button', { name: /^Save/ });
  const done = async (saves: number) => {
    await expect.poll(() => sent.filter((s) => s.method === 'PATCH').length).toBe(saves);
    await expect(save.locator('svg.animate-spin')).toHaveCount(0);
  };

  await instructions.fill('Build it once');
  await save.click();
  await done(1);
  await expect(save).toHaveText('Saved');
  await page.clock.runFor(1500);

  // Edited and saved again, one and a half seconds after the first.
  await page.locator('textarea').first().fill('Build it twice');
  await save.click();
  await done(2);
  // Two seconds after the first, but only half a second after this one: still said.
  await page.clock.runFor(600);
  await expect(save).toHaveText('Saved');
  await page.clock.runFor(1500);
  await expect(save).toHaveText('Save');
});

test.describe('in a browser set to German', () => {
  test.use({ locale: 'de-DE' });

  test('a one-off a restart cut off is shown as interrupted, not as done', async ({ page }) => {
    await portal(page, {
      routine: {
        name: 'Quarterly numbers', enabled: false, schedule: '', runAt: '2026-10-01T09:00:00.000Z', mode: 'once', done: false,
        lastStatus: 'interrupted', lastOutput: 'The portal restarted during this run', lastRun: '2026-10-01T09:00:01.000Z',
      },
    });
    await page.goto('/routines');
    const row = page.getByRole('button', { name: /Quarterly numbers/ });
    await expect(row).toContainText('unterbrochen');
    await expect(row).toContainText('deaktiviert');
    await expect(row).not.toContainText('fertig');
  });
});
