import { test, expect, type Page } from '@playwright/test';

const session = { id: 'demo', title: 'Connecting a screen', workspace: '/workspaces/demo', status: 'idle', kind: 'task', pinned: false };
const commands = [
  { name: 'compact', description: 'Summarise the conversation', source: 'builtin', where: 'server' },
  { name: 'screen', description: 'Connect an extension to a screen', source: 'prompt', argumentSource: 'extensions' },
  { name: 'skill:review', description: 'Review the change', source: 'skill' },
];
/** What the portal answers for the extensions that are on: sorted as it sorts them, and without the inactive one (see server/test/extension-choices.test.mjs). */
const extensions = [
  { value: '@acme/board-todo', detail: 'npm:@acme/board-todo', notes: ['screen'] },
  { value: 'acme-notes', detail: 'npm:acme-notes', notes: [] },
  { value: 'lookup', detail: '/workspaces/demo/.pi/extensions/lookup.ts', notes: ['project'] },
  { value: 'web-board', detail: 'git:github.com/acme/web-board', notes: [] },
];

/** The portal with no server: one chat with the commands, what is sent to it kept in `prompts`, and how often the extensions were asked for in `asked`. */
async function portal(page: Page, opts: { choices?: unknown[]; listAfter?: Promise<void> } = {}) {
  const prompts: string[] = [];
  const asked: string[] = [];
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    let body: unknown = session;
    if (p === '/api/auth/status') body = { authed: true, authRequired: false };
    else if (p === '/api/sessions') body = { sessions: [session], executor: 'host' };
    else if (p.endsWith('/commands')) body = { commands };
    else if (p.includes('/arguments/')) {
      asked.push(p.split('/arguments/')[1]);
      await opts.listAfter;
      body = { choices: opts.choices ?? extensions };
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
    (window as any).EventSource = class {
      onmessage: any; onopen: any; onerror: any;
      constructor() { setTimeout(() => this.onopen?.(), 0); }
      addEventListener() {}
      close() {}
    };
    localStorage.setItem('sidebarCollapsed', 'true');
    // No model in this portal: the setup assistant would otherwise open over the chat.
    localStorage.setItem('pithagoras.setup', 'skipped');
  });
  return { prompts, asked };
}

const box = (page: Page) => page.getByLabel('Message', { exact: true });
const suggestions = (page: Page) => page.getByRole('listbox', { name: 'Suggestions' });
const commandList = (page: Page) => page.getByRole('listbox', { name: 'Commands' });
const values = (page: Page) => suggestions(page).getByRole('option').locator('span.font-mono').allTextContents();

test('every extension that is on is offered right behind the command, with what says which have a screen', async ({ page }) => {
  const { asked } = await portal(page);
  await page.goto('/s/demo');
  // Typed as it is, so the command list is shown on the way and then gives way to the suggestions.
  await box(page).pressSequentially('/screen');
  await expect(commandList(page).getByRole('option')).toHaveCount(1);
  await box(page).press('Space');
  await expect(commandList(page)).toHaveCount(0);
  await expect(suggestions(page).getByRole('option')).toHaveCount(extensions.length);
  expect(await values(page)).toEqual(extensions.map((e) => e.value));
  await expect(suggestions(page).getByRole('option').first()).toContainText('npm:@acme/board-todo');
  // The mark is a label, in the words of the page, on the ones that have one and the one the chat's project brings.
  await expect(suggestions(page).getByRole('option').nth(0)).toContainText('has a screen');
  await expect(suggestions(page).getByRole('option').nth(1)).not.toContainText('has a screen');
  await expect(suggestions(page).getByRole('option').nth(2)).toContainText('this project');
  expect(asked).toEqual(['extensions']);
});

test('a draft that already holds the command and a word is suggested for too', async ({ page }) => {
  await portal(page);
  await page.goto('/s/demo');
  await box(page).fill('/screen acme');
  await expect.poll(() => values(page)).toEqual(['acme-notes', '@acme/board-todo']);
});

test('what is typed narrows the list: the start first, then what has it inside, and nothing is none', async ({ page }) => {
  await portal(page);
  await page.goto('/s/demo');
  await box(page).fill('/screen board');
  await expect.poll(() => values(page)).toEqual(['@acme/board-todo', 'web-board']);
  await box(page).fill('/screen WEB');
  await expect.poll(() => values(page)).toEqual(['web-board']);
  await box(page).fill('/screen zzz');
  await expect(suggestions(page)).toHaveCount(0);
  // A second word is the command's own, whatever it is.
  await box(page).fill('/screen acme and more');
  await expect(suggestions(page)).toHaveCount(0);
});

test('the arrows move through the list and wrap, and Enter puts the lit one in the box, ready to be sent', async ({ page }) => {
  const { prompts } = await portal(page);
  await page.goto('/s/demo');
  await box(page).fill('/screen ');
  const options = suggestions(page).getByRole('option');
  await expect(options.first()).toHaveAttribute('aria-selected', 'true');
  await box(page).press('ArrowDown');
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
  await box(page).press('ArrowUp');
  await box(page).press('ArrowUp');
  // Wrapped to the last.
  await expect(options.nth(extensions.length - 1)).toHaveAttribute('aria-selected', 'true');
  await box(page).press('ArrowUp');
  await box(page).press('ArrowUp');
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
  await box(page).press('Enter');
  await expect(box(page)).toHaveValue('/screen acme-notes');
  // Nothing was sent by it, and nothing is left to suggest: the next Enter is the message.
  expect(prompts).toEqual([]);
  await expect(suggestions(page)).toHaveCount(0);
  await box(page).press('Enter');
  await expect.poll(() => prompts).toEqual(['/screen acme-notes']);
});

test('Tab puts the lit one in the box as Enter does', async ({ page }) => {
  const { prompts } = await portal(page);
  await page.goto('/s/demo');
  await box(page).fill('/screen web');
  await expect.poll(() => values(page)).toEqual(['web-board']);
  await box(page).press('Tab');
  await expect(box(page)).toHaveValue('/screen web-board');
  expect(prompts).toEqual([]);
});

test('Escape puts the list away until something else is typed, and the message is then what was typed', async ({ page }) => {
  const { prompts } = await portal(page);
  await page.goto('/s/demo');
  await box(page).fill('/screen acme');
  await expect(suggestions(page).getByRole('option')).toHaveCount(2);
  await box(page).press('Escape');
  await expect(suggestions(page)).toHaveCount(0);
  await expect(box(page)).toHaveValue('/screen acme');
  // Typing more brings it back, for what is typed now.
  await box(page).pressSequentially('-');
  await expect.poll(() => values(page)).toEqual(['acme-notes']);
  await box(page).press('Backspace');
  await expect(suggestions(page).getByRole('option')).toHaveCount(2);
  await box(page).press('Escape');
  await box(page).press('Enter');
  await expect.poll(() => prompts).toEqual(['/screen acme']);
});

test('a click picks one, and what it picks is the same as Enter would', async ({ page }) => {
  await portal(page);
  await page.goto('/s/demo');
  await box(page).fill('/screen ');
  await suggestions(page).getByRole('option').nth(3).click();
  await expect(box(page)).toHaveValue('/screen web-board');
  await expect(suggestions(page)).toHaveCount(0);
  await expect(box(page)).toBeFocused();
});

test('a command that takes nothing in particular is not suggested for, and asks for nothing', async ({ page }) => {
  const { asked } = await portal(page);
  await page.goto('/s/demo');
  await box(page).fill('/compact ');
  await page.waitForTimeout(300);
  await expect(suggestions(page)).toHaveCount(0);
  await box(page).fill('/skill:review th');
  await box(page).fill('/etc hosts');
  await page.waitForTimeout(300);
  await expect(suggestions(page)).toHaveCount(0);
  expect(asked).toEqual([]);
});

test('with no extension on there is no list, and the command is sent as typed', async ({ page }) => {
  const { prompts } = await portal(page, { choices: [] });
  await page.goto('/s/demo');
  await box(page).fill('/screen ');
  await expect.poll(() => commandList(page).count()).toBe(0);
  await page.waitForTimeout(300);
  await expect(suggestions(page)).toHaveCount(0);
  await box(page).fill('/screen some-extension');
  await box(page).press('Enter');
  await expect.poll(() => prompts).toEqual(['/screen some-extension']);
});

test('the list is not shown before the portal has answered, and then it is', async ({ page }) => {
  let answered!: () => void;
  await portal(page, { listAfter: new Promise<void>((resolve) => (answered = resolve)) });
  await page.goto('/s/demo');
  await box(page).fill('/screen ');
  await page.waitForTimeout(300);
  await expect(suggestions(page)).toHaveCount(0);
  answered();
  await expect(suggestions(page).getByRole('option')).toHaveCount(extensions.length);
});

test.describe('with another character', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('commandTrigger', '!'));
  });

  test('the suggestions come after it, the value is put in the same form, and pi is sent the slash', async ({ page }) => {
    const { prompts } = await portal(page);
    await page.goto('/s/demo');
    await box(page).fill('!screen ');
    await expect(suggestions(page).getByRole('option')).toHaveCount(extensions.length);
    await box(page).press('ArrowDown');
    await box(page).press('Tab');
    await expect(box(page)).toHaveValue('!screen acme-notes');
    await box(page).press('Enter');
    await expect.poll(() => prompts).toEqual(['/screen acme-notes']);
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 640 }, hasTouch: true });

  test('a long name stays inside the screen, the list scrolls, and a tap picks', async ({ page }) => {
    const long = '@acme/a-very-long-scoped-package-name-that-would-push-a-row-wider-than-a-phone-if-it-were-let-to';
    const many = [{ value: long, detail: `npm:${long}`, notes: ['screen', 'project'] }, ...Array.from({ length: 14 }, (_, i) => ({ value: `ext-${String(i).padStart(2, '0')}`, detail: `npm:ext-${i}`, notes: [] }))];
    const { prompts } = await portal(page, { choices: many });
    await page.goto('/s/demo');
    await box(page).fill('/screen ');
    const list = suggestions(page);
    await expect(list.getByRole('option')).toHaveCount(many.length);
    const fits = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
    expect(fits.scroll).toBeLessThanOrEqual(fits.width);
    const rect = await list.boundingBox();
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(390);
    // Taller than it is allowed to be, so it scrolls, and the ones beyond the edge are reached.
    expect(await list.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
    expect(rect!.height).toBeLessThanOrEqual(640 * 0.35 + 1);
    const last = list.getByRole('option').last();
    await last.scrollIntoViewIfNeeded();
    await last.tap();
    await expect(box(page)).toHaveValue('/screen ext-13');
    await expect(list).toHaveCount(0);
    await box(page).press('Enter');
    await expect.poll(() => prompts).toEqual(['/screen ext-13']);
  });
});
