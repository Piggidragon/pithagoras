import { test, expect, type Page } from '@playwright/test';
import { createEventBus } from '@earendil-works/pi-coding-agent';
import { bridgeScreens } from '../../server/src/screens.ts';
import { fakePi, todoExtension, todoGlue } from '../fixtures/todo-extension.mts';

/**
 * A todo-list extension, from its data to the page: the extension and its glue
 * run as pi would run them, the portal's own bridge takes what they say on the
 * event bus, and the chat draws it. Only the stream between is the test's: what
 * the bridge emits is delivered to the page as a live event, and what it keeps
 * is what the page is answered when it asks the portal for the chat's state —
 * or nothing, where the test is about what the events alone bring.
 */
async function chat(page: Page, { asked = true } = {}) {
  const events = createEventBus();
  const sent: any[] = [];
  const bridge = bridgeScreens(events, (e) => sent.push(e));
  const pi = fakePi(events);
  todoExtension(pi.api);
  todoGlue(pi.api);
  await page.route('**/api/sessions/*/background', (route) =>
    asked
      ? route.fulfill({ json: { supported: true, jobs: [], statuses: [], widgets: [], screens: bridge.list(), piRunning: true } })
      : route.abort(),
  );
  return {
    pi,
    /** The page opens, and asks the portal what there is, as a chat opened later does. */
    async open() {
      await page.goto('/tests/chat.html?phase=screens');
      await expect(page.getByRole('heading', { name: 'Fix the build' })).toBeVisible();
    },
    /** What the extension said since, delivered as the stream would. */
    async deliver() {
      const live = sent.splice(0);
      await page.evaluate((list) => list.forEach((e) => (window as any).emitLive(e.type, e)), live);
      return live.length;
    },
  };
}

test('a todo list shows up from its extension\'s data, and follows it', async ({ page }) => {
  // The portal is not asked, or not answered: all the page has is what it was told as it happened.
  const c = await chat(page, { asked: false });
  await c.open();
  await expect(page.getByRole('button', { name: 'Screens' })).toHaveCount(0);

  await c.pi.start();
  await c.pi.call('todo', { action: 'add', text: 'Write the docs' });
  await c.pi.call('todo', { action: 'add', text: 'Ship it', after: 1 });
  await c.pi.call('todo', { action: 'start', id: 1 });
  expect(await c.deliver()).toBe(3);
  // Said live: the page was never told to look again, and it already has it.
  await page.getByRole('button', { name: 'Screens' }).click();
  const todos = page.getByRole('region', { name: 'Todos' });
  await expect(todos.getByRole('heading', { name: 'Todos' })).toBeVisible();
  await expect(todos.getByText('0 of 2')).toBeVisible();
  const docs = todos.getByRole('listitem').filter({ hasText: 'Write the docs' });
  const ship = todos.getByRole('listitem').filter({ hasText: 'Ship it' });
  await expect(docs).toContainText('In progress');
  await expect(ship).toContainText('Waiting');
  await expect(ship).toContainText('after #1');

  await c.pi.call('todo', { action: 'complete', id: 1 });
  await c.pi.call('todo', { action: 'complete', id: 2 });
  await c.deliver();
  await expect(todos.getByText('2 of 2')).toBeVisible();
  await expect(docs).toContainText('Done');
  await expect(docs.getByText('Write the docs')).toHaveCSS('text-decoration-line', 'line-through');
  await expect(ship).toContainText('Done');
});

test('a chat opened while its list is there shows it from what the portal answers', async ({ page }) => {
  const c = await chat(page);
  await c.pi.start();
  await c.pi.call('todo', { action: 'add', text: 'Write the docs' });
  await c.open();
  await page.getByRole('button', { name: 'Screens' }).click();
  await expect(page.getByRole('region', { name: 'Todos' }).getByText('Write the docs')).toBeVisible();
});

test('the screen goes when the extension takes it away, and the panel says there is nothing', async ({ page }) => {
  const c = await chat(page);
  await c.pi.start();
  await c.pi.call('todo', { action: 'add', text: 'Write the docs' });
  await c.open();
  await page.getByRole('button', { name: 'Screens' }).click();
  await expect(page.getByRole('region', { name: 'Todos' })).toBeVisible();
  await c.pi.shutdown();
  await c.deliver();
  await expect(page.getByRole('region', { name: 'Todos' })).toHaveCount(0);
  await expect(page.getByText('Nothing is shown here.')).toBeVisible();
});

test('the blocks compose, and what the page does not know is said rather than breaking the screen', async ({ page }) => {
  const c = await chat(page, { asked: false });
  await c.open();
  await page.evaluate(() =>
    (window as any).emitLive('portal_screen', {
      op: 'set',
      id: 'mixed',
      title: 'Release',
      blocks: [
        { type: 'text', text: 'Cutting 1.2', tone: 'warn' },
        { type: 'status', label: 'Build', text: 'green', tone: 'ok' },
        { type: 'group', title: 'Steps', blocks: [
          { type: 'list', ordered: true, items: ['Bump the version', { text: 'Tag it', detail: 'v1.2.0' }] },
          { type: 'checklist', items: [{ text: 'Changelog', state: 'done', items: [{ text: 'Breaking changes' }] }] },
          { type: 'list', items: [], empty: 'No notes yet.' },
        ] },
        { type: 'sparkline', values: [1, 2] },
        { type: 'text' },
      ],
    }),
  );
  await page.getByRole('button', { name: 'Screens' }).click();
  const screen = page.getByRole('region', { name: 'Release' });
  await expect(screen.getByText('Cutting 1.2')).toBeVisible();
  await expect(screen.getByText('green')).toBeVisible();
  await expect(screen.getByRole('heading', { name: 'Steps' })).toBeVisible();
  await expect(screen.getByRole('listitem').filter({ hasText: 'Tag it' })).toContainText('2.');
  await expect(screen.getByRole('listitem').filter({ hasText: 'Tag it' })).toContainText('v1.2.0');
  // An item held by an item is drawn under it.
  await expect(screen.getByRole('listitem').filter({ hasText: 'Breaking changes' }).last()).toContainText('To do');
  await expect(screen.getByText('No notes yet.')).toBeVisible();
  await expect(screen.getByText('Not a block this page knows: sparkline')).toBeVisible();
});
