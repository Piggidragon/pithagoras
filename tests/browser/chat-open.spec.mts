import { test, expect, type Page } from '@playwright/test';

/**
 * Opening a chat: the stream it keeps open, and the effort pill it draws
 * before anything has answered.
 */
const ornith = { id: 'Ornith1.5-35b', name: 'Ornith 1.5 35B', provider: 'llama-swap' };
const qwen = { id: 'Qwen3.8-27b', name: 'Qwen 3.8 27B', provider: 'llama-swap' };
const ALL = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const config = (model: typeof ornith, levels: string[], named: { provider: string | null; model: string | null } = { provider: null, model: null }, models = [ornith, qwen]) =>
  ({ live: false, state: { model, thinkingLevel: 'medium' }, stats: null, thinking: { levels }, models: { models }, named });

async function portal(page: Page, opts: { streamsOpen?: boolean } = {}) {
  const at = new Date().toISOString();
  const chat = (id: string, title: string, provider: string | null = null) =>
    ({ id, title, workspace: '/w/site', status: 'idle', kind: 'task', pinned: false, updated_at: at, provider, model: null, thinking_level: null });
  const sessions = [
    chat('a', 'First chat'), chat('b', 'Second chat'),
    // Naming a provider and no model: the default model, run there.
    chat('c', 'Third chat', 'llama-swap'), chat('c2', 'Fourth chat', 'llama-swap'),
    chat('d', 'Fifth chat'), chat('e', 'Sixth chat'),
  ];
  /** Whether a model was picked for chat a, which is then its own and no longer the default. */
  let picked = false;
  /** Every GET, by path, and how often. */
  const asked: Record<string, number> = {};
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (method === 'GET') asked[p] = (asked[p] ?? 0) + 1;
    let reply: unknown = {};
    if (p === '/api/auth/status') reply = { authed: true, authRequired: false };
    else if (p === '/api/sessions') reply = { sessions, executor: 'host' };
    else if (/^\/api\/sessions\/\w+$/.test(p)) reply = sessions.find((s) => p.endsWith('/' + s.id));
    // These answers never come: what their pills show is the first guess.
    else if (p === '/api/sessions/b/config' || p === '/api/sessions/c2/config') return;
    else if (p === '/api/sessions/a/config' && method === 'POST') {
      picked = true;
      reply = { ok: true, applied: ['model'], state: { model: qwen, thinkingLevel: 'medium' } };
    } else if (p === '/api/sessions/a/config') {
      reply = picked ? { ...config(qwen, ALL, { provider: 'llama-swap', model: qwen.id }), live: true } : config(ornith, ['off', 'medium']);
    } else if (p === '/api/sessions/c/config') reply = config(ornith, ['off', 'medium'], { provider: 'llama-swap', model: null });
    // The default is Qwen now, and pi's catalogue has not said its levels yet.
    else if (p === '/api/sessions/d/config') reply = config(qwen, []);
    // No catalogue yet: opening the model menu asks pi for it, which says the default is Qwen now.
    else if (p === '/api/sessions/e/config') reply = config(ornith, ['off', 'medium'], undefined, []);
    else if (p === '/api/sessions/e/models') reply = { ...config(qwen, ALL), live: true };
    else if (p.endsWith('/canvases')) reply = [];
    else if (p === '/api/workspaces') reply = { root: '/w', workspaces: [] };
    else if (p === '/api/models') reply = { models: [], providers: {} };
    await route.fulfill({ json: reply });
  });
  await page.addInitScript((open: boolean) => {
    localStorage.setItem('pithagoras.setup', 'done');
    // Whether the page is hidden, as the test says.
    (window as any).hide = (hidden: boolean) => {
      (window as any).hidden = hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    };
    Object.defineProperty(document, 'hidden', { get: () => !!(window as any).hidden });
    Object.defineProperty(document, 'visibilityState', { get: () => ((window as any).hidden ? 'hidden' : 'visible') });
    // Every stream the page opens, and whether it has been closed. One not
    // `open` stays pending, as when the browser has no connection to give it.
    const streams: any[] = ((window as any).streams = []);
    (window as any).EventSource = class {
      url: string; closed = false; onmessage: any; onopen: any; onerror: any;
      listeners: Record<string, ((e: any) => void)[]> = {};
      constructor(url: string) { this.url = url; streams.push(this); if (open) setTimeout(() => this.onopen?.(), 0); }
      addEventListener(name: string, fn: (e: any) => void) { (this.listeners[name] ??= []).push(fn); }
      close() { this.closed = true; }
      emit(name: string, data: unknown) {
        const e = { data: JSON.stringify(data) };
        if (name === 'message') this.onmessage?.(e);
        else (this.listeners[name] ?? []).forEach((fn) => fn(e));
      }
    };
  }, opts.streamsOpen ?? true);
  return { sessions, asked };
}

/** The streams the page has open. Development React runs each effect twice, so a first one may be opened and closed at once. */
const streams = (page: Page) => page.evaluate(() => (window as any).streams.filter((s: any) => !s.closed).map((s: any) => s.url));
/** Every stream the page has asked for, closed or not. */
const everAsked = (page: Page) => page.evaluate(() => [...new Set((window as any).streams.map((s: any) => s.url))]);
const pill = (page: Page) => page.locator('.composer-settings button').nth(1);
/** What a page that has seen chats before keeps: the default's levels, as last reported. */
const seen = (page: Page, levels: Record<string, string[]>) =>
  page.addInitScript((l) => localStorage.setItem('pithagoras.thinkingLevels', JSON.stringify(l)), levels);
const open = async (page: Page, title: string, id: string) => {
  await page.getByText(title).first().click();
  await expect(page).toHaveURL(new RegExp(`/s/${id}$`));
};

test('a chat keeps one stream, its canvases on it, hidden or not', async ({ page }) => {
  await page.clock.install();
  await portal(page);
  await page.goto('/s/a');
  await expect.poll(() => streams(page)).toEqual(['/api/sessions/a/events?since=0']);
  // Its canvases come on it: they had a stream of their own.
  expect(await everAsked(page)).toEqual(['/api/sessions/a/events?since=0']);

  // A hidden tab keeps it: hands-free voice speaks its replies there, a
  // document the agent makes opens there, and a run started elsewhere ends
  // there. Giving it back after a while left all three to a status check.
  await page.evaluate(() => (window as any).hide(true));
  await page.clock.fastForward(120_000);
  expect(await streams(page)).toEqual(['/api/sessions/a/events?since=0']);
});

test('the canvas list comes on the stream once, not asked for again beside it', async ({ page }) => {
  const { asked } = await portal(page);
  await page.goto('/s/a');
  await expect.poll(() => streams(page)).toEqual(['/api/sessions/a/events?since=0']);
  await page.evaluate(() => {
    const s = (window as any).streams.find((s: any) => !s.closed);
    // Sent first on every connection, before the panel is drawn.
    s.emit('canvas', { type: 'snapshot', canvases: [] });
    s.emit('message', { seq: 7, type: 'portal_prompt', payload: { message: 'Hello there' } });
    s.emit('caught-up', { seq: 7 });
  });
  await expect(page.getByText('Hello there')).toBeVisible();
  await page.waitForTimeout(500);
  expect(asked['/api/sessions/a/canvases'] ?? 0).toBe(0);
});

test('the canvas list is asked for when the stream does not come up', async ({ page }) => {
  // The browser has no connection to give it: the stream stays pending.
  // Before, the panel waited on it for ever, empty and saying nothing.
  const { asked } = await portal(page, { streamsOpen: false });
  await page.goto('/s/a');
  await expect.poll(() => streams(page)).toEqual(['/api/sessions/a/events?since=0']);
  await expect.poll(() => asked['/api/sessions/a/canvases'] ?? 0, { timeout: 6000 }).toBeGreaterThan(0);
});

test("a chat on the default model draws the default's effort control before its own answer comes", async ({ page }) => {
  await portal(page);
  await page.goto('/s/a');
  await expect(page.getByTitle('Thinking on / off')).toHaveText('thinking on');
  // Chat b names no model either, and its config does not answer: the default's
  // was last seen to switch on and off, not slide across seven levels.
  await open(page, 'Second chat', 'b');
  await expect(page.locator('.composer-settings button').first()).toHaveText('default');
  await expect(page.getByTitle('Thinking on / off')).toHaveText('thinking on');
  await expect(page.getByTitle('Effort / thinking level')).toHaveCount(0);
});

test('a chat naming only a provider draws what was last seen for one like it', async ({ page }) => {
  // Its first paint looks the levels up by what its row names: the provider,
  // and no model. They were kept only for a row naming neither.
  await portal(page);
  await page.goto('/s/c');
  await expect(page.getByTitle('Thinking on / off')).toHaveText('thinking on');
  await open(page, 'Fourth chat', 'c2');
  await expect(page.locator('.composer-settings button').first()).toHaveText('default');
  await expect(page.getByTitle('Thinking on / off')).toHaveText('thinking on');
});

test("a model picked in a chat on the default is not kept as the default's", async ({ page }) => {
  await portal(page);
  await page.goto('/s/a');
  await expect(page.getByTitle('Thinking on / off')).toHaveText('thinking on');
  // Picked here: the chat is on a model of its own now, with seven levels.
  await page.getByTitle('Ornith1.5-35b', { exact: true }).click();
  await page.getByRole('button', { name: 'More models' }).click();
  await page.getByTitle('Qwen3.8-27b', { exact: true }).click();
  await expect(page.getByTitle('Effort / thinking level')).toHaveText('medium');
  // Chat b is still on the default, which switches on and off.
  await open(page, 'Second chat', 'b');
  await expect(page.locator('.composer-settings button').first()).toHaveText('default');
  await expect(page.getByTitle('Thinking on / off')).toHaveText('thinking on');
});

test("a new default's control is not the old default's, when its levels are not known yet", async ({ page }) => {
  await seen(page, { ':': ['off', 'medium'] });
  await portal(page);
  // Chat d is drawn first with the default's levels as last seen: Ornith's.
  // Its answer names Qwen, the default now, with no levels yet. What was
  // drawn is another model's, and stayed until the chat was run.
  await page.goto('/s/d');
  await expect(page.locator('.composer-settings button').first()).toHaveText('Qwen 3.8 27B');
  await expect(page.getByTitle('Effort / thinking level')).toHaveText('medium');
});

test("the levels the model list reports are kept as the config's are", async ({ page }) => {
  await seen(page, { ':': ['off', 'medium'] });
  await portal(page);
  await page.goto('/s/e');
  await expect(page.getByTitle('Thinking on / off')).toHaveText('thinking on');
  // No catalogue: opening the menu asks pi, which says the default is Qwen now.
  await page.getByTitle('Ornith1.5-35b', { exact: true }).click();
  await expect(pill(page)).toHaveText('medium');
  await page.keyboard.press('Escape');
  // Chat b follows the default too: it draws Qwen's seven levels, not Ornith's two.
  await open(page, 'Second chat', 'b');
  await expect(page.locator('.composer-settings button').first()).toHaveText('default');
  await expect(page.getByTitle('Effort / thinking level')).toHaveText('medium');
});
