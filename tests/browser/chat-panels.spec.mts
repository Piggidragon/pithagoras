import { test, expect, type Page } from '@playwright/test';

const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!;
const panels = (page: Page) => page.getByRole('complementary', { name: 'Panels' });
const body = async (page: Page) => (await page.locator('[data-dock]').boundingBox())!;
/** Where in the chat to let the panels go for each place. */
const spots: Record<string, (b: { x: number; y: number; width: number; height: number }) => [number, number]> = {
  Right: (b) => [b.x + b.width - 20, b.y + b.height / 2],
  Left: (b) => [b.x + 20, b.y + b.height / 2],
  Bottom: (b) => [b.x + b.width / 2, b.y + b.height - 20],
  Floating: (b) => [b.x + b.width / 2, b.y + 90],
  // Where the top was: floating there, not docked.
  Top: (b) => [b.x + b.width / 2, b.y + 12],
};
/** The panels' header, where they are carried by: its grip. */
const grip = async (page: Page) => (await page.locator('.chat-aside-head').first().locator('span[title]').boundingBox())!;
/** Carries the panels by their header to `where`, in steps as a hand would; `during` looks while they are held there. */
const carry = async (page: Page, where: string, during?: () => Promise<void>) => {
  const g = await grip(page);
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  const [x, y] = spots[where](await body(page));
  await page.mouse.move(x, y, { steps: 10 });
  await during?.();
  await page.mouse.up();
  await expect(page.locator('.dock-zones')).toBeHidden();
};
const place = async (page: Page, where: string) => {
  await carry(page, where);
  // Coming in from the side it sits on.
  if (where !== 'Floating' && where !== 'Top') expect(await panels(page).evaluate((e) => getComputedStyle(e).animationName)).toBe(SLIDE[where]);
  await settled(page);
};
const SLIDE: Record<string, string> = { Right: 'aside-in', Left: 'aside-in-left', Bottom: 'aside-up', Floating: 'aside-up' };
/** Done coming in: measured on the way, they are where they are going plus the slide. */
const settled = (page: Page) => panels(page).evaluate((e) => Promise.all(e.getAnimations({ subtree: true }).filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished)));

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 800 });
  await page.goto('/tests/chat.html?phase=tools');
  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await expect(panels(page)).toBeVisible();
  await settled(page);
});

test('the panels are carried by their header to the right, left or bottom of the conversation, side by side at the bottom', async ({ page }) => {
  const composer = () => box(page, '.prompt-shell');
  const halves = async () => [await box(page, '.chat-aside-panel:nth-of-type(1)'), (await page.locator('.chat-aside-panel').nth(1).boundingBox())!];

  // At the right, as they always were: one above the other.
  let a = (await panels(page).boundingBox())!;
  expect(a.x).toBeGreaterThan((await composer()).x + (await composer()).width);
  let [one, two] = await halves();
  expect(two.y).toBeGreaterThan(one.y + one.height - 1);
  // No button for it: carried, not chosen from a menu.
  await expect(panels(page).getByRole('button', { name: 'Where the panels go' })).toHaveCount(0);

  // Held over the left edge: that edge lit, and where they would go shown.
  await carry(page, 'Left', async () => {
    await expect(page.locator('.dock-edge.is-active')).toHaveClass(/is-left/);
    const preview = (await page.locator('.dock-preview').boundingBox())!, b = await body(page);
    expect(preview.x).toBeCloseTo(b.x, 0);
    expect(Math.abs(preview.height - b.height)).toBeLessThan(1);
  });
  await settled(page);
  a = (await panels(page).boundingBox())!;
  expect(a.x + a.width).toBeLessThanOrEqual((await composer()).x);

  await place(page, 'Bottom');
  a = (await panels(page).boundingBox())!;
  expect(a.y).toBeGreaterThanOrEqual((await composer()).y + (await composer()).height);
  expect(a.width).toBeGreaterThan(1200);
  [one, two] = await halves();
  // Side by side: the width is what there is here, not the height.
  expect(two.x).toBeGreaterThan(one.x + one.width - 1);
  expect(two.y).toBeCloseTo(one.y, 0);

  // Kept: opened again, they are where they were put.
  await page.reload();
  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  await settled(page);
  a = (await panels(page).boundingBox())!;
  expect(a.y).toBeGreaterThanOrEqual((await composer()).y + (await composer()).height);

  // Not at the top, between the chat's title and the conversation: carried there, they float.
  await place(page, 'Top');
  await expect(page.locator('[data-dock]')).toHaveAttribute('data-dock', 'float');
  // Nor where an earlier version put them.
  await page.evaluate(() => localStorage.setItem('panelDock', 'top'));
  await page.reload();
  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  await expect(page.locator('[data-dock]')).toHaveAttribute('data-dock', 'right');
});

test('a press on the header that goes nowhere, or on a button in it, carries nothing', async ({ page }) => {
  const before = (await panels(page).boundingBox())!;
  const g = await grip(page);
  await page.mouse.move(g.x + 4, g.y + 4);
  await page.mouse.down();
  await page.mouse.move(g.x + 6, g.y + 5);
  await expect(page.locator('.dock-zones')).toBeHidden();
  await page.mouse.up();
  await page.getByRole('tab', { name: 'Background' }).click();
  expect(await panels(page).boundingBox()).toEqual(before);
  await expect(page.locator('[data-dock]')).toHaveAttribute('data-dock', 'right');
});

test('each edge between the conversation and the panels sizes them the way it is dragged', async ({ page }) => {
  const edge = page.locator('[title="Drag to resize"]').first();
  const drag = async (dx: number, dy: number) => {
    const e = (await edge.boundingBox())!;
    await page.mouse.move(e.x + e.width / 2, e.y + e.height / 2);
    await page.mouse.down();
    await page.mouse.move(e.x + e.width / 2 + dx, e.y + e.height / 2 + dy, { steps: 6 });
    await page.mouse.up();
  };
  for (const [where, dx, dy, grows] of [['Left', 100, 0, 'width'], ['Right', -100, 0, 'width'], ['Bottom', 0, -80, 'height']] as const) {
    await place(page, where);
    const before = (await panels(page).boundingBox())![grows];
    await drag(dx, dy);
    // Towards the conversation is larger, wherever the panels are.
    expect((await panels(page).boundingBox())![grows]).toBeCloseTo(before + Math.abs(dx || dy), -1);
  }
});

test('floating, the panels are a window carried by its header, sized by its corner, kept inside the chat, and docked again at an edge', async ({ page }) => {
  // Let go in the middle: a window, held by its header where it was let go.
  await place(page, 'Floating');
  const window = panels(page);
  const area = await body(page);
  const [x, y] = spots.Floating(area);
  const at = (await window.boundingBox())!;
  expect(at.width).toBeLessThan(area.width / 2);
  const g = await grip(page);
  expect(Math.abs(g.x + g.width / 2 - x)).toBeLessThan(40);
  expect(Math.abs(g.y + g.height / 2 - y)).toBeLessThan(20);
  // Over the conversation, not beside it: the composer keeps its width.
  expect((await box(page, '.prompt-shell')).x + (await box(page, '.prompt-shell')).width).toBeGreaterThan(at.x);

  // Carried again, it goes along with the pointer.
  const h = await grip(page);
  await page.mouse.move(h.x + 4, h.y + 4);
  await page.mouse.down();
  await page.mouse.move(h.x + 4 - 200, h.y + 4 + 50, { steps: 8 });
  expect((await window.boundingBox())!.x).toBeCloseTo(at.x - 200, 0);
  await page.mouse.up();
  let now = (await window.boundingBox())!;
  expect(now.x).toBeCloseTo(at.x - 200, 0);
  expect(now.y).toBeCloseTo(at.y + 50, 0);

  // Sized by its corner, down to what is still of use and no smaller.
  const corner = (await page.locator('.chat-aside-grip').boundingBox())!;
  await page.mouse.move(corner.x + 8, corner.y + 8);
  await page.mouse.down();
  await page.mouse.move(corner.x - 2000, corner.y - 2000, { steps: 8 });
  await page.mouse.up();
  now = (await window.boundingBox())!;
  expect(now.width).toBeCloseTo(320, 0);
  expect(now.height).toBeCloseTo(200, 0);
  expect(now.x).toBeGreaterThanOrEqual(area.x - 0.5);

  // A button in the header is a button, not a place to carry the window from.
  await page.getByRole('button', { name: 'Close the files' }).click();
  await expect(page.locator('.chat-aside-panel')).toHaveCount(1);
  expect((await window.boundingBox())!.x).toBeCloseTo(now.x, 0);

  // Where it was put and how large, kept.
  await page.reload();
  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  // Rising into place, not coming in from the right as the docked panels do.
  expect(await panels(page).evaluate((e) => getComputedStyle(e).animationName)).toBe('aside-up');
  await settled(page);
  const again = (await panels(page).boundingBox())!;
  expect(again.x).toBeCloseTo(now.x, 0);
  expect(again.width).toBeCloseTo(now.width, 0);

  // Carried to an edge, docked there again.
  await place(page, 'Right');
  await expect(page.locator('[data-dock]')).toHaveAttribute('data-dock', 'right');
  expect(Math.abs((await panels(page).boundingBox())!.height - area.height)).toBeLessThan(1);
});

test('on a phone the panels cover the chat wherever they were put', async ({ page }) => {
  await place(page, 'Floating');
  await page.setViewportSize({ width: 390, height: 780 });
  await expect.poll(async () => (await panels(page).boundingBox())!.x).toBe(0);
  expect((await panels(page).boundingBox())!.width).toBe(390);
  // Nothing to carry them by there.
  await expect(page.locator('.chat-aside-head span[title]').first()).toBeHidden();
});

test('panels leave the conversation and its composer room when the chat gets smaller', async ({ page }) => {
  await place(page, 'Bottom');
  // Made as tall as they may be.
  const edge = (await page.locator('[title="Drag to resize"]').first().boundingBox())!;
  await page.mouse.move(edge.x + edge.width / 2, edge.y + 1);
  await page.mouse.down();
  await page.mouse.move(edge.x + edge.width / 2, 0, { steps: 6 });
  await page.mouse.up();
  // Shorter, as the keyboard makes it on a tablet: the composer was squeezed to nothing under them.
  await page.setViewportSize({ width: 1300, height: 480 });
  await expect.poll(async () => (await box(page, '.prompt-shell')).y + (await box(page, '.prompt-shell')).height).toBeLessThanOrEqual((await panels(page).boundingBox())!.y + 1);
  // And a few lines of the conversation above it.
  expect((await page.locator('.chat-list').locator('..').boundingBox())!.height).toBeGreaterThan(40);

  // Narrower, docked at a side: the conversation keeps its width.
  await page.setViewportSize({ width: 1300, height: 800 });
  await place(page, 'Left');
  await page.setViewportSize({ width: 800, height: 800 });
  await expect.poll(async () => (await page.locator('.chat-list').locator('..').locator('..').boundingBox())!.width).toBeGreaterThanOrEqual(315);
});

test('a carry the browser takes over drops nothing, and a touch on the header is the carry\'s, not a pan', async ({ page }) => {
  expect(await page.locator('.chat-aside-head').first().evaluate((e) => getComputedStyle(e).touchAction)).toBe('none');
  const g = await grip(page);
  await page.mouse.move(g.x + 6, g.y + 6);
  await page.mouse.down();
  const [x, y] = spots.Floating(await body(page));
  await page.mouse.move(x, y, { steps: 8 });
  await expect(page.locator('.dock-zones')).toBeVisible();
  // A pan or a system gesture: the browser cancels the pointer.
  await page.locator('.chat-aside-head').first().evaluate((e) => e.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true })));
  await page.mouse.up();
  await expect(page.locator('.dock-zones')).toBeHidden();
  // Where it was: it jumped into a floating window nobody let go.
  await expect(page.locator('[data-dock]')).toHaveAttribute('data-dock', 'right');
});

test('a floating window moved or sized is drawn along without the chat, and kept once', async ({ page }) => {
  await place(page, 'Floating');
  const writes = () => page.evaluate(() => (window as any).floatWrites as number);
  await page.evaluate(() => {
    (window as any).floatWrites = 0;
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) { if (key === 'panelFloat') (window as any).floatWrites++; return set.call(this, key, value); };
  });
  const g = await grip(page);
  await page.mouse.move(g.x + 6, g.y + 6);
  await page.mouse.down();
  await page.mouse.move(g.x - 200, g.y + 60, { steps: 10 });
  // Along with the pointer already, before it is let go.
  expect((await grip(page)).x).toBeLessThan(g.x - 150);
  // It was written at every move.
  expect(await writes()).toBe(0);
  await page.mouse.up();
  expect(await writes()).toBe(1);
  const corner = (await page.locator('.chat-aside-grip').boundingBox())!;
  await page.mouse.move(corner.x + 8, corner.y + 8);
  await page.mouse.down();
  await page.mouse.move(corner.x + 60, corner.y + 40, { steps: 10 });
  expect(await writes()).toBe(1);
  await page.mouse.up();
  expect(await writes()).toBe(2);
});
