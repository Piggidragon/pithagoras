import { test, expect, type Page } from '@playwright/test';

/**
 * The keyboard in the dialogs that cover the page: Settings (the shared Modal),
 * an extension's question, and the phone's navigation drawer. Focus goes in,
 * Tab goes round, and Escape gives focus back to where it was.
 */
const at = new Date().toISOString();
const chat = { id: 'a', title: 'Chat A', workspace: '/w/site', status: 'idle', kind: 'task', pinned: false, updated_at: at, created_at: at, provider: null, model: null, thinking_level: null };

async function portal(page: Page) {
  const answered: unknown[] = [];
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    let reply: unknown = {};
    if (p === '/api/auth/status') reply = { authed: true, authRequired: false };
    else if (p === '/api/sessions') reply = { sessions: [chat], executor: 'host' };
    else if (/^\/api\/sessions\/\w+$/.test(p)) reply = chat;
    else if (p.endsWith('/ui-response')) {
      answered.push(route.request().postDataJSON());
      reply = { ok: true };
    } else if (p.endsWith('/config')) reply = { live: false, state: null, stats: null, thinking: { levels: [] }, models: { models: [] }, named: { provider: null, model: null } };
    else if (p.endsWith('/canvases')) reply = [];
    else if (p === '/api/workspaces') reply = { root: '/w', workspaces: [] };
    else if (p === '/api/models') reply = { models: [], providers: {} };
    else if (p === '/api/routines/report-targets') reply = { targets: [], default: null };
    else if (p === '/api/tool-names') reply = { names: {} };
    else if (p === '/api/settings') {
      const defaults = { provider: 'llama-swap', model: 'Ornith', thinkingLevel: 'medium' };
      reply = { settings: defaults, stored: {}, defaults, piSettingsPath: '/a/settings.json', compaction: { keepRecentTokens: 20000 }, compactionDefaults: { keepRecentTokens: 20000 }, contextDefault: null, executor: 'host', workspaceRoot: '/w' };
    }
    await route.fulfill({ json: reply });
  });
  await page.addInitScript(() => {
    localStorage.setItem('pithagoras.setup', 'done');
    const streams: any[] = ((window as any).streams = []);
    (window as any).EventSource = class {
      closed = false; onmessage: any; onopen: any; onerror: any;
      listeners: Record<string, ((e: any) => void)[]> = {};
      constructor() {
        streams.push(this);
        setTimeout(() => this.onopen?.(), 0);
      }
      addEventListener(name: string, fn: (e: any) => void) { (this.listeners[name] ??= []).push(fn); }
      close() { this.closed = true; }
      emit(name: string, data: unknown) {
        const e = { data: JSON.stringify(data) };
        if (name === 'message') this.onmessage?.(e);
        else (this.listeners[name] ?? []).forEach((fn) => fn(e));
      }
    };
  });
  return { answered };
}

/** Waits for the chat's stream, and says its history has come. */
async function caughtUp(page: Page) {
  await expect.poll(() => page.evaluate(() => (window as any).streams.filter((s: any) => !s.closed).length)).toBeGreaterThan(0);
  await page.evaluate(() => (window as any).streams.filter((s: any) => !s.closed).at(-1).emit('caught-up', {}));
}

/** Whether focus is inside the dialog with this name (the dialog itself counts). */
const focusIn = (page: Page, name: string) =>
  page.evaluate((n) => !!document.querySelector(`[role="dialog"][aria-label="${n}"]`)?.contains(document.activeElement), name);

/** Tab (or Shift+Tab) round the dialog twice over: focus must never leave it. */
async function goesRound(page: Page, name: string, shift = false) {
  for (let i = 0; i < 70; i++) {
    await page.keyboard.press(shift ? 'Shift+Tab' : 'Tab');
    expect(await focusIn(page, name), `after ${i + 1} presses`).toBe(true);
  }
}

test('Settings takes focus, keeps Tab inside, and gives focus back when it closes', async ({ page }) => {
  await portal(page);
  await page.goto('/s/a');
  const opener = page.getByRole('button', { name: 'Settings', exact: true }).first();
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  await expect.poll(() => focusIn(page, 'Settings')).toBe(true);
  await goesRound(page, 'Settings');
  await goesRound(page, 'Settings', true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("an extension's question takes focus, keeps Tab inside, and gives focus back to the composer", async ({ page }) => {
  const { answered } = await portal(page);
  await page.goto('/s/a');
  const composer = page.getByLabel('Message', { exact: true });
  await composer.focus();
  await caughtUp(page);
  await page.evaluate(() =>
    (window as any).streams.filter((s: any) => !s.closed).at(-1).emit('message', { seq: -1, type: 'extension_ui_request', payload: { id: 'q1', method: 'select', title: 'Pick one', options: ['One', 'Two'] } }),
  );
  const dialog = page.getByRole('dialog', { name: 'Pick one' });
  await expect(dialog).toBeVisible();
  await expect.poll(() => focusIn(page, 'Pick one')).toBe(true);
  await goesRound(page, 'Pick one');
  await goesRound(page, 'Pick one', true);
  // Its close button has a name, as Settings' has.
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  expect(answered).toEqual([{ id: 'q1', cancelled: true }]);
  await expect(composer).toBeFocused();
});

test('the phone drawer is a dialog that keeps the keyboard, and is only that while it covers the page', async ({ page }) => {
  await portal(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/s/a');
  await caughtUp(page);
  const open = page.getByRole('button', { name: 'Open navigation', exact: true });
  await expect(page.getByRole('dialog', { name: 'Navigation' })).toHaveCount(0);
  await open.focus();
  await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog', { name: 'Navigation' });
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAttribute('aria-modal', 'true');
  await expect.poll(() => focusIn(page, 'Navigation')).toBe(true);
  await goesRound(page, 'Navigation');
  await goesRound(page, 'Navigation', true);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(open).toBeFocused();
  // Widened to a window that has the sidebar in place, the drawer is not left open round it.
  await page.keyboard.press('Enter');
  await expect(drawer).toBeVisible();
  await page.setViewportSize({ width: 1000, height: 812 });
  await expect(page.getByRole('dialog', { name: 'Navigation' })).toHaveCount(0);
  await expect(page.getByLabel('Sidebar', { exact: true })).toBeVisible();
});
