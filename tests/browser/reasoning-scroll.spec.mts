import { test, expect, type Page } from '@playwright/test';

const scroller = (page: Page) => page.locator('.chat-list').locator('..');
/** How far the conversation is from its end, in px. */
const left = (page: Page) => scroller(page).evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
const scrollTop = (page: Page) => scroller(page).evaluate((el) => el.scrollTop);
const think = (page: Page, text: string) => page.evaluate((t) => (window as any).think(t), text);
const frames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
/** Thinks more, and waits until it is drawn. */
const thinkDrawn = async (page: Page, text = line) => {
  await think(page, text);
  await frames(page);
};
const line = '\nStill reasoning about the bundle, one more line of it as it streams in.';
const reasoning = (page: Page) => page.locator('.chat-thinking-body').last();

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await page.goto('/tests/chat.html?phase=reasoning');
  await expect(page.getByText('And the last one?')).toBeVisible();
  await frames(page);
  expect(await left(page)).toBeLessThanOrEqual(1);
});

/** The reasoning being written, opened, grown past its own height, and the conversation at its end again. */
async function openLongReasoning(page: Page) {
  await page.locator('.chat-thinking-head').last().click();
  for (let i = 0; i < 30; i++) await thinkDrawn(page);
  await expect.poll(() => reasoning(page).evaluate((el) => el.scrollHeight > el.clientHeight + 100)).toBe(true);
  // Opened, it was held where it was pressed, and the end left below.
  await page.getByRole('button', { name: 'Latest output' }).click();
  await expect.poll(() => left(page)).toBeLessThanOrEqual(1);
  await thinkDrawn(page);
  expect(await left(page)).toBeLessThanOrEqual(1);
  // It shows its newest line.
  expect(await reasoning(page).evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThanOrEqual(1);
}

test('the reasoning being written, scrolled back inside, stays where it was taken', async ({ page }) => {
  await openLongReasoning(page);
  const box = (await reasoning(page).boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + box.height / 2);
  await page.mouse.wheel(0, -100);
  await expect.poll(() => reasoning(page).evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeGreaterThan(20);
  const top = await reasoning(page).evaluate((el) => el.scrollTop);
  // Every word put it back at its end.
  for (let i = 0; i < 4; i++) await thinkDrawn(page);
  expect(await reasoning(page).evaluate((el) => el.scrollTop)).toBeCloseTo(top, 0);
  // Down to its end again: it follows once more.
  await page.mouse.wheel(0, 4000);
  await expect.poll(() => reasoning(page).evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThanOrEqual(1);
  await thinkDrawn(page);
  expect(await reasoning(page).evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThanOrEqual(1);
});

test('the conversation scrolls back over the reasoning being written, and stays there', async ({ page }) => {
  await openLongReasoning(page);
  const box = (await reasoning(page).boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + box.height / 2);
  const before = await scrollTop(page);
  // Past the top of the reasoning, and on up the conversation — a word arriving with each turn of the wheel.
  for (let i = 0; i < 15; i++) {
    await page.mouse.wheel(0, -150);
    await thinkDrawn(page);
  }
  // Each word took the reasoning back to its end, so the wheel never got past it.
  await expect.poll(() => scrollTop(page)).toBeLessThan(before - 100);
  const top = await scrollTop(page);
  for (let i = 0; i < 4; i++) await thinkDrawn(page);
  expect(await scrollTop(page)).toBeCloseTo(top, 0);
  await expect(page.getByRole('button', { name: 'Latest output' })).toBeVisible();
});

test('a scroll up not heard yet when the next word arrives is not undone by it', async ({ page }) => {
  // A touch or the scrollbar moves the box before its scroll event is dispatched; a word in between went to the end over it.
  await page.evaluate(() => {
    const box = document.querySelector('.chat-list')!.parentElement!;
    (window as any).unheard = (e: Event) => e.target === box && e.stopImmediatePropagation();
    window.addEventListener('scroll', (window as any).unheard, true);
  });
  const before = await scrollTop(page);
  await scroller(page).evaluate((el) => (el.scrollTop -= 300));
  for (let i = 0; i < 4; i++) await thinkDrawn(page);
  expect(await scrollTop(page)).toBeCloseTo(before - 300, 0);
  await page.evaluate(() => window.removeEventListener('scroll', (window as any).unheard, true));
  for (let i = 0; i < 2; i++) await thinkDrawn(page);
  expect(await scrollTop(page)).toBeCloseTo(before - 300, 0);
});

test('a reasoning block opened in the middle of the conversation while the model thinks stays where it was', async ({ page }) => {
  const head = page.locator('.chat-thinking-head').nth(2);
  await head.scrollIntoViewIfNeeded();
  await frames(page);
  const before = (await head.boundingBox())!;
  await head.click();
  await expect(page.locator('.chat-thinking').nth(2).locator('.chat-thinking-body')).toBeVisible();
  for (let i = 0; i < 10; i++) await thinkDrawn(page);
  // Past the moment a press holds it: the words that came since have not moved it either.
  await page.waitForTimeout(1100);
  for (let i = 0; i < 4; i++) await thinkDrawn(page);
  expect(Math.abs((await head.boundingBox())!.y - before.y)).toBeLessThan(2);
});

test('what a message had attached, opened at the end, stays where it was pressed', async ({ page }) => {
  const chip = page.getByRole('button', { name: 'Routine' });
  await expect(chip).toBeVisible();
  const before = (await chip.boundingBox())!;
  await chip.click();
  await expect(page.getByText('Routine line 12: check the bundle.')).toBeVisible();
  await frames(page);
  // It went up by all it opened.
  expect(Math.abs((await chip.boundingBox())!.y - before.y)).toBeLessThan(2);
  for (let i = 0; i < 4; i++) await thinkDrawn(page);
  expect(Math.abs((await chip.boundingBox())!.y - before.y)).toBeLessThan(2);
});
