import { test, expect, type Page } from '@playwright/test';

/**
 * What the first draw has to fetch: the shell and the chat, not the other
 * pages, the shell's terminal emulator, or the dialogs that open over it. (The
 * dev server serves each module as a file of its own, so what was asked for
 * says what the entry reached.)
 */
const at = new Date().toISOString();
const chat = { id: 'a', title: 'Chat A', workspace: '/w/site', status: 'idle', kind: 'task', pinned: false, updated_at: at, created_at: at, provider: null, model: null, thinking_level: null };

async function portal(page: Page) {
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    let reply: unknown = {};
    if (p === '/api/auth/status') reply = { authed: true, authRequired: false };
    else if (p === '/api/sessions') reply = { sessions: [chat], executor: 'host' };
    else if (/^\/api\/sessions\/\w+$/.test(p)) reply = chat;
    else if (p.endsWith('/config')) reply = { live: false, state: null, stats: null, thinking: { levels: [] }, models: { models: [] }, named: { provider: null, model: null } };
    else if (p.endsWith('/canvases')) reply = [];
    else if (p === '/api/workspaces') reply = { root: '/w', workspaces: [] };
    else if (p === '/api/models') reply = { models: [], providers: {} };
    await route.fulfill({ json: reply });
  });
  await page.addInitScript(() => {
    localStorage.setItem('pithagoras.setup', 'done');
    (window as any).EventSource = class { onmessage: any; onopen: any; onerror: any; addEventListener() {} close() {} };
  });
  const files: string[] = [];
  page.on('request', (r) => files.push(new URL(r.url()).pathname));
  return files;
}

const PAGES = /\/components\/(SessionsPage|ProjectsPage|AgentPage|RoutinesPage|AuditPanel|BrowserPage|MemoryPage|ImagesPage|SetupAssistant|TerminalPanel)\.tsx$/;

test('the first draw does not fetch the other pages or the terminal emulator, and a page is fetched when it is opened', async ({ page }) => {
  const files = await portal(page);
  await page.goto('/s/a');
  await expect(page.getByRole('complementary', { name: 'Sidebar' }).getByText('Chat A')).toBeVisible();
  expect(files.filter((f) => PAGES.test(f) || /@xterm/.test(f))).toEqual([]);

  await page.getByRole('button', { name: 'Sessions', exact: true }).first().click();
  await expect(page).toHaveURL(/\/sessions$/);
  await expect(page.getByRole('heading', { name: 'Sessions' }).first()).toBeVisible();
  expect(files.some((f) => /\/components\/SessionsPage\.tsx$/.test(f))).toBe(true);
  // Only that one.
  expect(files.filter((f) => PAGES.test(f))).toHaveLength(1);
});
