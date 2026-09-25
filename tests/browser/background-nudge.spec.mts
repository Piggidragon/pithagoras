import { test, expect } from '@playwright/test';

test('a status that moves many times a second is shown from its events, without asking for the background list again', async ({ page }) => {
  await page.goto('/tests/chat.html?phase=nudge');
  // Forty changes over two seconds. The portal's list says nothing of them: what shows came with the events.
  await expect(page.getByLabel('Running beside the conversation').getByText('working 40')).toBeVisible({ timeout: 5000 });
  const asked = await page.evaluate(() => (window as any).backgroundAsked);
  // Its first answer, and the poll every two seconds while the chat is working: none for the statuses.
  expect(asked).toBeLessThanOrEqual(3);
});
