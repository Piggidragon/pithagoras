import { test, expect } from '@playwright/test';

test("the model menu's providers link goes through the router, as any other link", async ({ page }) => {
  await page.goto('/tests/chat.html?phase=model');
  await page.getByTitle('Qwen3.6 35B', { exact: true }).click();
  await page.getByRole('button', { name: 'Add or change providers…' }).click();
  await expect(page).toHaveURL(/\/s\/preview\/settings\/models$/);
  // An entry the router made itself: it knows where it is in history, so back and forward keep their order.
  expect(await page.evaluate(() => typeof history.state?.idx)).toBe('number');
});
