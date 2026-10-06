import { test, expect } from './portal-mock';

/** A chat's devices: the chip beside the browser's globe, and the card of a call made on a device. Over `?phase=devices` of the chat fixture. */

test('a chat is granted a paired device from the chip, in a folder there, and gives it back', async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 800 });
  await page.goto('/tests/chat.html?phase=devices');
  const chip = page.getByRole('button', { name: 'Devices', exact: true });
  await expect(chip).toHaveAttribute('aria-expanded', 'false');
  await chip.click();
  const list = page.getByRole('dialog', { name: 'Devices for this chat' });
  // One that is not connected cannot be granted, and says why.
  const desk = list.getByRole('listitem', { name: 'desk' });
  await expect(desk.getByText('desk is not connected')).toBeVisible();
  await expect(desk.getByRole('switch', { name: 'Let this chat use desk' })).toBeDisabled();

  const laptop = list.getByRole('listitem', { name: 'laptop' });
  await laptop.getByRole('switch', { name: 'Let this chat use laptop' }).click();
  await expect(laptop.getByRole('switch', { name: 'Let this chat use laptop' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('granted-devices')).toHaveText('1');
  // A path of its own, or one the device offers (a list under the field).
  const folder = laptop.getByRole('combobox', { name: 'Folder on laptop' });
  await expect(folder).toHaveValue('/home/alice');
  await folder.fill('/home/alice/src');
  await folder.press('Enter');
  await expect(list.getByRole('status')).toHaveText('The chat takes this up once its current run is over.');
  await expect(folder).toHaveValue('/home/alice/src');

  await laptop.getByRole('switch', { name: 'Let this chat use laptop' }).click();
  await expect(laptop.getByRole('combobox', { name: 'Folder on laptop' })).toHaveCount(0);
  await expect(page.getByTestId('granted-devices')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).sentDevices)).toEqual([
    { method: 'PUT', id: 'd1', body: {} },
    { method: 'PUT', id: 'd1', body: { cwd: '/home/alice/src' } },
    { method: 'DELETE', id: 'd1', body: null },
  ]);
  await page.keyboard.press('Escape');
  await expect(list).toHaveCount(0);
  await expect(chip).toBeFocused();
});

test('a device the chat has, in a chat whose tools another extension owns, says why it will not work', async ({ page }) => {
  await page.goto('/tests/chat.html?phase=devices-blocked');
  await page.getByRole('button', { name: 'Devices', exact: true }).click();
  const tower = page.getByRole('dialog', { name: 'Devices for this chat' }).getByRole('listitem', { name: 'tower' });
  await expect(tower.getByRole('switch', { name: 'Let this chat use tower' })).toHaveAttribute('aria-checked', 'true');
  await expect(tower.getByText('Another extension owns bash in this chat, so they cannot take a device')).toBeVisible();
});

test('a call made on a device names it on its card', async ({ page }) => {
  await page.goto('/tests/chat.html?phase=devices');
  const card = page.locator('.chat-tool').filter({ hasText: 'cargo test' });
  const badge = card.locator('.chat-tool-badge.is-device');
  await expect(badge).toHaveText('laptop');
  await expect(badge).toHaveAttribute('title', 'On the device laptop');
  // A call on the server has none.
  await expect(page.locator('.chat-tool').filter({ hasText: 'npm run build' }).locator('.is-device')).toHaveCount(0);
  // Nor has another tool's parameter that happens to be called device.
  await expect(page.locator('.chat-tool').filter({ hasText: 'lights_set' })).toHaveCount(1);
  await expect(page.locator('.chat-tool').filter({ hasText: 'lights_set' }).locator('.is-device')).toHaveCount(0);
});

test('without the Devices add-on there is no chip', async ({ page }) => {
  await page.goto('/tests/chat.html?phase=tools');
  await expect(page.getByRole('button', { name: 'Terminal', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Devices', exact: true })).toHaveCount(0);
});

test('the list fits a phone, opened from a chip near the left of the header', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/tests/chat.html?phase=devices');
  await page.getByRole('button', { name: 'Devices', exact: true }).click();
  const box = (await page.getByRole('dialog', { name: 'Devices for this chat' }).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(16);
  expect(box.x + box.width).toBeLessThanOrEqual(375 - 16);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
