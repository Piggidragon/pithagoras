import { test, expect } from '@playwright/test';

test('a status that moves many times a second does not ask for the background list each time', async ({ page }) => {
  await page.goto('/tests/chat.html?phase=nudge');
  // Forty changes over two seconds, then a moment for the last to be asked about.
  await page.waitForTimeout(3500);
  const asked = await page.evaluate(() => (window as any).backgroundAsked);
  expect(asked).toBeGreaterThanOrEqual(2);
  expect(asked).toBeLessThanOrEqual(5);
});
