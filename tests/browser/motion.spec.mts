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

interface Played { on: string; keys: string[]; ghost: boolean; duration: number }
interface Picture { text: string; hidden: string | null; pointer: string; roles: number; dock: string | null; scrollTop: number }

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
async function portal(page: Page, { off = false, confirms = true, places, many = false }: { off?: boolean; confirms?: boolean; places?: Record<string, string>; many?: boolean } = {}) {
  // More than the sidebar lists without a search box, when asked.
  const extra = many ? Array.from({ length: 10 }, (_, i) => chat(`x${i}`, `Extra chat ${i}`)) : [];
  const state = { sessions: [chat('a', 'First chat'), chat('b', 'Second chat'), chat('c', 'Third chat'), chat('d', 'Fourth chat'), ...extra], events: { a: conversation('A'), b: conversation('B'), c: [] as any[], d: [] as any[], r: conversation('R') } as Record<string, any[]> };
  // A routine's chat: opened by its address, and not in the list of chats.
  const routine = chat('r', 'Routine chat', { kind: 'routine' });
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    const method = route.request().method();
    let reply: unknown = {};
    let m: RegExpMatchArray | null;
    if (p === '/api/auth/status') reply = { authed: true, authRequired: false };
    else if (p === '/api/sessions' && method === 'GET') reply = { sessions: state.sessions, executor: 'host' };
    else if (p === '/api/sessions' && method === 'POST') {
      const made = chat(`n${state.sessions.length}`, 'A new chat');
      state.sessions = [made, ...state.sessions];
      state.events[made.id] = [];
      reply = made;
    } else if (p === '/api/sessions/r') reply = routine;
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
      played.push({ on: `${this.tagName.toLowerCase()}${this.className && typeof this.className === 'string' ? '.' + this.className.split(' ')[0] : ''}`, keys: Object.keys(first ?? {}), ghost: !!this.closest('[data-ghost]'), duration: options?.duration ?? 0 });
      return animate.call(this, frames, options);
    };
    const pictures: Picture[] = ((window as any).pictures = []);
    const intro: { pointer: string; at: number }[] = ((window as any).intro = []);
    new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) {
        if (!(n instanceof HTMLElement)) continue;
        if (n.hasAttribute('data-ghost')) pictures.push({ text: (n.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 4000), hidden: n.getAttribute('aria-hidden'), pointer: getComputedStyle(n).pointerEvents, roles: n.querySelectorAll('[role], [aria-modal], [id]').length, dock: n.firstElementChild?.getAttribute('data-dock') ?? null, scrollTop: (n.firstElementChild as HTMLElement | null)?.scrollTop ?? 0 });
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

test('a chat that is left keeps in its picture where its conversation was scrolled to', async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 760 });
  await portal(page);
  await page.goto('/s/a');
  await expect(page.getByText('A answer 5')).toBeVisible();
  await expect(page.locator('.chat-list')).not.toHaveClass(/is-opening/);
  const at = await page.locator('[data-transcript]').evaluate((el) => el.scrollTop);
  expect(at).toBeGreaterThan(100);

  await row(page, 'Second chat').click();
  await expect.poll(async () => (await pictures(page)).filter((p) => p.text.includes('A answer 5')).length).toBeGreaterThan(0);
  // The end of it, where it was read, and not its start.
  const seen = (await pictures(page)).find((p) => p.text.includes('A answer 5'))!;
  expect(Math.abs(seen.scrollTop - at)).toBeLessThanOrEqual(1);
});

test('a chat that is deleted dissolves, and one the list never had does not', async ({ page }) => {
  await portal(page);
  // A routine's chat, opened by its address and left for another.
  await page.goto('/s/r');
  await expect(page.getByText('R answer 5')).toBeVisible();
  await expect(page.locator('.chat-list')).not.toHaveClass(/is-opening/);
  await row(page, 'Second chat').click();
  await expect(page.getByText('B answer 5')).toBeVisible();
  // Drifts away (340 ms), as any chat does.
  expect((await played(page)).filter((p) => p.ghost).map((p) => p.duration)).toEqual([340]);

  // One that is deleted, open, shrinks away (520 ms).
  await page.goto('/s/a');
  await expect(page.getByText('A answer 5')).toBeVisible();
  await deleteChat(page, 'First chat');
  await expect.poll(async () => (await played(page)).filter((p) => p.ghost).map((p) => p.duration)).toContain(520);
});

test('a new chat is not shown its empty state twice', async ({ page }) => {
  await portal(page);
  await page.goto('/s/a');
  await expect(page.getByText('A answer 5')).toBeVisible();
  await sidebar(page).getByRole('button', { name: 'New', exact: true }).click();
  await expect(page.getByText('Give pi a task.')).toBeVisible();
  // Past the second in which a chat that has just loaded plays its messages in (not the copy of the one that was left, which has the same list).
  await expect(page.locator('main .chat-list')).not.toHaveClass(/is-opening/);
  await page.waitForTimeout(150);
  expect(await page.locator('.chat-empty').evaluate((el) => el.getAnimations().filter((a) => a.playState === 'running').length)).toBe(0);
});

test('a panel that has flown to its place does not come in again', async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 760 });
  await portal(page);
  await page.goto('/s/a');
  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  const aside = page.locator('aside[data-dock="right"]');
  await expect(aside).toBeVisible();
  await page.waitForTimeout(900);
  const head = (await aside.locator('.chat-aside-head').boundingBox())!;
  await page.mouse.move(head.x + head.width - 60, head.y + head.height / 2);
  await page.mouse.down();
  await page.mouse.move(head.x + head.width - 120, head.y + 60, { steps: 4 });
  await page.mouse.move(30, 380, { steps: 10 });
  await page.mouse.up();
  const there = page.locator('aside[data-dock="left"]');
  await expect(there).toBeVisible();
  // Its flight is 620 ms; a moment after it, nothing of the entrance a panel that opens has is going.
  await page.waitForTimeout(900);
  expect(await there.evaluate((el) => el.getAnimations({ subtree: true }).filter((a) => 'animationName' in a && a.playState === 'running').length)).toBe(0);
});

test('a search that ends does not bring the rows it hid in as new ones', async ({ page }) => {
  await portal(page, { many: true });
  await page.goto('/s/a');
  await expect(sidebar(page).getByRole('searchbox', { name: 'Search chats' })).toBeVisible();
  await page.waitForTimeout(1500);
  const search = sidebar(page).getByRole('searchbox', { name: 'Search chats' });
  await search.fill('Fourth');
  await expect(row(page, 'Extra chat 3')).toHaveCount(0);
  await page.waitForTimeout(700);

  const before = (await played(page)).length;
  await search.fill('');
  await expect(row(page, 'Extra chat 3')).toBeVisible();
  await page.waitForTimeout(900);
  expect((await played(page)).slice(before).filter((p) => p.on.includes('session-row'))).toEqual([]);
});

test("Settings' rail is not drawn in again when its search ends", async ({ page }) => {
  await portal(page);
  await page.goto('/s/a');
  await sidebar(page).getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  // Past the dialog's own entrance, rail included.
  await page.waitForTimeout(1500);
  const search = page.getByRole('combobox', { name: 'Search settings' });
  await search.fill('theme');
  await expect(page.getByRole('listbox', { name: 'Settings found' })).toBeVisible();
  await search.press('Escape');
  await expect(page.locator('.rail-item').first()).toBeVisible();
  expect(await page.evaluate(() => [...document.querySelectorAll('.rail-item')].flatMap((el) => el.getAnimations()).length)).toBe(0);
});

test("the Stop button of voice mode is there at once when a run starts, and the controls come in together when the stage does", async ({ page }) => {
  // The voice fixture, as voice-windows has it; it does not start the animations itself.
  await page.addInitScript(() => { (window as any).EventSource = class { close() {} }; });
  await page.route('**/api/sessions/test/commands', (route) => route.fulfill({ json: { commands: [] } }));
  await page.route('**/api/sessions/test/config', (route) => route.fulfill({ status: 503, json: {} }));
  await page.route('**/api/voice', (route) => route.fulfill({ json: { enabled: true } }));
  await page.route('**/api/browser', (route) => route.fulfill({ json: { install: { container: 'running' } } }));
  await page.setViewportSize({ width: 1400, height: 860 });
  await page.goto('/tests/voice.html');
  await page.evaluate(() => { document.documentElement.dataset.motion = 'fancy'; });
  await page.getByRole('button', { name: 'Turn on hands-free voice' }).click();
  await expect(page.getByRole('status')).toHaveText('Listening', { timeout: 25000 });
  // As one: not a delay for each, which a button drawn later would wait through too.
  expect(await page.locator('.voice-stage-controls').evaluate((el) => getComputedStyle(el).animationName)).toBe('fx-controls-in');

  await page.getByRole('button', { name: 'Stream reply' }).click();
  const stop = page.getByRole('button', { name: 'Stop the agent' });
  await expect(stop).toBeVisible();
  expect(await stop.evaluate((el) => [getComputedStyle(el).animationName, getComputedStyle(el).opacity])).toEqual(['none', '1']);
});

test('a row that comes in while a chat opens is not played in again when the opening second ends', async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 760 });
  await portal(page);
  await page.goto('/s/a');
  await expect(page.getByText('A answer 5')).toBeVisible();
  await expect(page.locator('main .chat-list')).not.toHaveClass(/is-opening/);

  // From the moment the other chat is drawn: a tool call 100 ms in, and another event at 850 ms, which is any draw.
  const seen = page.evaluate(() => new Promise<[string, string, boolean]>((done) => {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const tool = (seq: number, id: string) => (window as any).emit('b', { seq, type: 'tool_execution_start', payload: { toolCallId: id, toolName: 'bash', args: { command: `echo ${id}` } } });
    const timer = setInterval(async () => {
      if (!document.querySelector('main .chat-list.is-opening')) return;
      clearInterval(timer);
      await wait(100);
      tool(900, 'live-one');
      await wait(750);
      tool(901, 'live-two');
      await wait(120);
      const row = [...document.querySelectorAll('main .chat-list > [data-key]')].find((r) => r.textContent?.includes('live-one'))!;
      const style = getComputedStyle(row);
      done([style.animationName, style.opacity, !!document.querySelector('main .chat-list.is-opening')]);
    }, 5);
  }));
  await row(page, 'Second chat').click();
  const [name, opacity, opening] = await seen;
  // Still in the opening second, and the row is there, not played in a second time.
  expect(opening).toBe(true);
  expect(name).not.toBe('fx-open');
  expect(opacity).toBe('1');
});

test("Settings' extension pages come in once, not again when the dialog stops being new", async ({ page }) => {
  await portal(page);
  // Asked for as the dialog opens, answered a little after: they are the lines that come in with the list's own stagger.
  await page.route('**/api/extensions', async (route) => {
    await new Promise((r) => setTimeout(r, 400));
    await route.fulfill({ json: { extensions: ['One', 'Two'].map((name) => ({ spec: `npm:ext-${name}`, name: `Ext ${name}`, version: '1', description: '', settings: [{ key: 'apiKey', value: '' }] })), settingsPath: '/p/settings.json' } });
  });
  await page.goto('/s/a');
  await page.waitForTimeout(1500);
  const names = page.evaluate(() => new Promise<string[]>((done) => {
    const seen = new Set<string>();
    const until = performance.now() + 2400;
    const tick = () => {
      for (const el of document.querySelectorAll('.rail-item')) if (el.textContent?.includes('Ext ')) seen.add(getComputedStyle(el).animationName);
      if (performance.now() < until) requestAnimationFrame(tick);
      else done([...seen]);
    };
    tick();
  }));
  await sidebar(page).getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('dialog').getByText('Ext One')).toBeVisible();
  // One animation, from the start to the end of it: another name is another one, started over.
  expect((await names).filter((n) => n !== 'none')).toHaveLength(1);
});

test('the options of a list that fits do not make it scroll while they come in', async ({ page }) => {
  await portal(page);
  await page.goto('/s/a');
  await sidebar(page).getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'This browser' }).click();
  const language = page.getByRole('combobox', { name: 'Language' });
  await expect(language).toBeVisible();
  await page.waitForTimeout(900);

  await page.evaluate(() => {
    const seen = ((window as any).taller = { most: 0 });
    const until = performance.now() + 1200;
    const tick = () => {
      const list = document.querySelector('.ui-select-list');
      if (list) seen.most = Math.max(seen.most, list.scrollHeight - list.clientHeight);
      if (performance.now() < until) requestAnimationFrame(tick);
    };
    tick();
  });
  await language.click();
  await expect(page.getByRole('listbox', { name: 'Language' })).toBeVisible();
  await page.waitForTimeout(1300);
  expect(await page.evaluate(() => (window as any).taller.most as number)).toBe(0);
});
