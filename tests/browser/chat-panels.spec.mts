import { test, expect, type Page } from '@playwright/test';

const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!;
const panels = (page: Page) => page.getByRole('complementary', { name: 'Panels' });
const place = async (page: Page, where: string) => {
  await panels(page).getByRole('button', { name: 'Where the panels go' }).click();
  await page.getByRole('menuitemradio', { name: where }).click();
  await expect(page.getByRole('menu', { name: 'Where the panels go' })).toBeHidden();
  // Coming in from the side it sits on.
  expect(await panels(page).evaluate((e) => getComputedStyle(e).animationName)).toBe(SLIDE[where]);
  await settled(page);
};
const SLIDE: Record<string, string> = { Right: 'aside-in', Left: 'aside-in-left', Top: 'aside-down', Bottom: 'aside-up', Floating: 'aside-up' };
/** Done coming in: measured on the way, they are where they are going plus the slide. */
const settled = (page: Page) => panels(page).evaluate((e) => Promise.all(e.getAnimations({ subtree: true }).filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished)));

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 800 });
  await page.goto('/tests/chat.html?phase=tools');
  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await expect(panels(page)).toBeVisible();
});

test('the panels dock at any side of the conversation, side by side at the top and the bottom', async ({ page }) => {
  const conversation = async () => (await page.locator('.chat-list').locator('..').boundingBox())!;
  const composer = () => box(page, '.prompt-shell');
  const halves = async () => [await box(page, '.chat-aside-panel:nth-of-type(1)'), (await page.locator('.chat-aside-panel').nth(1).boundingBox())!];

  // At the right, as they always were: one above the other.
  let a = (await panels(page).boundingBox())!;
  expect(a.x).toBeGreaterThan((await composer()).x + (await composer()).width);
  let [one, two] = await halves();
  expect(two.y).toBeGreaterThan(one.y + one.height - 1);

  await place(page, 'Left');
  a = (await panels(page).boundingBox())!;
  expect(a.x + a.width).toBeLessThanOrEqual((await composer()).x);

  await place(page, 'Top');
  a = (await panels(page).boundingBox())!;
  expect(a.y + a.height).toBeLessThanOrEqual((await conversation()).y + 1);
  expect(a.width).toBeGreaterThan(1200);
  [one, two] = await halves();
  // Side by side: the width is what there is here, not the height.
  expect(two.x).toBeGreaterThan(one.x + one.width - 1);
  expect(two.y).toBeCloseTo(one.y, 0);

  await place(page, 'Bottom');
  a = (await panels(page).boundingBox())!;
  expect(a.y).toBeGreaterThanOrEqual((await composer()).y + (await composer()).height);
  [one, two] = await halves();
  expect(two.x).toBeGreaterThan(one.x + one.width - 1);

  // Kept: opened again, they are where they were put.
  await page.reload();
  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  a = (await panels(page).boundingBox())!;
  expect(a.y).toBeGreaterThanOrEqual((await composer()).y + (await composer()).height);
  await expect(panels(page).getByRole('button', { name: 'Where the panels go' })).toBeVisible();
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
  for (const [where, dx, dy, grows] of [['Left', 100, 0, 'width'], ['Right', -100, 0, 'width'], ['Top', 0, 80, 'height'], ['Bottom', 0, -80, 'height']] as const) {
    await place(page, where);
    const before = (await panels(page).boundingBox())![grows];
    await drag(dx, dy);
    // Towards the conversation is larger, wherever the panels are.
    expect((await panels(page).boundingBox())![grows]).toBeCloseTo(before + Math.abs(dx || dy), -1);
  }
});

test('floating, the panels are a window moved by its header and sized by its corner, and kept inside the chat', async ({ page }) => {
  await place(page, 'Floating');
  const window = panels(page);
  const area = (await page.locator('[data-dock]').boundingBox())!;
  const at = (await window.boundingBox())!;
  // Over the conversation, not beside it: the composer keeps its width.
  expect(at.x + at.width).toBeLessThanOrEqual(area.x + area.width);
  expect((await box(page, '.prompt-shell')).x + (await box(page, '.prompt-shell')).width).toBeGreaterThan(at.x);

  // Moved by its header, where there is no button.
  const header = page.locator('.chat-aside-panel').first().locator('> div').first();
  const h = (await header.boundingBox())!;
  await page.mouse.move(h.x + 60, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + 60 - 300, h.y + h.height / 2 + 50, { steps: 8 });
  await page.mouse.up();
  let now = (await window.boundingBox())!;
  expect(now.x).toBeCloseTo(at.x - 300, 0);
  expect(now.y).toBeCloseTo(at.y + 50, 0);

  // Not out of the chat, however far.
  const h2 = (await header.boundingBox())!;
  await page.mouse.move(h2.x + 60, h2.y + h2.height / 2);
  await page.mouse.down();
  await page.mouse.move(h2.x - 3000, h2.y + 3000, { steps: 8 });
  await page.mouse.up();
  now = (await window.boundingBox())!;
  expect(now.x).toBeGreaterThanOrEqual(area.x - 0.5);
  expect(now.y + now.height).toBeLessThanOrEqual(area.y + area.height + 0.5);

  // Sized by its corner, down to what is still of use and no smaller.
  const grip = (await page.locator('.chat-aside-grip').boundingBox())!;
  await page.mouse.move(grip.x + 8, grip.y + 8);
  await page.mouse.down();
  await page.mouse.move(grip.x - 2000, grip.y - 2000, { steps: 8 });
  await page.mouse.up();
  now = (await window.boundingBox())!;
  expect(now.width).toBeCloseTo(320, 0);
  expect(now.height).toBeCloseTo(200, 0);

  // A button in the header is a button, not a place to move the window from.
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
});

test('on a phone the panels cover the chat wherever they were put', async ({ page }) => {
  await place(page, 'Floating');
  await page.setViewportSize({ width: 390, height: 780 });
  await expect.poll(async () => (await panels(page).boundingBox())!.x).toBe(0);
  expect((await panels(page).boundingBox())!.width).toBe(390);
  await expect(panels(page).getByRole('button', { name: 'Where the panels go' })).toBeHidden();
});
