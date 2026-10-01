import { test, expect, type Page } from '@playwright/test';

/**
 * A portal with one project, "demo", and three tools seen. `off` is what the
 * project has off (the portal-wide default has web_fetch off, which the
 * project's answer includes); `puts` is what the page sent.
 */
async function portal(page: Page, opts: { off?: string[]; refuse?: string } = {}) {
  let off = opts.off ?? ['web_fetch'];
  const puts: string[][] = [];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const method = route.request().method();
    let reply: unknown = {};
    if (p === '/api/auth/status') reply = { authed: true, authRequired: false };
    else if (p === '/api/sessions') reply = { sessions: [], executor: 'host' };
    else if (p === '/api/projects') {
      reply = { root: '/w', home: '/h', projects: [{ name: 'demo', path: '/w/demo', isGit: false, hasInstructions: false, hasTools: off.length !== 1 || off[0] !== 'web_fetch', sessions: 0, lastActive: null }] };
    } else if (p === '/api/projects/demo/tools' && opts.refuse) {
      return route.fulfill({ status: 400, json: { error: opts.refuse } });
    } else if (p === '/api/projects/demo/tools' && method === 'PUT') {
      off = route.request().postDataJSON().off;
      puts.push(off);
      reply = { off, applied: 0 };
    } else if (p === '/api/projects/demo/tools') {
      reply = {
        live: false,
        off,
        names: {},
        tools: [
          { name: 'web_search', source: 'pi-web-access', description: 'Search the web', enabled: !off.includes('web_search'), defaultOn: true },
          { name: 'web_fetch', source: 'pi-web-access', enabled: !off.includes('web_fetch'), defaultOn: false },
          { name: 'todo', source: 'pi-todo', enabled: !off.includes('todo'), defaultOn: true },
        ],
      };
    } else if (p === '/api/models') reply = { models: [], providers: {} };
    await route.fulfill({ json: reply });
  });
  await page.addInitScript(() => {
    (window as any).EventSource = class { onmessage: any; onopen: any; onerror: any; addEventListener() {} close() {} };
    localStorage.setItem('pithagoras.setup', 'done');
    localStorage.removeItem('toolGroupsOpen');
  });
  await page.goto('/projects');
  return puts;
}

const dialog = (page: Page) => page.getByRole('dialog');

test('a project has its own tool switches, saved as each is flipped', async ({ page }) => {
  const puts = await portal(page);
  await page.getByRole('button', { name: 'Tools for demo' }).click();
  await expect(dialog(page)).toContainText('Tools · demo');
  await expect(dialog(page)).toContainText('what every chat in this project starts with');

  await dialog(page).getByRole('button', { name: /pi-web-access/ }).click();
  const search = dialog(page).getByRole('checkbox', { name: 'web_search' });
  await expect(search).toBeChecked();
  // Off in the portal-wide default, and not switched on here.
  await expect(dialog(page).getByRole('checkbox', { name: 'web_fetch' })).not.toBeChecked();

  await search.uncheck();
  // The whole picture, as for a chat: the portal-wide default's off tool stays in it.
  await expect.poll(() => puts).toEqual([['web_fetch', 'web_search']]);
  await expect(search).not.toBeChecked();
  await expect(dialog(page).getByText('default on')).toBeVisible();

  // Switching on what the portal-wide default has off is the project's exception.
  await dialog(page).getByRole('checkbox', { name: 'web_fetch' }).check();
  await expect.poll(() => puts).toEqual([['web_fetch', 'web_search'], ['web_search']]);
  await expect(dialog(page).getByText('default off')).toBeVisible();
});

test('a project that switches tools says so on its row, once the list is closed', async ({ page }) => {
  await portal(page);
  await expect(page.getByText('tools', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Tools for demo' }).click();
  await dialog(page).getByRole('button', { name: /pi-todo/ }).click();
  await dialog(page).getByRole('checkbox', { name: 'todo' }).uncheck();
  await expect(dialog(page).getByRole('checkbox', { name: 'todo' })).not.toBeChecked();
  await dialog(page).getByRole('button', { name: 'Close' }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByText('tools', { exact: true })).toBeVisible();
});

test('a deployment that cannot switch tools says why in place of the list', async ({ page }) => {
  await portal(page, { refuse: 'Tools cannot be switched with EXECUTOR=container' });
  await page.getByRole('button', { name: 'Tools for demo' }).click();
  await expect(dialog(page)).toContainText('Tools cannot be switched with EXECUTOR=container');
  await expect(dialog(page).getByRole('checkbox')).toHaveCount(0);
});
