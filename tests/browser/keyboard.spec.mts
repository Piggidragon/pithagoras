import { test, expect } from '@playwright/test';

const session = { id: 'phone', title: 'Typing on a phone', workspace: '/workspaces/demo', status: 'idle', kind: 'task', pinned: false };

test('the keyboard opening moves the composer up to it, and nothing else', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    const value = p.endsWith('/auth/status') ? { authed: true } : p === '/api/sessions' ? { sessions: [session], executor: 'host' } : p.endsWith('/commands') ? { commands: [] } : p === '/api/voice' ? { enabled: false } : p.endsWith('/canvases') ? [] : p === '/api/browser' ? { running: false } : session;
    await route.fulfill({ json: value });
  });
  await page.addInitScript(() => {
    (window as any).EventSource = class { onmessage: any; onopen: any; onerror: any; addEventListener() {} close() {} };
    localStorage.setItem('sidebarCollapsed', 'true');
    // Safari's keyboard: the page keeps its height, the visual viewport above the keyboard gets shorter.
    const visual = Object.assign(new EventTarget(), { height: innerHeight, width: innerWidth, offsetTop: 0, offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { value: visual, configurable: true });
    (window as any).keyboard = (px: number) => { visual.height = innerHeight - px; visual.dispatchEvent(new Event('resize')); };
  });
  await page.goto('/s/phone');
  const title = page.getByRole('button', { name: 'Typing on a phone' }).first();
  const composer = page.getByLabel('Message', { exact: true });
  await expect(composer).toBeVisible();
  await composer.focus();
  // Settled: the composer comes in with a short slide.
  await page.waitForTimeout(800);
  const before = { title: (await title.boundingBox())!, composer: (await composer.boundingBox())! };
  expect(await page.locator('meta[name=viewport]').getAttribute('content')).toContain('interactive-widget=resizes-content');

  await page.evaluate(() => (window as any).keyboard(320));
  // The composer sits on the keyboard; it was under it, the whole page left where it was.
  await expect.poll(async () => { const b = (await composer.boundingBox())!; return b.y + b.height; }).toBeLessThanOrEqual(780 - 320);
  expect((await composer.boundingBox())!.y).toBeLessThan(before.composer.y - 250);
  // The header stays where it was.
  expect(Math.abs((await title.boundingBox())!.y - before.title.y)).toBeLessThan(2);
  expect(await page.evaluate(() => scrollY)).toBe(0);

  // Closed again: all back.
  await page.evaluate(() => (window as any).keyboard(0));
  await expect.poll(async () => (await composer.boundingBox())!.y).toBeCloseTo(before.composer.y, 0);
});
