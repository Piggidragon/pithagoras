import { test, expect, type Page } from '@playwright/test';

const session = { id: 'demo', title: 'Typing a command', workspace: '/workspaces/demo', status: 'idle', kind: 'task', pinned: false };
const commands = [
  { name: 'compact', description: 'Summarise the conversation', source: 'builtin', where: 'server' },
  { name: 'settings', description: 'Open settings', source: 'builtin', where: 'client' },
  { name: 'skill:review', description: 'Review the change', source: 'skill' },
  { name: 'skill:release', description: 'Cut a release', source: 'skill' },
];

/** The portal with no server: one chat with commands, and what is sent to it kept in `prompts`. */
async function portal(page: Page, opts: { listAfter?: Promise<void> } = {}) {
  const prompts: string[] = [];
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    let body: unknown = session;
    if (p === '/api/auth/status') body = { authed: true, authRequired: false };
    else if (p === '/api/sessions') body = { sessions: [session], executor: 'host' };
    else if (p.endsWith('/commands')) {
      await opts.listAfter;
      body = { commands };
    } else if (p.endsWith('/prompt')) {
      prompts.push(route.request().postDataJSON().message);
      body = { ok: true };
    } else if (p.endsWith('/config')) body = { live: false, state: { model: { id: 'test', name: 'Test', provider: 'local' }, thinkingLevel: 'medium' }, stats: null, thinking: { levels: [] }, models: { models: [] } };
    else if (p === '/api/settings') body = { settings: {}, stored: {}, defaults: {}, piSettingsPath: '/a/settings.json', compaction: { keepRecentTokens: 20000 }, compactionDefaults: { keepRecentTokens: 20000 }, contextDefault: null, executor: 'host', workspaceRoot: '/w' };
    else if (p === '/api/models') body = { models: [], providers: {} };
    else if (p === '/api/routines/report-targets') body = { targets: [], default: null };
    else if (p === '/api/extensions') body = { settingsPath: '/a/settings.json', extensions: [] };
    else if (p === '/api/features/flags') body = { subagent: false, understory: false };
    else if (p === '/api/workspaces') body = { root: '/workspaces', workspaces: [] };
    else if (p === '/api/browser') body = { running: false, sessions: [], routines: [] };
    else if (p === '/api/voice') body = { enabled: false };
    else if (p.endsWith('/canvases')) body = [];
    await route.fulfill({ json: body });
  });
  await page.addInitScript(() => {
    (window as any).EventSource = class { onmessage: any; onopen: any; onerror: any; addEventListener() {} close() {} };
    localStorage.setItem('sidebarCollapsed', 'true');
    // No model in this portal: the setup assistant would otherwise open over the chat.
    localStorage.setItem('pithagoras.setup', 'skipped');
  });
  return prompts;
}

const box = (page: Page) => page.getByLabel('Message', { exact: true });
/** Typed and sent with Enter, once the box can take it: the last message has left it, and the send button is back. */
const say = async (page: Page, text: string) => {
  await box(page).fill(text);
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  await box(page).press('Enter');
};
const palette = (page: Page) => page.getByRole('listbox', { name: 'Commands' });

test('the command character is set under This browser, and kept', async ({ page }) => {
  await portal(page);
  await page.goto('/settings/browser');
  const dialog = page.getByRole('dialog');
  const field = dialog.getByLabel('Command character', { exact: true });
  await expect(field).toHaveValue('/');
  await expect(dialog.getByRole('button', { name: 'Reset', exact: true })).toBeDisabled();
  await expect(dialog.getByText('Type / in the message box to see the commands, or /skill:name to run a skill.')).toBeVisible();

  // Typed over the old one.
  await field.fill('!');
  await expect(dialog.getByText('Type ! in the message box to see the commands, or !skill:name to run a skill.')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('commandTrigger'))).toBe('!');
  await expect(dialog.getByRole('button', { name: 'Reset', exact: true })).toBeEnabled();

  // A letter would open the list for every message: said so, and not taken.
  await field.pressSequentially('a');
  await expect(dialog.getByRole('alert')).toContainText('That cannot be it');
  expect(await page.evaluate(() => localStorage.getItem('commandTrigger'))).toBe('!');
  // Left, it shows the one in use again.
  await dialog.getByRole('heading', { name: 'Command character' }).click();
  await expect(field).toHaveValue('!');
  await expect(dialog.getByRole('alert')).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('dialog').getByLabel('Command character', { exact: true })).toHaveValue('!');
  // The shortcuts list says which character jumps to the message box.
  await page.goto('/settings/shortcuts');
  await expect(page.getByRole('list', { name: 'Chat shortcuts' }).getByRole('listitem').first()).toContainText('!');

  await page.goto('/settings/browser');
  await page.getByRole('dialog').getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('Command character', { exact: true })).toHaveValue('/');
  expect(await page.evaluate(() => localStorage.getItem('commandTrigger'))).toBeNull();
});

test('a setting is found by what it does', async ({ page }) => {
  await portal(page);
  await page.goto('/settings/general');
  await page.getByRole('combobox', { name: 'Search settings' }).fill('trigger');
  await page.getByRole('option').first().click();
  await expect(page.getByRole('dialog').getByLabel('Command character', { exact: true })).toBeVisible();
});

test('with the slash as the character, nothing is different', async ({ page }) => {
  const prompts = await portal(page);
  await page.goto('/s/demo');
  await box(page).fill('/skill:rev');
  await expect(palette(page).getByRole('option')).toHaveText([/\/skill:review/]);
  await box(page).press('Enter');
  await expect.poll(() => prompts).toEqual(['/skill:review']);
  // A message that only starts with a path is still one.
  await box(page).fill('/etc/hosts is wrong');
  await expect(palette(page)).toHaveCount(0);
  await say(page, '/etc/hosts is wrong');
  await expect.poll(() => prompts).toEqual(['/skill:review', '/etc/hosts is wrong']);
});

test.describe('with another character', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('commandTrigger', '!'));
  });

  test('it opens the same list, and the slash does not', async ({ page }) => {
    await portal(page);
    await page.goto('/s/demo');
    await box(page).fill('/');
    await page.waitForTimeout(300);
    await expect(palette(page)).toHaveCount(0);

    await box(page).fill('!');
    await expect(palette(page).getByRole('option')).toHaveCount(commands.length);
    await expect(palette(page).getByRole('option').first()).toContainText('!compact');
    await box(page).fill('!skill:');
    await expect(palette(page).getByRole('option')).toHaveText([/!skill:review/, /!skill:release/]);
    // Tab completes it in the same form, ready for what the command takes.
    await box(page).press('Tab');
    await expect(box(page)).toHaveValue('!skill:review ');
  });

  test('the character from anywhere on the page opens the box with the list', async ({ page }) => {
    await portal(page);
    await page.goto('/s/demo');
    await expect(box(page)).toBeVisible();
    await page.keyboard.press('/');
    await expect(box(page)).not.toBeFocused();
    await page.keyboard.press('!');
    await expect(box(page)).toBeFocused();
    await expect(box(page)).toHaveValue('!');
    await expect(palette(page).getByRole('option')).toHaveCount(commands.length);
  });

  test('a skill is sent as pi knows it, from the list and typed out, and a message is still a message', async ({ page }) => {
    const prompts = await portal(page);
    await page.goto('/s/demo');
    await say(page, '!skill:rev');
    await expect.poll(() => prompts).toEqual(['/skill:review']);

    await say(page, '!skill:release the new version\nto everyone');
    await expect.poll(() => prompts).toEqual(['/skill:review', '/skill:release the new version\nto everyone']);

    // The old way still reaches pi as the command it is.
    await say(page, '/compact');
    await expect.poll(() => prompts).toEqual(['/skill:review', '/skill:release the new version\nto everyone', '/compact']);

    // What starts with the character and is no command is said as it was written.
    await say(page, '!important: the build is red');
    await expect.poll(() => prompts.at(-1)).toBe('!important: the build is red');
    expect(prompts).toHaveLength(4);
  });

  test('a command typed before the list has come is waited for, not said to the agent', async ({ page }) => {
    let listed!: () => void;
    const prompts = await portal(page, { listAfter: new Promise<void>((resolve) => (listed = resolve)) });
    await page.goto('/s/demo');
    await say(page, '!skill:review the diff');
    await page.waitForTimeout(300);
    expect(prompts).toEqual([]);
    listed();
    await expect.poll(() => prompts).toEqual(['/skill:review the diff']);
  });

  test('a command that is the portal\'s own is run here, however it is typed', async ({ page }) => {
    const prompts = await portal(page);
    await page.goto('/s/demo');
    await say(page, '!settings');
    // /settings opens the dialog: it is never sent to pi, nor said in the chat.
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(prompts).toEqual([]);
    await expect(box(page)).toHaveValue('');
  });
});
