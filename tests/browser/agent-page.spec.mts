import { type Page } from '@playwright/test';
import { test, expect, mockPortal } from './portal-mock';
import { DEFAULT_ORB } from '../../server/src/orb-style';

const agent = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, name, home: `/a/${id}`, first: id === 'home', initialised: true, chats: 3, channels: [], orb: DEFAULT_ORB, voice: '', unread: 0, ...extra,
});

/** A portal with the first agent and one more, "ada", whose folder the answers of a new agent made under that name meet. */
async function portal(page: Page, opts: { kept?: string[]; deleted?: string[] } = {}) {
  let made = false;
  await mockPortal(page, async ({ path: p, method, url }) => {
    if (p === '/api/agents' && method === 'GET') return { agents: [agent('home', 'Nova'), ...(made ? [agent('ada', 'Ada', { chats: 3 })] : [agent('ada', 'Ada')])] };
    if (p === '/api/agents' && method === 'POST') {
      made = true;
      return { ...agent('ada', 'Ada'), kept: opts.kept ?? [] };
    }
    if (p === '/api/agents/ada' && method === 'DELETE') {
      opts.deleted?.push(url.search);
      return { ok: true, sessionsDeleted: 3, routinesSwitchedOff: [], routinesDeleted: [], jobsStopped: 1 };
    }
    if (p === '/api/agent/sessions') return { sessions: [], agentHome: '/a/ada' };
    if (/^\/api\/agents\/[^/]+\/setup$/.test(p)) return { initialised: true, home: '/a/ada', files: [] };
  }, { settings: true });
}

const dialog = (page: Page) => page.getByRole('dialog');

test('the delete dialog of an agent says that what runs in its folder is stopped, whichever way the folder goes', async ({ page }) => {
  const deleted: string[] = [];
  await portal(page, { deleted });
  await page.goto('/agents?agent=ada');
  await page.getByRole('button', { name: 'Delete Ada' }).click();
  const text = 'The background jobs running in its folder, a dev server for example, are stopped too, whichever you choose below.';
  await expect(dialog(page)).toContainText('Its 3 chats are stopped and deleted with it.');
  await expect(dialog(page)).toContainText(text);
  // With the folder kept, which is what the dialog starts on, and with it deleted.
  await dialog(page).getByLabel(/Delete its folder too/).check();
  await expect(dialog(page)).toContainText(text);
  await dialog(page).getByLabel(/Keep its folder/).check();
  await dialog(page).getByRole('button', { name: 'Delete agent' }).click();
  await expect.poll(() => deleted).toEqual(['?folder=keep']);
});
