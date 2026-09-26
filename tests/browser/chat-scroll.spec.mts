import { test, expect, type Page } from '@playwright/test';

const scroller = (page: Page) => page.locator('.chat-list').locator('..');
/** How far the conversation is from its end, in px. */
const left = (page: Page) => scroller(page).evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
const say = (page: Page, text: string) => page.evaluate((t) => (window as any).say(t), text);
const frames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const paragraph = ' More of the answer, long enough to take a line or two of the conversation as it is written.\n\n';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await page.goto('/tests/chat.html?phase=stream');
  await expect(page.getByText('The last step')).toBeVisible();
  expect(await left(page)).toBeLessThanOrEqual(1);
});

test('a little scroll up while the agent writes stays where it was taken', async ({ page }) => {
  await page.mouse.move(450, 300);
  // Less than the 48 px that still counted as the end: the next word took it back down.
  await page.mouse.wheel(0, -30);
  await expect.poll(() => left(page)).toBeGreaterThan(20);
  const top = await scroller(page).evaluate((el) => el.scrollTop);
  for (let i = 0; i < 4; i++) { await say(page, paragraph); await frames(page); }
  expect(await scroller(page).evaluate((el) => el.scrollTop)).toBeCloseTo(top, 0);
  await expect(page.getByRole('button', { name: 'Latest output' })).toBeVisible();
  // Down to the end again: it follows once more.
  await page.mouse.wheel(0, 4000);
  await expect.poll(() => left(page)).toBeLessThanOrEqual(1);
  await say(page, paragraph);
  await frames(page);
  expect(await left(page)).toBeLessThanOrEqual(1);
});

test('its own jump to the end, heard after more arrived, does not stop it following', async ({ page }) => {
  // More arrives, the box goes to the end for it, and before that scroll is
  // heard more still has arrived: further from the end than the 48 px that
  // counted as there, and following stopped on its own.
  await page.evaluate(() => {
    const box = document.querySelector('.chat-list')!.parentElement!;
    const grow = (px: number) => {
      const tall = document.createElement('div');
      tall.style.height = `${px}px`;
      document.querySelector('.chat-list')!.lastElementChild!.appendChild(tall);
    };
    grow(100);
    box.scrollTop = box.scrollHeight;
    grow(300);
  });
  await frames(page);
  await say(page, paragraph);
  await frames(page);
  expect(await left(page)).toBeLessThanOrEqual(1);
  await expect(page.getByRole('button', { name: 'Latest output' })).toBeHidden();
});

test('what grows without a new word — a block that settles, a picture that loads — keeps the end in view', async ({ page }) => {
  await page.evaluate(() => {
    const tall = document.createElement('div');
    tall.style.height = '240px';
    document.querySelector('.chat-list')!.lastElementChild!.appendChild(tall);
  });
  // It stayed a screen short of the end until the next word came.
  await frames(page);
  expect(await left(page)).toBeLessThanOrEqual(1);
});

test('a shorter box, as when the keyboard opens, still ends at the last word', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 380 });
  await frames(page);
  expect(await left(page)).toBeLessThanOrEqual(1);
});
