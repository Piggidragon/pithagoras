import { test, expect, type Page } from '@playwright/test';

/**
 * A message sent again, or edited, has versions: the page shows which one is
 * on screen and switches between them, and loads the chat again when one
 * comes back.
 */
async function portal(page: Page) {
  const at = new Date().toISOString();
  const session = { id: 'a', title: 'Circle constants', workspace: '/w/site', status: 'idle', kind: 'task', pinned: false, updated_at: at };
  const state = { versions: { 5: [2, 5] } as Record<number, number[]>, switched: [] as { path: string; body: any }[] };
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    let reply: unknown = {};
    if (p === '/api/auth/status') reply = { authed: true, authRequired: false };
    else if (p === '/api/sessions') reply = { sessions: [session], executor: 'host' };
    else if (p === '/api/sessions/a/versions') reply = { versions: state.versions };
    else if (p.endsWith('/version')) {
      state.switched.push({ path: p, body: route.request().postDataJSON() });
      reply = { ok: true };
    } else if (p.endsWith('/canvases')) reply = [];
    else if (p === '/api/models') reply = { models: [], providers: {} };
    await route.fulfill({ json: reply });
  });
  await page.addInitScript(() => {
    localStorage.setItem('pithagoras.setup', 'done');
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
  return state;
}

const ev = (seq: number, type: string, payload: unknown) => ({ seq, type, at: Date.now(), payload });
const turn = (seq: number, question: string, answer: string) => [
  ev(seq, 'portal_prompt', { message: question }),
  ev(seq + 1, 'message_end', { message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: answer }] } }),
];

/** Sends a replay down the newest open stream the page has for the chat, and says it has caught up. */
async function replay(page: Page, events: unknown[]) {
  await expect.poll(() => page.evaluate(() => (window as any).streams.filter((s: any) => !s.closed).length)).toBeGreaterThan(0);
  await page.evaluate((events) => {
    const s = (window as any).streams.filter((x: any) => !x.closed).at(-1);
    s.emit('live-reset', {});
    for (const e of events) s.emit('message', e);
    s.emit('caught-up', {});
  }, events);
}

const openStreams = (page: Page) => page.evaluate(() => (window as any).streams.filter((s: any) => !s.closed).map((s: any) => s.url));

test('a message sent again shows which version it is, and switches to the other', async ({ page }) => {
  const state = await portal(page);
  await page.goto('/s/a');
  await replay(page, turn(5, 'What is tau?', 'About 6.28.'));
  const versions = page.getByRole('group', { name: 'Versions of this message' });
  await expect(versions).toContainText('2 / 2');
  await expect(versions.getByRole('button', { name: 'Next version' })).toBeDisabled();
  await versions.getByRole('button', { name: 'Previous version' }).click();
  await expect.poll(() => state.switched).toEqual([{ path: '/api/sessions/a/messages/5/version', body: { to: 2 } }]);

  // The server brought the old version back, under the seqs it had: the page is told to load the chat again.
  state.versions = { 2: [2, 5] };
  await page.evaluate(() => (window as any).streams.filter((s: any) => !s.closed).at(-1).emit('message', { seq: 9, type: 'portal_reload', at: Date.now(), payload: {} }));
  await expect.poll(() => openStreams(page)).toEqual(['/api/sessions/a/events?since=0']);
  // What comes replaces what was there. The reload it passes, stored, is not taken for another one.
  await replay(page, [...turn(2, 'What is pi?', 'About 3.14.'), ev(9, 'portal_reload', {})]);
  await expect(page.getByText('What is pi?')).toBeVisible();
  await expect(page.getByText('About 3.14.')).toBeVisible();
  await expect(page.getByText('What is tau?')).toHaveCount(0);
  await expect(page.getByText('About 6.28.')).toHaveCount(0);
  await expect(versions).toContainText('1 / 2');
  await expect(versions.getByRole('button', { name: 'Previous version' })).toBeDisabled();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as any).streams.length)).toBeLessThanOrEqual(4);
  expect(await openStreams(page)).toEqual(['/api/sessions/a/events?since=0']);
});

test('a page that was away when a version came back loads the chat again on catching up', async ({ page }) => {
  await portal(page);
  await page.goto('/s/a');
  await replay(page, turn(5, 'What is tau?', 'About 6.28.'));
  // The stream drops, and comes back from where it had read to.
  await page.evaluate(() => (window as any).streams.filter((s: any) => !s.closed).at(-1).onerror());
  await expect.poll(() => openStreams(page), { timeout: 10000 }).toEqual(['/api/sessions/a/events?since=6']);
  await page.evaluate(() => {
    const s = (window as any).streams.filter((x: any) => !x.closed).at(-1);
    s.emit('live-reset', {});
    s.emit('message', { seq: 9, type: 'portal_reload', at: Date.now(), payload: {} });
  });
  await expect.poll(() => openStreams(page)).toEqual(['/api/sessions/a/events?since=0']);
  await replay(page, turn(2, 'What is pi?', 'About 3.14.'));
  await expect(page.getByText('What is pi?')).toBeVisible();
  await expect(page.getByText('What is tau?')).toHaveCount(0);
});

test('a message with one version has no switch', async ({ page }) => {
  const state = await portal(page);
  state.versions = {};
  await page.goto('/s/a');
  await replay(page, turn(5, 'What is tau?', 'About 6.28.'));
  await expect(page.getByText('About 6.28.')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Versions of this message' })).toHaveCount(0);
});

test('versions are asked for when messages change, not for every message sent', async ({ page }) => {
  const state = await portal(page);
  const asked: number[] = [];
  page.on('request', (r) => r.url().endsWith('/api/sessions/a/versions') && asked.push(Date.now()));
  await page.goto('/s/a');
  await replay(page, turn(5, 'What is tau?', 'About 6.28.'));
  const versions = page.getByRole('group', { name: 'Versions of this message' });
  await expect(versions).toContainText('2 / 2');
  await expect.poll(() => asked.length).toBe(1);
  // A message sent: one more without versions. It asked, and the switch blinked out while it did.
  const live = (e: unknown) => page.evaluate((e) => (window as any).streams.filter((s: any) => !s.closed).at(-1).emit('message', e), e);
  for (const e of turn(7, 'And e?', 'About 2.72.')) await live(e);
  await expect(page.getByText('About 2.72.')).toBeVisible();
  await page.waitForTimeout(300);
  expect(asked.length).toBe(1);
  await expect(versions).toContainText('2 / 2');
  // An edit of the last one: its turn goes, and its replacement comes after. That is asked about.
  state.versions = { 5: [2, 5], 11: [7, 11] };
  await live({ seq: -1, type: 'portal_removed', at: Date.now(), payload: { from: 7, to: 11 } });
  for (const e of turn(11, 'And e, roughly?', 'About 2.7.')) await live(e);
  await expect(page.getByText('And e?')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Versions of this message' }).nth(1)).toContainText('2 / 2');
  expect(asked.length).toBeGreaterThan(1);
});
