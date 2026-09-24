import { test, expect } from '@playwright/test';

test('a status that names a command runs it when clicked, and one that does not stays text', async ({ page }) => {
  await page.goto('/tests/chat.html?phase=agents');
  const tray = page.getByLabel('Running beside the conversation');
  const update = tray.getByRole('button', { name: /bg-update/ });
  await expect(update).toBeVisible();
  await expect(update).toHaveAttribute('title', 'bg-update — click to run /bg-update');
  // A path is not a command: it stays plain text.
  await expect(tray.getByText('logs in /tmp/bg')).toBeVisible();
  await expect(tray.getByRole('button', { name: /tmp/ })).toHaveCount(0);
  await update.click();
  await expect.poll(() => page.evaluate(() => (window as any).sent)).toEqual(['/bg-update']);
});
