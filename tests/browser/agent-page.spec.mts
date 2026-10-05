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

/** Makes "Ada" with the wizard: the answers are a character and a name. */
async function makeAda(page: Page) {
  await page.goto('/agents');
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'New agent' }).click();
  await main.getByLabel('Name').fill('Ada');
  await main.getByLabel('Character').fill('Brisk, answers in two lines.');
  await main.getByRole('button', { name: 'Next' }).click();
  await main.getByLabel('Your name').fill('Sam');
  await main.getByRole('button', { name: 'Create' }).click();
  return main;
}

test('an agent that took up a folder kept from before says that its answers were not written, once, and can be told to go', async ({ page }) => {
  await portal(page, { kept: ['SOUL.md', 'PrimaryUser.md', 'MEMORY.md'] });
  const main = await makeAda(page);
  const note = main.getByRole('status').filter({ hasText: 'took up a folder that was kept from before' });
  await expect(note).toContainText('SOUL.md, PrimaryUser.md are as they were, so what you answered was not written to them. Edit them under Files.');
  await expect(note).not.toContainText('MEMORY.md');
  await note.getByRole('button', { name: 'Dismiss' }).click();
  await expect(note).toHaveCount(0);
});

test('an agent made in a folder of its own says nothing of the kind, and one that kept only its memory does not either', async ({ page }) => {
  await portal(page, { kept: ['MEMORY.md'] });
  const main = await makeAda(page);
  await expect(main.getByRole('heading', { name: 'Ada' })).toBeVisible();
  await expect(main.getByText('took up a folder that was kept from before')).toHaveCount(0);
});
