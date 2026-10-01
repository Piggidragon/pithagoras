import { test, expect, type Page } from '@playwright/test';

/**
 * The extra animations (web/src/motion.ts): on by default, one switch to turn
 * them off, the system's reduced motion over it, and what they do to the page —
 * which is nothing the page has to wait for. The config presets the switch to
 * off for every other spec; this one starts as a fresh browser does.
 *
 * What was played is read off the page, not waited for: every call of
 * Element.animate is written down, and so is every picture put on the page
 * (what it was, and that it takes no click and is not a dialog or a landmark).
 */
test.use({ storageState: { cookies: [], origins: [] } });

interface Played { on: string; keys: string[]; ghost: boolean }
interface Picture { text: string; hidden: string | null; pointer: string; roles: number; dock: string | null }

const at = new Date().toISOString();
const chat = (id: string, title: string, extra: object = {}) => ({ id, title, workspace: `/w/${id}`, status: 'idle', kind: 'task', pinned: false, updated_at: at, provider: null, model: null, thinking_level: null, ...extra });

/** Five questions, each answered with a command and a reply: more than a window holds. */
const conversation = (tag: string) => {
  let seq = 0;
  const ev = (type: string, payload: object = {}) => ({ seq: ++seq, type, at: Date.now() - 100_000 + seq * 1000, payload });
  const out: ReturnType<typeof ev>[] = [];
  for (let i = 1; i <= 5; i++) {
    out.push(ev('portal_prompt', { message: `${tag} question ${i}` }), ev('agent_start'));
    out.push(ev('tool_execution_start', { toolCallId: `${tag}${i}`, toolName: 'bash', args: { command: `npm test ${i}` } }));
    out.push(ev('tool_execution_end', { toolCallId: `${tag}${i}`, toolName: 'bash', result: { content: [{ type: 'text', text: 'ok\n' }] } }));
    out.push(ev('message_end', { message: { role: 'assistant', content: [{ type: 'text', text: `${tag} answer ${i}: nothing else to fix here.` }] } }), ev('agent_end'));
  }
  return out;
};

/** The portal over canned answers: chats that can be deleted, a stream that replays them, and a log of what is played. */
async function portal(page: Page, { off = false, confirms = true, places }: { off?: boolean; confirms?: boolean; places?: Record<string, string> } = {}) {
  const state = { sessions: [chat('a', 'First chat'), chat('b', 'Second chat'), chat('c', 'Third chat'), chat('d', 'Fourth chat')], events: { a: conversation('A'), b: conversation('B'), c: [] as any[], d: [] as any[] } as Record<string, any[]> };
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    const method = route.request().method();
    let reply: unknown = {};
    let m: RegExpMatchArray | null;
    if (p === '/api/auth/status') reply = { authed: true, authRequired: false };
    else if (p === '/api/sessions' && method === 'GET') reply = { sessions: state.sessions, executor: 'host' };
    else if ((m = p.match(/^\/api\/sessions\/(\w+)\/messages\/(\d+)$/)) && method === 'DELETE') {
      const [id, seq] = [m[1], Number(m[2])];
      const next = state.events[id].find((e) => e.seq > seq && e.type === 'portal_prompt');
      const to = next?.seq ?? null;
      state.events[id] = state.events[id].filter((e) => !(e.seq >= seq && (to === null || e.seq < to)));
      // The server says so a moment after it has answered.
      setTimeout(() => page.evaluate(([id, from, to]) => (window as any).emit(id, { seq: 9000 + from, type: 'portal_removed', payload: { from, to } }), [id, seq, to] as const).catch(() => {}), 80);
      reply = { ok: true };
    } else if ((m = p.match(/^\/api\/sessions\/(\w+)$/)) && method === 'DELETE') {
      state.sessions = state.sessions.filter((s) => s.id !== m![1]);
      reply = { ok: true };
    } else if ((m = p.match(/^\/api\/sessions\/(\w+)$/))) reply = state.sessions.find((s) => s.id === m![1]) ?? {};
    else if (/^\/api\/sessions\/\w+\/(config|models)$/.test(p)) reply = { live: false, state: { model: { id: 'm', name: 'Model', provider: 'x' }, thinkingLevel: 'medium' }, stats: null, thinking: { levels: ['off', 'medium'] }, models: { models: [] }, named: { provider: null, model: null } };
    else if (/^\/api\/sessions\/\w+\/files$/.test(p)) reply = { path: '', entries: [], truncated: false };
    else if (p.endsWith('/canvases')) reply = [];
    else if (p.endsWith('/background')) reply = { jobs: [], statuses: [] };
    else if (p === '/api/workspaces') reply = { root: '/w', workspaces: [] };
    else if (p === '/api/models') reply = { models: [], providers: {} };
    else if (p === '/api/features/flags') reply = { subagent: { enabled: false }, understory: { enabled: false } };
    else if (p === '/api/settings') reply = { settings: {}, defaults: {}, stored: {}, executor: 'host', workspaceRoot: '/w', piSettingsPath: '/p/settings.json', compaction: { keepRecentTokens: 20000 }, contextDefault: null };
    else if (p === '/api/extensions') reply = { extensions: [], settingsPath: '/p/settings.json' };
    else if (/report/.test(p)) reply = { targets: [], default: null };
    await route.fulfill({ json: reply });
  });
  await page.addInitScript(([events, off, confirms, places]) => {
    localStorage.setItem('pithagoras.setup', 'done');
    if (off) localStorage.setItem('animations', 'off');
    if (!confirms) localStorage.setItem('confirmDeletes', 'off');
    if (places) localStorage.setItem('panelPlaces', JSON.stringify(places));
    // Every animation started from script, and every picture put on the page.
    const played: Played[] = ((window as any).played = []);
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, frames: any, options: any) {
      const first = Array.isArray(frames) ? frames[0] : frames;
      played.push({ on: `${this.tagName.toLowerCase()}${this.className && typeof this.className === 'string' ? '.' + this.className.split(' ')[0] : ''}`, keys: Object.keys(first ?? {}), ghost: !!this.closest('[data-ghost]') });
      return animate.call(this, frames, options);
    };
    const pictures: Picture[] = ((window as any).pictures = []);
    const intro: { pointer: string; at: number }[] = ((window as any).intro = []);
    new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) {
        if (!(n instanceof HTMLElement)) continue;
        if (n.hasAttribute('data-ghost')) pictures.push({ text: (n.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 4000), hidden: n.getAttribute('aria-hidden'), pointer: getComputedStyle(n).pointerEvents, roles: n.querySelectorAll('[role], [aria-modal], [id]').length, dock: n.firstElementChild?.getAttribute('data-dock') ?? null });
        if (n.classList.contains('app-intro')) intro.push({ pointer: getComputedStyle(n).pointerEvents, at: performance.now() });
      }
    }).observe(document, { childList: true, subtree: true });
    // The stream: the chat as it was, then what the test emits.
    const streams: any[] = [];
    (window as any).EventSource = class {
      url: string; closed = false; onmessage: any; onopen: any; listeners: Record<string, ((e: any) => void)[]> = {};
      constructor(url: string) {
        this.url = url; streams.push(this);
        setTimeout(() => {
          if (this.closed) return;
          this.onopen?.();
          const list = events[url.match(/sessions\/(\w+)\/events/)![1]] ?? [];
          for (const e of list) this.onmessage?.({ data: JSON.stringify(e) });
          (this.listeners['caught-up'] ?? []).forEach((fn) => fn({ data: JSON.stringify({ seq: list.at(-1)?.seq ?? 0 }) }));
        }, 30);
      }
      addEventListener(n: string, fn: (e: any) => void) { (this.listeners[n] ??= []).push(fn); }
      close() { this.closed = true; }
    };
    (window as any).emit = (id: string, event: unknown) => streams.filter((s) => !s.closed && s.url.includes(`/sessions/${id}/events`)).forEach((s) => s.onmessage?.({ data: JSON.stringify(event) }));
  }, [state.events, off, confirms, places ?? null] as const);
  return state;
}

const played = (page: Page) => page.evaluate(() => (window as any).played as Played[]);
const pictures = (page: Page) => page.evaluate(() => (window as any).pictures as Picture[]);
const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Sidebar' });
const motion = (page: Page) => page.locator('html');

/** The chat's row in the sidebar, not a picture of it, which is not in the sidebar. */
const row = (page: Page, title: string) => sidebar(page).locator('.session-row', { hasText: title });

async function deleteChat(page: Page, title: string) {
  await row(page, title).hover();
  await row(page, title).getByRole('button', { name: 'Delete session' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();
}

test('the animations are on until one switch in Settings turns them off, and it is remembered', async ({ page }) => {
  await portal(page);
  await page.goto('/s/a');
  await expect(motion(page)).toHaveAttribute('data-motion', 'fancy');

  await sidebar(page).getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'This browser' }).click();
  const switchEl = page.getByRole('switch', { name: 'Fancy animations' });
  await expect(switchEl).toHaveAttribute('aria-checked', 'true');
  await switchEl.click();
  await expect(switchEl).toHaveAttribute('aria-checked', 'false');
  await expect(motion(page)).not.toHaveAttribute('data-motion', /.+/);
  expect(await page.evaluate(() => localStorage.getItem('animations'))).toBe('off');

  // Kept: a reload is still without them, and opens without the intro.
  await page.reload();
  await expect(motion(page)).not.toHaveAttribute('data-motion', /.+/);
  expect(await page.evaluate(() => (window as any).intro.length)).toBe(0);

  // Settings is a place of its own: the reload is still in it.
  await page.getByRole('dialog').getByRole('button', { name: 'This browser' }).click();
  await page.getByRole('switch', { name: 'Fancy animations' }).click();
  await expect(motion(page)).toHaveAttribute('data-motion', 'fancy');
});

test('a system that asks for reduced motion wins over the switch, and the switch says so', async ({ page }) => {
  await portal(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/s/a');
  await expect(sidebar(page)).toBeVisible();
  await expect(motion(page)).not.toHaveAttribute('data-motion', /.+/);
  expect(await page.evaluate(() => (window as any).intro.length)).toBe(0);

  await sidebar(page).getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'This browser' }).click();
  // Still on, as far as the switch goes: it is what comes back when the system stops asking.
  await expect(page.getByRole('switch', { name: 'Fancy animations' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('Your system asks for reduced motion')).toBeVisible();
  await page.keyboard.press('Escape');

  // Changed while the page is open, it follows.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(motion(page)).toHaveAttribute('data-motion', 'fancy');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(motion(page)).not.toHaveAttribute('data-motion', /.+/);
  expect((await played(page)).filter((p) => p.ghost)).toEqual([]);
});

test('the portal opens through doors that take no click, and does not do it again on a reload', async ({ page }) => {
  await portal(page);
  await page.goto('/s/a');
  // Under it, the portal is already there to be used.
  await page.getByText('Second chat').first().click();
  await expect(page).toHaveURL(/\/s\/b$/);
  const intro = await page.evaluate(() => (window as any).intro as { pointer: string }[]);
  expect(intro).toHaveLength(1);
  expect(intro[0].pointer).toBe('none');
  // About a second, and gone.
  await expect(page.locator('.app-intro')).toHaveCount(0);

  await page.reload();
  await expect(sidebar(page)).toBeVisible();
  expect(await page.evaluate(() => (window as any).intro.length)).toBe(0);
});

test('a chat that is left drifts away as a picture, and the one that opens plays its last messages in', async ({ page }) => {
  await portal(page);
  await page.goto('/s/a');
  await expect(page.getByText('A answer 5')).toBeVisible();
  const list = page.locator('.chat-list');

  await row(page, 'Second chat').click();
  await expect(list).toHaveClass(/is-opening/);
  // The real conversation is the new one at once; what drifts away is a copy.
  await expect(page.getByText('B answer 5')).toBeVisible();
  await expect(page.locator('[data-transcript]').getByText('A answer 5')).toHaveCount(0);
  const log = await played(page);
  expect(log.some((p) => p.ghost && p.keys.includes('opacity'))).toBe(true);
  // And it is a copy that cannot be found as a conversation, clicked, or heard as one.
  const seen = (await pictures(page)).find((p) => p.text.includes('A answer 5'));
  expect(seen).toMatchObject({ hidden: 'true', pointer: 'none', roles: 0 });
  // Then it is just a chat again.
  await expect(list).not.toHaveClass(/is-opening/);
});

test('a deleted chat leaves its row at once and breaks apart as a picture of it', async ({ page }) => {
  await portal(page);
  await page.goto('/s/a');
  await expect(row(page, 'Fourth chat')).toBeVisible();
  await deleteChat(page, 'Fourth chat');

  await expect(row(page, 'Fourth chat')).toHaveCount(0);
  await expect.poll(async () => (await pictures(page)).filter((p) => p.text.includes('Fourth chat')).length).toBeGreaterThan(0);
  const seen = (await pictures(page)).find((p) => p.text.includes('Fourth chat'))!;
  expect(seen).toMatchObject({ hidden: 'true', pointer: 'none' });
  // It goes, and does not stay.
  await expect(page.locator('[data-ghost]')).toHaveCount(0);
});

test('a dialog sinks away as a picture of itself that is not a dialog', async ({ page }) => {
  await portal(page);
  await page.goto('/s/a');
  await sidebar(page).getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');

  await expect(page.getByRole('dialog')).toHaveCount(0);
  // No dialog left behind it for the keys that look for one, nor for a screen reader.
  expect(await page.locator('[aria-modal="true"]').count()).toBe(0);
  const seen = (await pictures(page)).find((p) => p.text.includes('Settings'));
  expect(seen).toMatchObject({ hidden: 'true', pointer: 'none', roles: 0 });
  expect((await played(page)).some((p) => p.ghost && p.on.includes('ui-dialog'))).toBe(true);
});

test('a deleted message breaks apart, the ones below slide up, and the way back to the end is not offered', async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 760 });
  await portal(page);
  await page.goto('/s/a');
  await expect(page.getByText('A answer 5')).toBeVisible();
  // At the end of a conversation that is longer than the window.
  expect(await page.evaluate(() => { const s = document.querySelector('[data-transcript]')!; return s.scrollHeight > s.clientHeight; })).toBe(true);

  // Not while the last messages are still coming in: they are on their way to where they lie, and a click would scroll to them.
  await expect(page.locator('.chat-list')).not.toHaveClass(/is-opening/);
  const message = page.locator('[data-key]', { hasText: 'A question 4' });
  await message.hover();
  await message.getByRole('button', { name: /Delete this message/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();

  await expect(page.getByText('A question 4')).toHaveCount(0);
  await expect.poll(async () => (await pictures(page)).filter((p) => p.text.includes('A question 4')).length).toBeGreaterThan(0);
  // What is below it slid up from where it was.
  expect((await played(page)).some((p) => !p.ghost && p.on.startsWith('div') && p.keys.includes('translate'))).toBe(true);
  // The rows that start below the end made the box scroll further than it does, and it took itself for scrolled away from the end.
  await page.waitForTimeout(1200);
  await expect(page.locator('.jump-to-end')).toHaveCount(0);
});

test('a panel drops away when it is closed, and a carried one flies to its new place instead', async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 760 });
  await portal(page);
  await page.goto('/s/a');
  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  const aside = page.locator('aside[data-dock="right"]');
  await expect(aside).toBeVisible();
  await page.waitForTimeout(900);

  // Carried by its header to the left edge.
  const head = (await aside.locator('.chat-aside-head').boundingBox())!;
  await page.mouse.move(head.x + head.width - 60, head.y + head.height / 2);
  await page.mouse.down();
  await page.mouse.move(head.x + head.width - 120, head.y + 60, { steps: 4 });
  await page.mouse.move(30, 380, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('aside[data-dock="left"]')).toBeVisible();
  const flown = (await played(page)).filter((p) => !p.ghost && p.on.includes('chat-aside-panel'));
  expect(flown).toHaveLength(1);
  // Not also left behind and closed.
  expect((await played(page)).filter((p) => p.ghost)).toEqual([]);
  await page.waitForTimeout(900);

  await page.getByRole('button', { name: 'Close the terminal' }).click();
  await expect(page.locator('aside[data-dock]')).toHaveCount(0);
  expect((await played(page)).some((p) => p.ghost && p.keys.includes('opacity'))).toBe(true);
});

test('what is sent flies off the send button', async ({ page }) => {
  await portal(page);
  await page.route('**/api/sessions/a/prompt', (route) => route.fulfill({ json: { ok: true } }));
  await page.goto('/s/a');
  await page.getByRole('textbox', { name: 'Message' }).fill('Look at the build');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect.poll(async () => (await played(page)).some((p) => p.on === 'svg' && p.keys.includes('transform'))).toBe(true);
});

test('with the switch off none of it is made: no doors, no pictures, no animation from script', async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 760 });
  await portal(page, { off: true });
  await page.goto('/s/a');
  await expect(page.getByText('A answer 5')).toBeVisible();
  await expect(motion(page)).not.toHaveAttribute('data-motion', /.+/);

  await deleteChat(page, 'Fourth chat');
  await expect(row(page, 'Fourth chat')).toHaveCount(0);
  await row(page, 'Second chat').click();
  await expect(page.getByText('B answer 5')).toBeVisible();
  await expect(page.locator('.chat-list')).not.toHaveClass(/is-opening/);
  await sidebar(page).getByRole('button', { name: 'Settings' }).click();
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.waitForTimeout(600);

  expect(await played(page)).toEqual([]);
  expect(await pictures(page)).toEqual([]);
  expect(await page.evaluate(() => (window as any).intro.length)).toBe(0);
});

test('closing one of two places plays that place, not the other that stays', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 800 });
  // Files at the left, the terminal at the right.
  await portal(page, { places: { files: 'left' } });
  await page.goto('/s/a');
  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await expect(page.locator('aside[data-dock="right"]')).toBeVisible();
  await expect(page.locator('aside[data-dock="left"]')).toBeVisible();
  await page.waitForTimeout(900);

  await page.getByRole('button', { name: 'Close the terminal' }).click();
  await expect(page.locator('aside[data-dock="right"]')).toHaveCount(0);
  // What went was the terminal's place; the files stay where they are.
  await expect.poll(async () => (await pictures(page)).map((p) => p.dock)).toEqual(['right']);
  await expect(page.locator('aside[data-dock="left"]')).toBeVisible();
  await page.waitForTimeout(600);

  // And the one that stayed drops away in its turn when it goes.
  await page.getByRole('button', { name: 'Close the files' }).click();
  await expect(page.locator('aside[data-dock]')).toHaveCount(0);
  await expect.poll(async () => (await pictures(page)).map((p) => p.dock)).toEqual(['right', 'left']);
});

test('two messages deleted close together leave the list as it was', async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 760 });
  // With confirmations off a delete is one press.
  await portal(page, { confirms: false });
  await page.goto('/s/a');
  await expect(page.getByText('A answer 5')).toBeVisible();
  await expect(page.locator('.chat-list')).not.toHaveClass(/is-opening/);

  // The second while the first is still sliding what is below it up.
  await page.evaluate(async () => {
    const del = (text: string) => ([...document.querySelectorAll('[data-key]')].find((r) => r.textContent?.includes(text))!.querySelector('button[aria-label^="Delete this message"]') as HTMLElement).click();
    del('A question 4');
    await new Promise((r) => setTimeout(r, 250));
    del('A question 3');
  });
  await expect(page.getByText('A question 3')).toHaveCount(0);
  await page.waitForTimeout(1500);
  // Cut off at its edge only while they slide: a long reply still scrolls sideways, and the next message comes in whole.
  expect(await page.locator('.chat-list').evaluate((el: HTMLElement) => [el.style.overflow, el.style.overflowClipMargin])).toEqual(['', '']);
  expect((await pictures(page)).filter((p) => p.text.includes('A question')).length).toBeGreaterThan(1);
});

test('nothing comes in from the right of the box that scrolls it', async ({ page }) => {
  // A chat column narrower than the list is wide: beside the sidebar, at the width where it is still there.
  await page.setViewportSize({ width: 800, height: 760 });
  await portal(page);
  await page.goto('/s/a');
  await expect(page.getByText('A answer 5')).toBeVisible();
  await expect(page.locator('.chat-list')).not.toHaveClass(/is-opening/);

  /** The most a box is wider than it shows, over the next second. */
  const watch = (selector: string) => page.evaluate((selector) => {
    const box = document.querySelector(selector)!;
    const seen = ((window as any).wider = { most: 0 });
    const until = performance.now() + 1100;
    const tick = () => {
      seen.most = Math.max(seen.most, box.scrollWidth - box.clientWidth);
      if (performance.now() < until) requestAnimationFrame(tick);
    };
    tick();
  }, selector);
  const widest = async () => { await page.waitForTimeout(1200); return page.evaluate(() => (window as any).wider.most as number); };

  // What you say, coming in.
  await watch('[data-transcript]');
  await page.evaluate(() => (window as any).emit('a', { seq: 800, type: 'portal_prompt', payload: { message: 'And one thing more' } }));
  await expect(page.getByText('And one thing more')).toBeVisible();
  expect(await widest()).toBe(0);

  // A page of Settings, coming in.
  await sidebar(page).getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.waitForTimeout(900);
  await watch('div:has(> .settings-page)');
  await page.getByRole('dialog').getByRole('button', { name: 'This browser' }).click();
  await expect(page.getByRole('switch', { name: 'Fancy animations' })).toBeVisible();
  expect(await widest()).toBe(0);
});

test('turning the animations on or off does not play again what is on the page', async ({ page }) => {
  await portal(page);
  await page.goto('/s/a');
  await sidebar(page).getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'This browser' }).click();
  await expect(page.getByRole('switch', { name: 'Fancy animations' })).toBeVisible();
  // Everything that was coming in has come.
  const going = () => page.evaluate(() => new Promise<number>((done) => requestAnimationFrame(() => done(document.getAnimations().filter((a) => 'animationName' in a && Number.isFinite(a.effect!.getComputedTiming().iterations!) && a.playState === 'running').length))));
  await expect.poll(going, { timeout: 8000 }).toBe(0);

  await page.getByRole('switch', { name: 'Fancy animations' }).click();
  await expect(motion(page)).not.toHaveAttribute('data-motion', /.+/);
  expect(await going()).toBe(0);
  await page.getByRole('switch', { name: 'Fancy animations' }).click();
  await expect(motion(page)).toHaveAttribute('data-motion', 'fancy');
  expect(await going()).toBe(0);
});
