import { test, expect, type Page } from '@playwright/test';

const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const chat = (id: string, title: string, workspace: string, minutesAgo: number, extra: Record<string, unknown> = {}) =>
  ({ id, title, workspace, status: 'idle', kind: 'task', pinned: false, updated_at: at(minutesAgo), created_at: at(minutesAgo), ...extra });

const HOME = '/data/agent';

/** A portal with chats in Home, in the projects site and notes, and none in the project empty. */
async function portal(page: Page, sessions = [
  chat('h1', 'Home chat', HOME, 30),
  chat('s1', 'Site chat', '/w/site', 5),
  chat('s2', 'Site docs chat', '/w/site/docs', 50),
  chat('n1', 'Notes chat', '/w/notes', 10),
  chat('p1', 'Pinned chat', '/w/notes', 60, { pinned: true }),
]) {
  const sent: { method: string; path: string; body: any }[] = [];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const method = route.request().method();
    const body = route.request().postDataJSON?.() ?? null;
    if (method !== 'GET') sent.push({ method, path: p, body });
    let reply: unknown = {};
    if (p === '/api/auth/status') reply = { authed: true, authRequired: false };
    else if (p === '/api/sessions' && method === 'GET') reply = { sessions, executor: 'host' };
    else if (p === '/api/sessions' && method === 'POST') reply = chat('new', 'New chat', body?.workspace ?? HOME, 0);
    else if (p === '/api/projects') reply = {
      root: '/w', home: HOME,
      projects: ['site', 'notes', 'empty'].map((name) => ({ name, path: `/w/${name}`, isGit: false, hasInstructions: false, sessions: 0, lastActive: null })),
    };
    else if (p === '/api/models') reply = { models: [{ provider: 'x', id: 'm', name: 'M', reasoning: false }], providers: {} };
    await route.fulfill({ json: reply });
  });
  await page.addInitScript(() => {
    (window as any).EventSource = class { onmessage: any; onopen: any; onerror: any; addEventListener() {} close() {} };
    localStorage.setItem('pithagoras.setup', 'done');
  });
  return sent;
}

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Sidebar' });
const folder = (scope: ReturnType<Page['locator']>, name: string) => scope.getByRole('button', { name, exact: true });
/** The folders' names, top to bottom. */
const folderNames = (scope: ReturnType<Page['locator']>) =>
  scope.locator('[data-folder] button[aria-expanded]').allInnerTexts().then((names) => names.map((n) => n.trim()));

test('the sidebar gathers the chats by folder, and remembers which are open', async ({ page }) => {
  await portal(page);
  await page.goto('/sessions');
  const side = sidebar(page);
  // Pinned chats keep their place at the top; the folders hold the rest.
  await expect(side.getByText('Pinned', { exact: true })).toBeVisible();
  await expect(folder(side, 'Home')).toHaveAttribute('aria-expanded', 'true');
  await expect(side.getByRole('group', { name: 'Home' }).getByText('Home chat')).toBeVisible();
  await expect(folder(side, 'site')).toHaveAttribute('aria-expanded', 'false');
  await expect(side.getByText('Site chat')).toHaveCount(0);

  await folder(side, 'site').click();
  const site = side.getByRole('group', { name: 'site' });
  // A chat in a project's subfolder is the project's.
  await expect(site.getByText('Site chat')).toBeVisible();
  await expect(site.getByText('Site docs chat')).toBeVisible();
  await expect(side.getByRole('group', { name: 'notes' })).toHaveCount(0);
  await folder(side, 'Home').click();
  await expect(side.getByText('Home chat')).toHaveCount(0);

  await page.reload();
  await expect(folder(side, 'site')).toHaveAttribute('aria-expanded', 'true');
  await expect(folder(side, 'Home')).toHaveAttribute('aria-expanded', 'false');
  // An empty project is there to start a chat in.
  await folder(side, 'empty').click();
  await expect(side.getByRole('group', { name: 'empty' }).getByText('No chats yet.')).toBeVisible();
});

test('the folder of the chat opened is opened', async ({ page }) => {
  await portal(page);
  await page.goto('/s/n1');
  await expect(folder(sidebar(page), 'notes')).toHaveAttribute('aria-expanded', 'true');
  await expect(sidebar(page).getByRole('group', { name: 'notes' }).getByText('Notes chat')).toBeVisible();
});

test('the folders are sorted, moved by hand, and the order is kept, in the sidebar and on the Sessions page', async ({ page }) => {
  await portal(page);
  await page.goto('/sessions');
  const side = sidebar(page);
  const main = page.getByRole('main');
  // Latest first: site's chat moved last, then notes', then Home's; empty has none.
  await expect.poll(() => folderNames(side)).toEqual(['site', 'notes', 'Home', 'empty']);
  await expect.poll(() => folderNames(main)).toEqual(['site', 'notes', 'Home', 'empty']);

  await side.getByRole('combobox', { name: 'Order of the folders' }).click();
  await page.getByRole('option', { name: 'By name' }).click();
  await expect.poll(() => folderNames(side)).toEqual(['Home', 'empty', 'notes', 'site']);
  await expect.poll(() => folderNames(main)).toEqual(['Home', 'empty', 'notes', 'site']);

  // With the keys: Alt and an arrow on the folder's name, which keeps the focus.
  await folder(side, 'site').focus();
  await page.keyboard.press('Alt+ArrowUp');
  await expect.poll(() => folderNames(side)).toEqual(['Home', 'empty', 'site', 'notes']);
  await expect(folder(side, 'site')).toBeFocused();
  await expect(side.getByRole('combobox', { name: 'Order of the folders' })).toContainText('Your order');

  // By its grip: carried above Home.
  const grip = side.locator('[data-folder="project:notes"] .folder-grip');
  await folder(side, 'notes').hover();
  const from = await grip.boundingBox();
  const to = await folder(side, 'Home').boundingBox();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(from!.x + 4, from!.y - 10, { steps: 3 });
  await page.mouse.move(to!.x + 10, to!.y + 2, { steps: 5 });
  await expect(side.locator('.folder-drop')).toHaveCount(1);
  await page.mouse.up();
  await expect.poll(() => folderNames(side)).toEqual(['notes', 'Home', 'empty', 'site']);
  await expect.poll(() => folderNames(main)).toEqual(['notes', 'Home', 'empty', 'site']);

  await page.reload();
  await expect.poll(() => folderNames(side)).toEqual(['notes', 'Home', 'empty', 'site']);
  await expect.poll(() => folderNames(main)).toEqual(['notes', 'Home', 'empty', 'site']);
});

test('a folder on the Sessions page is shown on its own, and the link keeps it', async ({ page }) => {
  await portal(page);
  await page.goto('/sessions');
  const main = page.getByRole('main');
  // All open here: there is room.
  await expect(main.getByRole('group', { name: 'Home' }).getByText('Home chat')).toBeVisible();
  await expect(main.getByRole('group', { name: 'notes' }).getByText('Pinned chat')).toBeVisible();
  await folder(main, 'site').hover();
  await main.getByRole('button', { name: 'Only site' }).click();
  await expect(page).toHaveURL(/\/sessions\?folder=project%3Asite$/);
  await expect(main.getByText('Only site')).toBeVisible();
  await expect(main.getByText('Site chat')).toBeVisible();
  await expect(main.getByText('Site docs chat')).toBeVisible();
  await expect(main.getByText('Home chat')).toHaveCount(0);
  await expect(main.getByText('Notes chat')).toHaveCount(0);

  await page.reload();
  await expect(main.getByText('Only site')).toBeVisible();
  await expect(main.getByText('Home chat')).toHaveCount(0);
  await main.getByRole('button', { name: 'Show every folder' }).click();
  await expect(page).toHaveURL(/\/sessions$/);
  await expect(main.getByText('Home chat')).toBeVisible();
});

test('a folder with more chats than the sidebar shows opens on its own on the Sessions page', async ({ page }) => {
  const many = Array.from({ length: 11 }, (_, i) => chat(`s${i}`, `Site chat ${i}`, '/w/site', i + 1));
  await portal(page, [chat('h1', 'Home chat', HOME, 30), ...many]);
  await page.goto('/sessions');
  const side = sidebar(page);
  await folder(side, 'site').click();
  await expect(side.getByRole('group', { name: 'site' }).getByText(/^Site chat \d+$/)).toHaveCount(8);
  await side.getByRole('button', { name: '3 more in site…' }).click();
  await expect(page).toHaveURL(/folder=project%3Asite/);
  await expect(page.getByRole('main').getByText(/^Site chat \d+$/)).toHaveCount(11);
  await expect(page.getByRole('main').getByText('Home chat')).toHaveCount(0);
});

test('a chat is started in a folder from its line', async ({ page }) => {
  const sent = await portal(page);
  await page.goto('/sessions');
  const side = sidebar(page);
  await folder(side, 'empty').hover();
  await side.getByRole('button', { name: 'New chat in empty' }).click();
  await expect.poll(() => sent.find((s) => s.method === 'POST' && s.path === '/api/sessions')?.body).toEqual({ workspace: '/w/empty' });
  await expect(page).toHaveURL(/\/s\/new$/);
  sent.length = 0;
  await page.goto('/sessions');
  await folder(side, 'Home').hover();
  await side.getByRole('button', { name: 'New chat in Home' }).click();
  // Home is where a chat starts without one.
  await expect.poll(() => sent.find((s) => s.method === 'POST' && s.path === '/api/sessions')?.body ?? null).toEqual({});
});

test('the chats can be listed together again, as they were', async ({ page }) => {
  await portal(page);
  await page.goto('/sessions');
  const side = sidebar(page);
  await side.getByRole('button', { name: 'List the chats together' }).click();
  await expect(side.getByText('Recents', { exact: true })).toBeVisible();
  await expect(side.locator('[data-folder]')).toHaveCount(0);
  await expect(side.getByText('Site docs chat')).toBeVisible();
  // The Sessions page lists them the same way.
  await expect(page.getByRole('main').locator('[data-folder]')).toHaveCount(0);
  await page.reload();
  await expect(side.getByText('Recents', { exact: true })).toBeVisible();
  await side.getByRole('button', { name: 'Group the chats by folder' }).click();
  await expect(folder(side, 'Home')).toBeVisible();
});

test('searching the sidebar shows the folders with a match, open', async ({ page }) => {
  const many = Array.from({ length: 12 }, (_, i) => chat(`h${i}`, `Home chat ${i}`, HOME, i + 1));
  await portal(page, [...many, chat('s1', 'Deploy the site', '/w/site', 40)]);
  await page.goto('/sessions');
  const side = sidebar(page);
  await expect(folder(side, 'site')).toHaveAttribute('aria-expanded', 'false');
  await side.getByLabel('Search chats').fill('deploy');
  await expect(side.locator('[data-folder]')).toHaveCount(1);
  await expect(side.getByRole('group', { name: 'site' }).getByText('Deploy the site')).toBeVisible();
  await side.getByLabel('Search chats').fill('');
  await expect(folder(side, 'site')).toHaveAttribute('aria-expanded', 'false');
});

test('without projects the sidebar lists the chats as before', async ({ page }) => {
  await portal(page, [chat('h1', 'Home chat', HOME, 30)]);
  // Asked after the portal's, so heard first.
  await page.route('**/api/projects', (route) => route.fulfill({ json: { root: '/w', home: HOME, projects: [] } }));
  await page.goto('/sessions');
  const side = sidebar(page);
  await expect(side.getByText('Recents', { exact: true })).toBeVisible();
  await expect(side.locator('[data-folder]')).toHaveCount(0);
  await expect(side.getByRole('button', { name: 'Group the chats by folder' })).toHaveCount(0);
});
