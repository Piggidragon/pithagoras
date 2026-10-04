import { type Locator, type Page } from '@playwright/test';
import { test, expect, mockPortal } from './portal-mock';
import { DEFAULT_ORB } from '../../server/src/orb-style';

/**
 * Escape over a form in Settings that has something typed in and not saved asks
 * first, as the skill and provider editors do; a form that was only opened
 * closes at once. Over canned answers.
 */
async function portal(page: Page, answers: Record<string, unknown>) {
  await mockPortal(page, ({ path }) => answers[path], { settings: true });
}

const settings = (page: Page) => page.getByRole('dialog', { name: 'Settings' });

/** Escape asks, and "Cancel" leaves Settings as it was. */
async function asksBeforeClosing(page: Page, field: Locator, typed: string) {
  await page.keyboard.press('Escape');
  const ask = page.getByRole('alertdialog', { name: 'Discard your changes?' });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await expect(settings(page)).toBeVisible();
  await expect(field).toHaveValue(typed);
}

const MCP = { path: '/a/mcp.json', exists: true, adapterInstalled: true, adapterSpec: 'npm:pi-mcp-adapter', servers: [], settings: {}, raw: '{}', parseError: null };

test('Escape over an MCP server form that was filled in asks first; one that was only opened closes at once', async ({ page }) => {
  await portal(page, { '/api/mcp': MCP });
  await page.goto('/settings/mcp');
  await settings(page).getByRole('button', { name: 'Add server' }).click();
  await page.keyboard.press('Escape');
  await expect(settings(page)).toBeHidden();

  await page.goto('/settings/mcp');
  await settings(page).getByRole('button', { name: 'Add server' }).click();
  const command = settings(page).getByRole('textbox', { name: 'Command' });
  await command.fill('notes-mcp --token abc');
  await asksBeforeClosing(page, command, 'notes-mcp --token abc');
});

test('Escape over a pasted config and over the raw file that were typed in asks first', async ({ page }) => {
  await portal(page, { '/api/mcp': MCP });
  await page.goto('/settings/mcp');
  await settings(page).getByRole('button', { name: 'Paste JSON' }).click();
  const pasted = settings(page).locator('textarea').first();
  await pasted.fill('{"mcpServers":{}}');
  await asksBeforeClosing(page, pasted, '{"mcpServers":{}}');

  await page.goto('/settings/mcp');
  await settings(page).getByRole('button', { name: 'Edit the file directly' }).click();
  const raw = settings(page).getByRole('textbox', { name: 'mcp.json' });
  await raw.fill('{ "mcpServers": { "a": { "command": "x" } } }');
  await asksBeforeClosing(page, raw, '{ "mcpServers": { "a": { "command": "x" } } }');
});

test("Escape over a person's notes that were typed in asks first", async ({ page }) => {
  const kim = { key: 'tg:kim', name: 'Kim', role: 'colleague', notes: '', first_seen: '', last_seen: null, announced_at: null, renamed: 0 };
  await portal(page, { '/api/people': { people: [kim] }, '/api/tool-rules': { rules: [] } });
  await page.goto('/settings/people');
  await settings(page).getByRole('button', { name: /Kim/ }).click();
  await page.keyboard.press('Escape');
  await expect(settings(page)).toBeHidden();

  await page.goto('/settings/people');
  await settings(page).getByRole('button', { name: /Kim/ }).click();
  const notes = settings(page).getByPlaceholder(/Their role, what they work on/);
  await notes.fill('Reviews the pull requests.');
  await asksBeforeClosing(page, notes, 'Reviews the pull requests.');
});

const CHANNEL = {
  id: 'c1', slug: 'ops', kind: 'bot', name: 'Ops bot', enabled: true, config: {}, secretsSet: [], instructions: '', relayProgress: true, relayTools: false,
  agentId: 'home', sessionCount: 0, state: 'running', log: [], created_at: '', updated_at: '1',
};
const CHANNELS = {
  '/api/channels': { channels: [CHANNEL], kinds: [{ id: 'bot', label: 'Chat bot', blurb: 'A bot', fields: [], packageName: 'pi-bot', builtin: true, runnable: true }], broken: [], channelsDir: '/a/channels' },
  '/api/agents': { agents: [{ id: 'home', name: 'Home', home: '/a', first: true, initialised: true, chats: 0, channels: [], orb: DEFAULT_ORB, voice: '', unread: 0 }] },
};

test("Escape over a channel's settings that were changed, and over a channel being added, asks first", async ({ page }) => {
  await portal(page, CHANNELS);
  await page.goto('/settings/channels');
  await settings(page).getByRole('button', { name: /Ops bot/ }).click();
  await page.keyboard.press('Escape');
  await expect(settings(page)).toBeHidden();

  await page.goto('/settings/channels');
  await settings(page).getByRole('button', { name: /Ops bot/ }).click();
  const name = settings(page).getByRole('textbox').first();
  await name.fill('Ops bot, renamed');
  await asksBeforeClosing(page, name, 'Ops bot, renamed');

  await page.goto('/settings/channels');
  await settings(page).getByRole('button', { name: 'Chat bot', exact: true }).click();
  const added = settings(page).getByRole('textbox', { name: 'Name', exact: true });
  await added.fill('A bot of mine');
  await asksBeforeClosing(page, added, 'A bot of mine');
});

test('Escape over a new skill that was begun asks first', async ({ page }) => {
  await portal(page, { '/api/skills': { root: '/agent/skills', skills: [], diagnostics: [] } });
  await page.goto('/settings/skills');
  await settings(page).getByRole('button', { name: '+ New' }).click();
  await page.keyboard.press('Escape');
  await expect(settings(page)).toBeHidden();

  await page.goto('/settings/skills');
  await settings(page).getByRole('button', { name: '+ New' }).click();
  const name = settings(page).getByPlaceholder('cut-a-release');
  await name.fill('release-notes');
  await asksBeforeClosing(page, name, 'release-notes');
});
