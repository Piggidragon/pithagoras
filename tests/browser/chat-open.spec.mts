import { test, expect, type Page } from '@playwright/test';

/**
 * Opening a chat: the streams it keeps open, and the effort pill it draws
 * before anything has answered.
 */
async function portal(page: Page) {
  const at = new Date().toISOString();
  const chat = (id: string, title: string, status = 'idle') =>
    ({ id, title, workspace: '/w/site', status, kind: 'task', pinned: false, updated_at: at, provider: null, model: null, thinking_level: null });
  const sessions = [chat('a', 'First chat'), chat('b', 'Second chat'), chat('r', 'Busy chat', 'running')];
  const ornith = { id: 'Ornith1.5-35b', name: 'Ornith 1.5 35B', provider: 'llama-swap' };
  const qwen = { id: 'Qwen3.8-27b', name: 'Qwen 3.8 27B', provider: 'llama-swap' };
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
    // Chat b's answer never comes: what its pill shows is its first guess.
    else if (p === '/api/sessions/b/config') return;
    else if (p === '/api/sessions/a/config' && method === 'POST') {
      picked = true;
      reply = { ok: true, applied: ['model'], state: { model: qwen, thinkingLevel: 'medium' } };
    } else if (p.endsWith('/config')) {
      reply = picked
        ? { live: true, state: { model: qwen, thinkingLevel: 'medium' }, stats: null, thinking: { levels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] }, models: { models: [ornith, qwen] }, onDefault: false }
        : { live: false, state: { model: ornith, thinkingLevel: 'medium' }, stats: null, thinking: { levels: ['off', 'medium'] }, models: { models: [ornith, qwen] }, onDefault: true };
    } else if (p.endsWith('/canvases')) reply = [];
    else if (p === '/api/workspaces') reply = { root: '/w', workspaces: [] };
    else if (p === '/api/models') reply = { models: [], providers: {} };
    await route.fulfill({ json: reply });
  });
  await page.addInitScript(() => {
    localStorage.setItem('pithagoras.setup', 'done');
    // Whether the page is hidden, as the test says.
    (window as any).hide = (hidden: boolean) => {
      (window as any).hidden = hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    };
    Object.defineProperty(document, 'hidden', { get: () => !!(window as any).hidden });
    Object.defineProperty(document, 'visibilityState', { get: () => ((window as any).hidden ? 'hidden' : 'visible') });
    // Every stream the page opens, and whether it has been closed.
    const streams: any[] = ((window as any).streams = []);
    (window as any).EventSource = class {
      url: string; closed = false; onmessage: any; onopen: any; onerror: any;
      listeners: Record<string, ((e: any) => void)[]> = {};
      constructor(url: string) { this.url = url; streams.push(this); setTimeout(() => this.onopen?.(), 0); }
      addEventListener(name: string, fn: (e: any) => void) { (this.listeners[name] ??= []).push(fn); }
      close() { this.closed = true; }
      emit(name: string, data: unknown) {
        const e = { data: JSON.stringify(data) };
        if (name === 'message') this.onmessage?.(e);
        else (this.listeners[name] ?? []).forEach((fn) => fn(e));
      }
    };
  });
  return { sessions, asked };
}

/** The streams the page has open. Development React runs each effect twice, so a first one may be opened and closed at once. */
const streams = (page: Page) => page.evaluate(() => (window as any).streams.filter((s: any) => !s.closed).map((s: any) => s.url));
/** Every stream the page has asked for, closed or not. */
const everAsked = (page: Page) => page.evaluate(() => [...new Set((window as any).streams.map((s: any) => s.url))]);

test('a chat keeps one stream, and gives it back while its tab is hidden and it is idle', async ({ page }) => {
  await page.clock.install();
  await portal(page);
  await page.goto('/s/a');
  await expect.poll(() => streams(page)).toEqual(['/api/sessions/a/events?since=0']);
  // Its canvases come on it: they had a stream of their own.
  expect(await everAsked(page)).toEqual(['/api/sessions/a/events?since=0']);
  await page.evaluate(() => {
    const s = (window as any).streams.find((s: any) => !s.closed);
    s.emit('message', { seq: 7, type: 'portal_prompt', payload: { message: 'Hello there' } });
    s.emit('caught-up', { seq: 7 });
  });
  await expect(page.getByText('Hello there')).toBeVisible();

  // A glance at another tab keeps it.
  await page.evaluate(() => (window as any).hide(true));
  await page.clock.fastForward(5_000);
  await page.evaluate(() => (window as any).hide(false));
  await page.evaluate(() => (window as any).hide(true));
  await page.clock.fastForward(20_000);
  expect(await streams(page)).toEqual(['/api/sessions/a/events?since=0']);

  // Left there, it goes — and comes back when looked at, from where it was.
  await page.clock.fastForward(15_000);
  expect(await streams(page)).toEqual([]);
  await page.evaluate(() => (window as any).hide(false));
  await expect.poll(() => streams(page)).toEqual(['/api/sessions/a/events?since=7']);
  // What was said is still there, not read again from the start.
  await expect(page.getByText('Hello there')).toBeVisible();
});

test('a running chat keeps its stream in a hidden tab', async ({ page }) => {
  await page.clock.install();
  await portal(page);
  await page.goto('/s/r');
  await expect.poll(() => streams(page)).toEqual(['/api/sessions/r/events?since=0']);
  await page.evaluate(() => (window as any).hide(true));
  await page.clock.fastForward(120_000);
  // For the dialog it may ask, and the end it comes to.
  expect(await streams(page)).toEqual(['/api/sessions/r/events?since=0']);
});

test("a chat on the default model draws the default's effort control before its own answer comes", async ({ page }) => {
  await portal(page);
  await page.goto('/s/a');
  await expect(page.getByTitle('Thinking on / off')).toHaveText('thinking on');
  // Chat b names no model either, and its config does not answer: the default's
  // was last seen to switch on and off, not slide across seven levels.
  await page.getByText('Second chat').first().click();
  await expect(page).toHaveURL(/\/s\/b$/);
  // b's own pills: its row names no model, and nothing has said which.
  await expect(page.locator('.composer-settings button').first()).toHaveText('default');
  await expect(page.getByTitle('Thinking on / off')).toHaveText('thinking on');
  await expect(page.getByTitle('Effort / thinking level')).toHaveCount(0);
});

test('a hidden chat whose stream was given back takes it again when a run starts in it elsewhere', async ({ page }) => {
  await page.clock.install();
  const { sessions } = await portal(page);
  await page.goto('/s/a');
  await expect.poll(() => streams(page)).toEqual(['/api/sessions/a/events?since=0']);
  await page.evaluate(() => {
    const s = (window as any).streams.find((s: any) => !s.closed);
    s.emit('message', { seq: 7, type: 'portal_prompt', payload: { message: 'Hello there' } });
    s.emit('caught-up', { seq: 7 });
  });
  await page.evaluate(() => (window as any).hide(true));
  await page.clock.fastForward(31_000);
  expect(await streams(page)).toEqual([]);

  // Still idle: asked, and left closed.
  await page.clock.fastForward(16_000);
  expect(await streams(page)).toEqual([]);

  // A routine, a channel or another device starts a run: nothing tells a
  // closed stream, and the chat list is not asked for while hidden. Before,
  // it stayed closed, and a dialog the run asked went unnoticed.
  sessions[0].status = 'running';
  await page.clock.fastForward(16_000);
  await expect.poll(() => streams(page)).toEqual(['/api/sessions/a/events?since=7']);
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

test("a model picked in a chat on the default is not kept as the default's", async ({ page }) => {
  await portal(page);
  await page.goto('/s/a');
  await expect(page.getByTitle('Thinking on / off')).toHaveText('thinking on');
  // Picked here: the chat is on a model of its own now, with seven levels.
  await page.getByTitle('Ornith1.5-35b', { exact: true }).click();
  await page.getByRole('button', { name: 'More models' }).click();
  await page.getByTitle('Qwen3.8-27b', { exact: true }).click();
  await expect(page.getByTitle('Effort / thinking level')).toHaveText('medium');
  // Chat b is still on the default, which switches on and off. Before, the
  // page still took chat a for one on the default when its answer came, and
  // kept the picked model's seven levels as the default's.
  await page.getByText('Second chat').first().click();
  await expect(page).toHaveURL(/\/s\/b$/);
  await expect(page.locator('.composer-settings button').first()).toHaveText('default');
  await expect(page.getByTitle('Thinking on / off')).toHaveText('thinking on');
});
