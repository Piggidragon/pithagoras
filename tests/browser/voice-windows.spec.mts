import { test, expect, type Locator, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // The terminal's stream, which has no server behind it here.
    (window as any).EventSource = class { onmessage: any; onopen: any; close() {} };
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
  await expect(page.locator('.voice-stage')).not.toHaveAttribute('data-orb', 'free');
  await drag(page, browser.locator('.resize-e'), -700);
  await drag(page, terminal.locator('.resize-w'), 300);
  await expect(page.locator('.voice-stage')).toHaveAttribute('data-orb', 'free');
  await page.waitForTimeout(900);
  const orb = await box(presence), left = await box(browser), right = await box(terminal);
  expect(orb.x).toBeGreaterThanOrEqual(left.x + left.width);
  expect(orb.x + orb.width).toBeLessThanOrEqual(right.x);
  expect(orb.height).toBeGreaterThan(150);
  await page.getByTestId('workspace').screenshot({ path: '/tmp/pithagoras-voice-gap.png' });

  // Closing the gap again sends it back to its dock.
  await drag(page, browser.locator('.resize-e'), 700);
  await expect(page.locator('.voice-stage')).not.toHaveAttribute('data-orb', 'free');
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
  await page.evaluate(() => (window as any).canvasFeed.message({ type: 'update', canvas: { id: 'doc', title: 'A shared draft', content: '# Draft', revision: 1, status: 'writing', active_call: 'draft', updated_at: '' } }));
  const canvas = page.getByLabel('Session canvas workspace');
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(900);
  const panel = page.locator('.canvas-panel');
  await drag(page, panel.locator('.resize-w'), -1200);
  const workspace = await box(page.getByTestId('workspace'));
  expect((await box(panel)).x).toBeGreaterThanOrEqual(workspace.x);
  await expect(page.locator('.voice-stage')).not.toHaveAttribute('data-orb', 'free');
  const orb = await box(page.locator('.voice-presence'));
  expect(orb.height).toBeLessThan(100);

  await drag(page, panel.locator('.resize-w'), 500);
  await expect(page.locator('.voice-stage')).toHaveAttribute('data-orb', 'free');
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
  await page.evaluate(() => (window as any).canvasFeed.message({ type: 'update', canvas: { id: 'doc', title: 'A shared draft', content: '# Draft', revision: 1, status: 'writing', active_call: 'draft', updated_at: '' } }));
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
  await expect(page.locator('.voice-stage')).toHaveAttribute('data-orb', 'dock');
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
  await expect(page.locator('.voice-stage')).not.toHaveAttribute('data-orb', 'free');
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

test('a window dragged while the orb goes back to its dock is not fought over, and ends clear of the dock', async ({ page }) => {
  await page.getByRole('button', { name: 'Use terminal', exact: true }).click();
  const terminal = page.locator('.voice-terminal-window');
  await page.waitForTimeout(900);
  // Down beside the orb, which stands on its own: nothing holds it there.
  await drag2(page, terminal.locator('.resize-s'), 0, 300);
  await expect(page.locator('.voice-stage')).toHaveAttribute('data-orb', 'free');
  // Every height the window is given while its corner is dragged over the gap, so the orb goes to its dock mid-drag.
  await terminal.evaluate(el => {
    const heights: string[] = ((window as any).heights = []);
    new MutationObserver(() => { if (heights.at(-1) !== el.style.height) heights.push(el.style.height); }).observe(el, { attributes: true, attributeFilter: ['style'] });
  });
  const grip = (await box(terminal.locator('.resize-sw')))!;
  const x = grip.x + 8, y = grip.y + 8;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 30; i++) { await page.mouse.move(x - i * 11, y + i * 2); await page.waitForTimeout(20); }
  await expect(page.locator('.voice-stage')).toHaveAttribute('data-orb', 'dock');
  const during = await page.evaluate(() => (window as any).heights.map(parseFloat) as number[]);
  await page.mouse.up();
  // Growing all the way, never pulled back up and pushed down again in turn.
  const turns = during.slice(2).filter((h, i) => Math.sign(h - during[i + 1]) !== Math.sign(during[i + 1] - during[i])).length;
  expect(turns).toBe(0);
  await page.waitForTimeout(1000);
  const t = await box(terminal), dock = await box(page.locator('.voice-presence'));
  expect(t.y + t.height).toBeLessThanOrEqual(dock.y - 15);
});

test('a window opening while the browser is maximized gives it its place back', async ({ page }) => {
  await page.getByRole('button', { name: 'Use browser', exact: true }).click();
  const browser = page.locator('.voice-browser-window');
  await page.getByRole('button', { name: 'Maximize browser' }).click();
  // The agent runs a command: the terminal opens for it.
  await page.getByRole('button', { name: 'Use terminal', exact: true }).click();
  await expect(browser).not.toHaveClass(/is-maximized/);
  await expect(page.locator('.voice-terminal-window')).toHaveClass(/is-open/);
  await page.getByRole('button', { name: 'Maximize browser' }).click();
  await page.getByRole('button', { name: 'Session canvases' }).click();
  await expect(browser).not.toHaveClass(/is-maximized/);
  await expect(page.getByLabel('Session canvas workspace')).toBeVisible();
});

test('pictures waiting to be sent do not cover the maximized browser\'s buttons', async ({ page }) => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');
  await page.locator('.voice-stage input[type=file]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('button', { name: 'Use browser', exact: true }).click();
  await page.getByRole('button', { name: 'Maximize browser' }).click();
  await page.waitForTimeout(900);
  for (const name of ['Restore browser size', 'Minimize browser']) {
    const b = await box(page.getByRole('button', { name }));
    const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label'), { x: b.x + b.width / 2, y: b.y + b.height / 2 });
    expect(hit).toBe(name);
  }
  await page.getByRole('button', { name: 'Minimize browser' }).click();
  await expect(page.getByLabel('Pictures for your next message').getByRole('img', { name: 'photo.png' })).toHaveCount(1);
});

test('Escape in a field of the browser viewer\'s own is that field\'s; in the one it passes keys on through, it restores', async ({ page }) => {
  await page.getByRole('button', { name: 'Use browser', exact: true }).click();
  const browser = page.locator('.voice-browser-window');
  await page.getByRole('button', { name: 'Maximize browser' }).click();
  const frame = page.frameLocator('.voice-browser-window iframe');
  await frame.locator('body').evaluate(b => { b.insertAdjacentHTML('beforeend', '<input aria-label="Search settings"><input id="overlayInput" type="search" aria-label="Keys">'); });
  await frame.getByLabel('Search settings').click();
  await page.keyboard.press('Escape');
  await expect(browser).toHaveClass(/is-maximized/);
  await frame.getByLabel('Keys').click();
  await page.keyboard.press('Escape');
  await expect(browser).not.toHaveClass(/is-maximized/);
});

test('a press on an edge that goes nowhere changes nothing', async ({ page }) => {
  await page.getByRole('button', { name: 'Use terminal', exact: true }).click();
  const terminal = page.locator('.voice-terminal-window');
  await page.waitForTimeout(900);
  const before = await box(terminal);
  await terminal.locator('.resize-e').click();
  await page.waitForTimeout(900);
  expect(await terminal.evaluate(el => el.dataset.sized)).toBeUndefined();
  await expect(page.locator('.voice-stage')).not.toHaveAttribute('data-orb', 'free');
  expect(await box(terminal)).toEqual(before);
});

test('a window that stands closer to the dock than the gap does not jump when its edge is taken', async ({ page }) => {
  // Short enough that the browser's own place ends a few pixels short of the dock's margin.
  await page.setViewportSize({ width: 1400, height: 700 });
  await page.getByRole('button', { name: 'Use browser', exact: true }).click();
  await page.getByRole('button', { name: 'Use terminal', exact: true }).click();
  const browser = page.locator('.voice-browser-window');
  await page.waitForTimeout(1000);
  const before = await box(browser), dock = await box(page.locator('.voice-presence'));
  expect(dock.y - (before.y + before.height)).toBeLessThan(16);
  // At its left end, clear of the tool cards that float up from the dock.
  const grip = await box(browser.locator('.resize-s'));
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.className, { x: grip.x + 20, y: grip.y + 4 })).toContain('resize-s');
  await page.mouse.move(grip.x + 20, grip.y + 4); await page.mouse.down();
  await page.mouse.move(grip.x + 20, grip.y + 5);
  expect((await box(browser)).height).toBeGreaterThanOrEqual(before.height - 0.5);
  await page.mouse.up();
});

test('closing one of two windows stands the orb beside the other from the first frame', async ({ page }) => {
  await page.getByRole('button', { name: 'Use browser', exact: true }).click();
  await page.getByRole('button', { name: 'Use terminal', exact: true }).click();
  const browser = page.locator('.voice-browser-window');
  await page.waitForTimeout(1000);
  // Sized by hand so there is no gap: the orb is in its dock.
  await drag(page, browser.locator('.resize-e'), 400);
  await expect.poll(() => page.locator('.voice-presence').evaluate(p => getComputedStyle(p).flexDirection)).toBe('row');
  // Every frame after the terminal closes: how the orb is laid out.
  const frames = await page.evaluate(async () => {
    const presence = document.querySelector('.voice-presence')!;
    const seen: string[] = [];
    (document.querySelector('[aria-label="Minimize terminal"]') as HTMLElement).click();
    for (let i = 0; i < 20; i++) {
      await new Promise(r => requestAnimationFrame(r));
      seen.push(getComputedStyle(presence).flexDirection);
    }
    return seen;
  });
  expect(frames.every(f => f === 'column')).toBe(true);
});

test('the canvas keeps the size it was given before voice mode', async ({ page }) => {
  await openCanvas(page);
  await page.getByRole('button', { name: 'End voice mode' }).click();
  await expect(page.locator('.voice-stage')).toHaveCount(0);
  const panel = page.locator('.canvas-panel');
  await page.waitForTimeout(900);
  await drag(page, panel.locator('.resize-w'), -120);
  const sized = await box(panel);
  await page.getByRole('button', { name: 'Turn on hands-free voice' }).click();
  await expect(page.locator('.voice-stage')).toHaveCount(1);
  await page.waitForTimeout(900);
  expect((await box(panel)).width).toBeCloseTo(sized.width, 0);
});

test('a drag measures the other windows once, not at every move of the pointer', async ({ page }) => {
  await page.getByRole('button', { name: 'Use browser', exact: true }).click();
  await page.getByRole('button', { name: 'Use terminal', exact: true }).click();
  const browser = page.locator('.voice-browser-window');
  await page.waitForTimeout(1000);
  const grip = await box(browser.locator('.resize-e'));
  await page.mouse.move(grip.x + 4, grip.y + 40); await page.mouse.down();
  // Twenty moves in one frame, as a fast mouse sends them: how often the terminal beside it is measured.
  const reads = await page.evaluate(({ x, y }) => {
    const handle = document.querySelector('.voice-browser-window .resize-e')!, other = document.querySelector('.voice-terminal-window')!;
    let reads = 0;
    const read = other.getBoundingClientRect;
    other.getBoundingClientRect = function () { reads++; return read.call(this); };
    for (let i = 1; i <= 20; i++) handle.dispatchEvent(new PointerEvent('pointermove', { clientX: x - i, clientY: y, bubbles: true }));
    other.getBoundingClientRect = read;
    return reads;
  }, { x: grip.x + 4, y: grip.y + 40 });
  await page.mouse.up();
  expect(reads).toBe(0);
});
