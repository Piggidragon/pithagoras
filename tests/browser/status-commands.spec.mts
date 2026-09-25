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

test('an extension fills the chat box, as pi names it outside the host too, and two fills at once both land', async ({ page }) => {
  await page.goto('/tests/chat.html?phase=editor');
  await expect(page.getByRole('textbox').last()).toHaveValue('/deploy --prod');
});

test('opening another chat does not ask it for its commands because of the last chat\'s status', async ({ page }) => {
  await page.goto('/tests/chat.html?phase=switch');
  // The first chat's status names a command, so it is asked for its list.
  await expect.poll(() => page.evaluate(() => (window as any).commandsAsked)).toContain('first');
  await page.getByRole('button', { name: 'Open the second chat' }).click();
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => (window as any).commandsAsked)).not.toContain('second');
});
