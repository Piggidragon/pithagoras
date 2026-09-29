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
    // Versions come with the stream; this is here for a page that asks anyway (and a test counts that it does not).
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

/**
 * Sends a replay down the newest open stream the page has for the chat, and
 * says it has caught up: first, as the server does, how often the chat was
 * loaded again (`reloads`).
 */
async function replay(page: Page, events: unknown[], reloads = 0, versions: Record<number, number[]> = {}) {
  await expect.poll(() => page.evaluate(() => (window as any).streams.filter((s: any) => !s.closed).length)).toBeGreaterThan(0);
  await page.evaluate(([events, reloads, versions]) => {
    const s = (window as any).streams.filter((x: any) => !x.closed).at(-1);
    s.emit('reloads', { reloads });
    s.emit('versions', { versions });
    s.emit('live-reset', {});
    for (const e of events as unknown[]) s.emit('message', e);
    s.emit('caught-up', {});
  }, [events, reloads, versions] as const);
}
/** The newest open stream drops. */
const drop = (page: Page) => page.evaluate(() => (window as any).streams.filter((s: any) => !s.closed).at(-1).onerror());

const openStreams = (page: Page) => page.evaluate(() => (window as any).streams.filter((s: any) => !s.closed).map((s: any) => s.url));

test('a message sent again shows which version it is, and switches to the other', async ({ page }) => {
  const state = await portal(page);
  await page.goto('/s/a');
  await replay(page, turn(5, 'What is tau?', 'About 6.28.'), 0, { 5: [2, 5] });
  const versions = page.getByRole('group', { name: 'Versions of this message' });
  await expect(versions).toContainText('2 / 2');
  await expect(versions.getByRole('button', { name: 'Next version' })).toBeDisabled();
  await versions.getByRole('button', { name: 'Previous version' }).click();
  await expect.poll(() => state.switched).toEqual([{ path: '/api/sessions/a/messages/5/version', body: { to: 2 } }]);

  // The server brought the old version back, under the seqs it had: the page is told to load the chat again.
  await page.evaluate(() => (window as any).streams.filter((s: any) => !s.closed).at(-1).emit('message', { seq: -1, type: 'portal_reload', at: Date.now(), payload: { reloads: 1 } }));
  await expect.poll(() => openStreams(page)).toEqual(['/api/sessions/a/events?since=0']);
  // What comes replaces what was there.
  await replay(page, turn(2, 'What is pi?', 'About 3.14.'), 1, { 2: [2, 5] });
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

test('a page that was away when a version came back loads the chat again on catching up, and only then', async ({ page }) => {
  await portal(page);
  await page.goto('/s/a');
  await replay(page, turn(5, 'What is tau?', 'About 6.28.'));
  // The stream drops, and comes back from where it had read to: the count is not the one it last saw.
  await drop(page);
  await expect.poll(() => openStreams(page), { timeout: 10000 }).toEqual(['/api/sessions/a/events?since=6']);
  await page.evaluate(() => (window as any).streams.filter((s: any) => !s.closed).at(-1).emit('reloads', { reloads: 1 }));
  await expect.poll(() => openStreams(page)).toEqual(['/api/sessions/a/events?since=0']);
  await replay(page, turn(2, 'What is pi?', 'About 3.14.'), 1);
  await expect(page.getByText('What is pi?')).toBeVisible();
  await expect(page.getByText('What is tau?')).toHaveCount(0);
  // It drops again, and the count is the same: it goes on from its cursor. A stored
  // marker it never read past sent every reconnect back to the start.
  await drop(page);
  await expect.poll(() => openStreams(page), { timeout: 10000 }).toEqual(['/api/sessions/a/events?since=3']);
  await page.evaluate(() => (window as any).streams.filter((s: any) => !s.closed).at(-1).emit('reloads', { reloads: 1 }));
  await page.waitForTimeout(300);
  expect(await openStreams(page)).toEqual(['/api/sessions/a/events?since=3']);
});

test('a reload whose stream drops before anything came keeps the chat on screen', async ({ page }) => {
  await portal(page);
  await page.goto('/s/a');
  await replay(page, turn(5, 'What is tau?', 'About 6.28.'));
  await page.evaluate(() => (window as any).streams.filter((s: any) => !s.closed).at(-1).emit('message', { seq: -1, type: 'portal_reload', at: Date.now(), payload: { reloads: 1 } }));
  await expect.poll(() => openStreams(page)).toEqual(['/api/sessions/a/events?since=0']);
  await drop(page);
  // Nothing had come, and that nothing replaced the chat until the next try.
  await expect(page.getByText('What is tau?')).toBeVisible();
  await expect.poll(() => openStreams(page), { timeout: 10000 }).toEqual(['/api/sessions/a/events?since=0']);
  await replay(page, turn(2, 'What is pi?', 'About 3.14.'), 1);
  await expect(page.getByText('What is pi?')).toBeVisible();
  await expect(page.getByText('What is tau?')).toHaveCount(0);
});

test('earlier messages asked for before the chat was loaded again are not put above it', async ({ page }) => {
  await portal(page);
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let asked = 0;
  await page.route('**/api/sessions/a/events/before**', async (route) => {
    const limit = new URL(route.request().url()).searchParams.get('limit');
    // Whether there is more above: yes.
    if (limit === '1') return route.fulfill({ json: { events: [ev(1, 'portal_prompt', { message: 'x' })], more: true } });
    // The first page of it is slow, and comes after the reload; any later one finds nothing.
    if (asked++ === 0) {
      await held;
      return route.fulfill({ json: { events: turn(1, 'Ancient question', 'Ancient answer'), more: false } });
    }
    await route.fulfill({ json: { events: [], more: false } });
  });
  await page.goto('/s/a');
  await replay(page, turn(5, 'What is tau?', 'About 6.28.'));
  // Asked for on its own when the top of a short chat is in view; else by the button.
  await page.getByRole('button', { name: 'Load earlier messages' }).click({ timeout: 1500 }).catch(() => {});
  await expect.poll(() => asked).toBeGreaterThan(0);
  await page.evaluate(() => (window as any).streams.filter((s: any) => !s.closed).at(-1).emit('message', { seq: -1, type: 'portal_reload', at: Date.now(), payload: { reloads: 1 } }));
  await replay(page, turn(2, 'What is pi?', 'About 3.14.'), 1);
  await expect(page.getByText('What is pi?')).toBeVisible();
  release();
  await page.waitForTimeout(500);
  await expect(page.getByText('Ancient question')).toHaveCount(0);
});

test('a message with one version has no switch', async ({ page }) => {
  const state = await portal(page);
  state.versions = {};
  await page.goto('/s/a');
  await replay(page, turn(5, 'What is tau?', 'About 6.28.'));
  await expect(page.getByText('About 6.28.')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Versions of this message' })).toHaveCount(0);
});

test('versions come with the chat\'s stream, and change when it says so', async ({ page }) => {
  await portal(page);
  const asked: string[] = [];
  page.on('request', (r) => r.url().includes('/versions') && r.method() === 'GET' && asked.push(r.url()));
  await page.goto('/s/a');
  await replay(page, turn(5, 'What is tau?', 'About 6.28.'), 0, { 5: [2, 5] });
  const versions = page.getByRole('group', { name: 'Versions of this message' });
  await expect(versions).toContainText('2 / 2');
  const live = (e: unknown) => page.evaluate((e) => (window as any).streams.filter((s: any) => !s.closed).at(-1).emit('message', e), e);
  for (const e of turn(7, 'And e?', 'About 2.72.')) await live(e);
  await expect(page.getByText('About 2.72.')).toBeVisible();
  // An edit of the last one: its turn goes, its replacement comes, and the server says the versions.
  await live({ seq: -1, type: 'portal_removed', at: Date.now(), payload: { from: 7, to: 11, reloads: 1 } });
  for (const e of turn(11, 'And e, roughly?', 'About 2.7.')) await live(e);
  await live({ seq: -1, type: 'portal_versions', at: Date.now(), payload: { versions: { 5: [2, 5], 11: [7, 11] } } });
  await expect(page.getByText('And e?')).toHaveCount(0);
  await expect(versions.nth(1)).toContainText('2 / 2');
  // Asked for by the page after each change, a change that did not alter which messages it held went unseen.
  expect(asked).toEqual([]);
  // A page that heard the removal has the count it brought: its next stream goes on from its cursor.
  await drop(page);
  await expect.poll(() => openStreams(page), { timeout: 10000 }).toEqual(['/api/sessions/a/events?since=12']);
  await page.evaluate(() => (window as any).streams.filter((s: any) => !s.closed).at(-1).emit('reloads', { reloads: 1 }));
  await page.waitForTimeout(300);
  expect(await openStreams(page)).toEqual(['/api/sessions/a/events?since=12']);
});

test('a second click on a version switch waits for the first', async ({ page }) => {
  const state = await portal(page);
  state.versions = { 5: [1, 3, 5] };
  await page.goto('/s/a');
  await replay(page, turn(5, 'What is tau?', 'About 3.14 times two.'), 0, { 5: [1, 3, 5] });
  const previous = page.getByRole('group', { name: 'Versions of this message' }).getByRole('button', { name: 'Previous version' });
  await expect(previous).toBeEnabled();
  // Twice, quickly: the second asked about a message on its way out, and failed after the first worked.
  await previous.click();
  await previous.click({ force: true }).catch(() => {});
  await page.waitForTimeout(400);
  expect(state.switched).toEqual([{ path: '/api/sessions/a/messages/5/version', body: { to: 3 } }]);
  await expect(previous).toBeDisabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
