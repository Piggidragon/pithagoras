import { test, expect, type Locator, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    class CanvasEvents { onmessage: any; onopen: any; constructor() { (window as any).canvasEvents = this; setTimeout(() => this.onopen?.(), 20); } close() {} }
    (window as any).EventSource = CanvasEvents;
  });
  await page.route('**/api/sessions/test/commands', route => route.fulfill({ json: { commands: [] } }));
  await page.route('**/api/sessions/test/config', route => route.fulfill({ status: 503, json: {} }));
  await page.route('**/api/voice', route => route.fulfill({ json: { enabled: true } }));
  await page.route('**/api/browser', route => route.fulfill({ json: { install: { container: 'running' } } }));
  await page.route('**/browser-ui/', route => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0;background:#171a20;color:#d1d8e3;padding:36px">A browser, in view.</body>' }));
  await page.setViewportSize({ width: 1400, height: 860 });
  await page.goto('/tests/voice.html');
  await page.getByRole('button', { name: 'Turn on hands-free voice' }).click();
  await expect(page.getByRole('status')).toHaveText('Listening', { timeout: 25000 });
});

/** Drags a window's edge by `dx`, in small steps as a hand would. */
async function drag(page: Page, handle: Locator, dx: number) {
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 12 });
  await page.mouse.up();
}

const box = async (l: Locator) => (await l.boundingBox())!;

test('two windows cannot be dragged over each other, and a gap between them brings the orb back', async ({ page }) => {
  await page.getByRole('button', { name: 'Use browser', exact: true }).click();
  await page.getByRole('button', { name: 'Use terminal', exact: true }).click();
  const browser = page.locator('.voice-browser-window'), terminal = page.locator('.voice-terminal-window');
  await expect(terminal).toHaveClass(/is-open/);
  await page.waitForTimeout(900);

  await drag(page, browser.locator('.resize-e'), 600);
  expect((await box(terminal)).x - ((await box(browser)).x + (await box(browser)).width)).toBeGreaterThanOrEqual(15);
  await drag(page, terminal.locator('.resize-w'), -600);
  expect((await box(terminal)).x - ((await box(browser)).x + (await box(browser)).width)).toBeGreaterThanOrEqual(15);
  const stage = await box(page.locator('.voice-stage'));
  expect((await box(browser)).x).toBeGreaterThanOrEqual(stage.x);

  // Docked while the windows leave no room; standing in the gap once there is.
  const presence = page.locator('.voice-presence');
  await expect(page.locator('.voice-stage')).not.toHaveAttribute('data-presence', 'free');
  await drag(page, browser.locator('.resize-e'), -700);
  await drag(page, terminal.locator('.resize-w'), 300);
  await expect(page.locator('.voice-stage')).toHaveAttribute('data-presence', 'free');
  await page.waitForTimeout(900);
  const orb = await box(presence), left = await box(browser), right = await box(terminal);
  expect(orb.x).toBeGreaterThanOrEqual(left.x + left.width);
  expect(orb.x + orb.width).toBeLessThanOrEqual(right.x);
  expect(orb.height).toBeGreaterThan(150);
  await page.getByTestId('workspace').screenshot({ path: '/tmp/pithagoras-voice-gap.png' });

  // Closing the gap again sends it back to its dock.
  await drag(page, browser.locator('.resize-e'), 700);
  await expect(page.locator('.voice-stage')).not.toHaveAttribute('data-presence', 'free');
});

test('the browser maximizes within the stage, not the page, and gives its place back', async ({ page }) => {
  await page.getByRole('button', { name: 'Use browser', exact: true }).click();
  const browser = page.locator('.voice-browser-window');
  await expect(browser).toHaveClass(/is-open/);
  await page.getByRole('button', { name: 'Maximize browser' }).click();
  await expect(browser).toHaveClass(/is-maximized/);
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
  const stage = await box(page.locator('.voice-stage'));
  await page.waitForTimeout(300);
  expect((await box(browser)).width).toBeGreaterThan(stage.width - 30);
  await expect(page.getByRole('button', { name: 'End voice mode' })).toBeVisible();
  await page.getByTestId('workspace').screenshot({ path: '/tmp/pithagoras-voice-maximized.png' });

  await page.getByRole('button', { name: 'Restore browser size' }).click();
  await expect(browser).not.toHaveClass(/is-maximized/);
  await page.getByRole('button', { name: 'Maximize browser' }).click();
  await page.keyboard.press('Escape');
  await expect(browser).not.toHaveClass(/is-maximized/);
  await expect(page.getByRole('button', { name: 'End voice mode' })).toBeVisible();

  // Minimized while large, it opens again at its usual size.
  await page.getByRole('button', { name: 'Maximize browser' }).click();
  await page.getByRole('button', { name: 'Minimize browser' }).click();
  await expect(browser).not.toHaveClass(/is-open/);
  await page.getByRole('button', { name: 'Show browser' }).click();
  await expect(browser).toHaveClass(/is-open/);
  await expect(browser).not.toHaveClass(/is-maximized/);
});

test('a single window stays inside its workspace and the orb moves aside for it', async ({ page }) => {
  await page.evaluate(() => (window as any).canvasEvents.onmessage({ data: JSON.stringify({ type: 'update', canvas: { id: 'doc', title: 'A shared draft', content: '# Draft', revision: 1, status: 'writing', active_call: 'draft', updated_at: '' } }) }));
  const canvas = page.getByLabel('Session canvas workspace');
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(900);
  const panel = page.locator('.canvas-panel');
  await drag(page, panel.locator('.resize-w'), -1200);
  const workspace = await box(page.getByTestId('workspace'));
  expect((await box(panel)).x).toBeGreaterThanOrEqual(workspace.x);
  await expect(page.locator('.voice-stage')).not.toHaveAttribute('data-presence', 'free');
  const orb = await box(page.locator('.voice-presence'));
  expect(orb.height).toBeLessThan(100);

  await drag(page, panel.locator('.resize-w'), 500);
  await expect(page.locator('.voice-stage')).toHaveAttribute('data-presence', 'free');
  await page.waitForTimeout(900);
  const standing = await box(page.locator('.voice-presence'));
  expect(standing.x + standing.width).toBeLessThanOrEqual((await box(panel)).x);
  await page.getByTestId('workspace').screenshot({ path: '/tmp/pithagoras-voice-canvas-sized.png' });
});

/** Drags a handle by `dx` and `dy`, in small steps as a hand would. */
async function drag2(page: Page, handle: Locator, dx: number, dy: number) {
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  await page.mouse.up();
}

const openCanvas = async (page: Page) => {
  await page.evaluate(() => (window as any).canvasEvents.onmessage({ data: JSON.stringify({ type: 'update', canvas: { id: 'doc', title: 'A shared draft', content: '# Draft', revision: 1, status: 'writing', active_call: 'draft', updated_at: '' } }) }));
  await expect(page.getByLabel('Session canvas workspace')).toBeVisible();
};
const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

test('a maximized browser is not covered by the canvas, and nothing moves under it', async ({ page }) => {
  await openCanvas(page);
  await page.getByRole('button', { name: 'Use browser', exact: true }).click();
  const browser = page.locator('.voice-browser-window'), panel = page.locator('.canvas-panel');
  await expect(browser).toHaveClass(/is-open/);
  await page.waitForTimeout(900);
  const before = await box(panel);
  await page.getByRole('button', { name: 'Maximize browser' }).click();
  await page.waitForTimeout(900);
  await expect(panel).toBeHidden();
  await expect(page.locator('.voice-stage')).toHaveAttribute('data-panels', '2');
  await page.getByRole('button', { name: 'Restore browser size' }).click();
  await expect(panel).toBeVisible();
  expect(await box(panel)).toEqual(before);
});

test('a browser closed for a third window is not maximized any more: Escape is Stop again, and it opens at its size', async ({ page }) => {
  await page.getByRole('button', { name: 'Use browser', exact: true }).click();
  const browser = page.locator('.voice-browser-window');
  await page.getByRole('button', { name: 'Maximize browser' }).click();
  await page.getByRole('button', { name: 'Use terminal', exact: true }).click();
  await page.getByRole('button', { name: 'Show files' }).click();
  await expect(browser).not.toHaveClass(/is-open/);
  await page.getByRole('button', { name: 'Show browser' }).click();
  await expect(browser).toHaveClass(/is-open/);
  await expect(browser).not.toHaveClass(/is-maximized/);
  await page.getByRole('button', { name: 'Minimize browser' }).click();
  // Nothing running: Escape ends voice mode, where a maximized browser would have taken it.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'End voice mode' })).toHaveCount(0);
});

test('Escape restores the browser from inside the page in it', async ({ page }) => {
  await page.getByRole('button', { name: 'Use browser', exact: true }).click();
  const browser = page.locator('.voice-browser-window');
  await page.getByRole('button', { name: 'Maximize browser' }).click();
  await page.frameLocator('.voice-browser-window iframe').locator('body').click();
  await page.keyboard.press('Escape');
  await expect(browser).not.toHaveClass(/is-maximized/);
  await expect(page.getByRole('button', { name: 'End voice mode' })).toBeVisible();
});

test('on a phone the maximized browser ends above the dock', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Use browser', exact: true }).click();
  await page.getByRole('button', { name: 'Maximize browser' }).click();
  await page.waitForTimeout(900);
  const browser = await box(page.locator('.voice-browser-window')), dock = await box(page.locator('.voice-presence'));
  expect(browser.y + browser.height).toBeLessThanOrEqual(dock.y);
});

test('the canvas stops above the dock', async ({ page }) => {
  await openCanvas(page);
  await page.getByRole('button', { name: 'Use browser', exact: true }).click();
  await page.waitForTimeout(900);
  const panel = page.locator('.canvas-panel');
  await drag2(page, panel.locator('.resize-s'), 0, 500);
  const dock = await box(page.locator('.voice-presence'));
  expect((await box(panel)).y + (await box(panel)).height).toBeLessThanOrEqual(dock.y - 15);
});

test('a window dragged by its corner stops short of a window off that corner', async ({ page }) => {
  await openCanvas(page);
  await page.waitForTimeout(900);
  const panel = page.locator('.canvas-panel');
  await drag2(page, panel.locator('.resize-s'), 0, -250);
  // A window below and to the left of the canvas, touching it at neither side.
  const c = await box(panel), ws = await box(page.getByTestId('workspace'));
  await page.evaluate(({ left, top }) => {
    const w = document.createElement('section');
    w.className = 'voice-files-window is-open';
    Object.assign(w.style, { left: `${left}px`, top: `${top}px`, width: '200px', height: '120px', transform: 'none', transition: 'none', visibility: 'visible', opacity: '1' });
    document.querySelector('.session-workspace')!.appendChild(w);
  }, { left: c.x - ws.x - 250, top: c.y - ws.y + c.height + 20 });
  const other = await box(page.locator('.session-workspace > .voice-files-window'));
  expect(other.y).toBeGreaterThan(c.y + c.height);
  await drag2(page, panel.locator('.resize-sw'), -200, 80);
  const after = await box(panel);
  expect(after.width).toBeGreaterThan(c.width + 100);
  expect(overlap(after, other)).toBe(false);
});

test('a window that reached down beside the orb is lifted clear of the dock when the orb goes back to it', async ({ page }) => {
  await page.getByRole('button', { name: 'Use terminal', exact: true }).click();
  const terminal = page.locator('.voice-terminal-window');
  await expect(terminal).toHaveClass(/is-open/);
  await page.waitForTimeout(900);
  await drag2(page, terminal.locator('.resize-s'), 0, 300);
  await drag(page, terminal.locator('.resize-w'), -330);
  await expect(page.locator('.voice-stage')).toHaveAttribute('data-panels', 'dock');
  await page.waitForTimeout(1000);
  const t = await box(terminal), dock = await box(page.locator('.voice-presence'));
  expect(t.y + t.height).toBeLessThanOrEqual(dock.y - 15);
});

test('a canvas sized by hand takes its place again when another window opens', async ({ page }) => {
  await openCanvas(page);
  await page.waitForTimeout(900);
  const panel = page.locator('.canvas-panel');
  await drag(page, panel.locator('.resize-w'), -150);
  await page.getByRole('button', { name: 'Use browser', exact: true }).click();
  await page.waitForTimeout(1000);
  expect(overlap(await box(panel), await box(page.locator('.voice-browser-window')))).toBe(false);
  await expect(page.locator('.voice-stage')).not.toHaveAttribute('data-presence', 'free');
});

test('the orb is placed again when a window slides, not at every hover or fade on the stage', async ({ page }) => {
  await page.getByRole('button', { name: 'Use terminal', exact: true }).click();
  await page.waitForTimeout(900);
  // How often the stage is measured — once each time the orb is placed — for five transitions ending on `on`.
  const placings = (on: string, property: string) => page.evaluate(async ({ on, property }) => {
    const stage = document.querySelector('.voice-stage')!;
    let reads = 0;
    const read = stage.getBoundingClientRect;
    stage.getBoundingClientRect = function () { reads++; return read.call(this); };
    for (let i = 0; i < 5; i++) {
      document.querySelector(on)!.dispatchEvent(new TransitionEvent('transitionend', { propertyName: property, bubbles: true }));
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    stage.getBoundingClientRect = read;
    return reads;
  }, { on, property });
  expect(await placings('.voice-utilities button', 'background-color')).toBe(0);
  expect(await placings('.voice-presence', 'padding-left')).toBe(0);
  expect(await placings('.voice-terminal-window', 'width')).toBeGreaterThan(0);
});
