import { test, expect } from '@playwright/test';

test("the model menu's providers link goes through the router, as any other link", async ({ page }) => {
  await page.goto('/tests/chat.html?phase=model');
  await page.getByTitle('Qwen3.6 35B', { exact: true }).click();
  await page.getByRole('button', { name: 'Add or change providers…' }).click();
  await expect(page).toHaveURL(/\/s\/preview\/settings\/models$/);
  // An entry the router made itself: it knows where it is in history, so back and forward keep their order.
  expect(await page.evaluate(() => typeof history.state?.idx)).toBe('number');
});

test("with the subagent tool on, the model menu says what this chat's subagents run on, and a choice there is kept", async ({ page }) => {
  const saved: unknown[] = [];
  await page.route('**/api/features/flags', (route) => route.fulfill({ json: { subagent: { enabled: true }, understory: { enabled: false } } }));
  await page.route('**/api/sessions/preview/subagent-model', async (route) => {
    if (route.request().method() === 'PUT') {
      const { model } = route.request().postDataJSON();
      saved.push(model);
      return route.fulfill({ json: { model, default: 'auto' } });
    }
    await route.fulfill({ json: { model: null, default: 'auto' } });
  });
  await page.goto('/tests/chat.html?phase=model');
  await page.getByTitle('Qwen3.6 35B', { exact: true }).click();
  const picker = page.getByRole('combobox', { name: 'Subagents in this chat run on' });
  await expect(picker).toContainText("Default — this chat's model");
  await picker.click();
  await page.getByRole('option', { name: /This chat's model/ }).click();
  // The menu stays open across the choice made in it.
  await expect(picker).toContainText("This chat's model");
  expect(saved).toEqual(['auto']);
});

test('without the subagent tool, the model menu has nothing about subagents', async ({ page }) => {
  await page.route('**/api/features/flags', (route) => route.fulfill({ json: { subagent: { enabled: false }, understory: { enabled: false } } }));
  await page.goto('/tests/chat.html?phase=model');
  await page.getByTitle('Qwen3.6 35B', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add or change providers…' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Subagents in this chat run on' })).toHaveCount(0);
});

test("the subagents' row is asked for with the chat, so the model menu opens with it already there", async ({ page }) => {
  let asked = 0;
  await page.route('**/api/features/flags', (route) => route.fulfill({ json: { subagent: { enabled: true }, understory: { enabled: false } } }));
  await page.route('**/api/sessions/preview/subagent-model', async (route) => {
    asked++;
    await new Promise((r) => setTimeout(r, 300));
    await route.fulfill({ json: { model: 'llama-swap/Qwen3.8-27b', default: 'auto' } });
  });
  await page.goto('/tests/chat.html?phase=model');
  await expect.poll(() => asked).toBe(1);
  await page.waitForTimeout(400);
  await page.getByTitle('Qwen3.6 35B', { exact: true }).click();
  // There in the first frame: nothing arrives after the menu to push it about.
  await expect(page.getByRole('combobox', { name: 'Subagents in this chat run on' })).toContainText('llama-swap/Qwen3.8-27b', { timeout: 150 });
});
