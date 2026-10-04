import { type Page } from '@playwright/test';
import { test, expect, mockPortal } from './portal-mock';

/**
 * What the first draw has to fetch: the shell and the chat, not the other
 * pages, the shell's terminal emulator, or the dialogs that open over it. (The
 * dev server serves each module as a file of its own, so what was asked for
 * says what the entry reached.)
 */
const at = new Date().toISOString();
const chat = { id: 'a', title: 'Chat A', workspace: '/w/site', status: 'idle', kind: 'task', pinned: false, updated_at: at, created_at: at, provider: null, model: null, thinking_level: null };

async function portal(page: Page) {
  await mockPortal(page, ({ path }) => {
    if (path === '/api/sessions') return { sessions: [chat], executor: 'host' };
    if (/^\/api\/sessions\/\w+$/.test(path)) return chat;
    if (path.endsWith('/config')) return { live: false, state: null, stats: null, thinking: { levels: [] }, models: { models: [] }, named: { provider: null, model: null } };
    if (path.endsWith('/canvases')) return [];
    if (path === '/api/workspaces') return { root: '/w', workspaces: [] };
    if (path === '/api/models') return { models: [], providers: {} };
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
