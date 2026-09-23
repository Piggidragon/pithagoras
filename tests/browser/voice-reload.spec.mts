import { test, expect } from '@playwright/test';

// As an ordinary browser does it: no audio before the page has been touched.
// Headless Chromium lets it start without, which would skip the part tested here.
test.use({ launchOptions: { ignoreDefaultArgs: ['--autoplay-policy=no-user-gesture-required'], args: ['--autoplay-policy=document-user-activation-required'] } });

test.beforeEach(async ({ page }) => {
  await page.route('**/api/browser', route => route.fulfill({ json: { running: false, sessions: [], install: { container: 'stopped' } } }));
  await page.route('**/api/sessions/test/commands', route => route.fulfill({ json: { commands: [] } }));
  await page.route('**/api/sessions/test/config', route => route.fulfill({ status: 503, json: {} }));
  await page.route('**/api/voice', route => route.fulfill({ json: { enabled: true } }));
});

// First: once the site has played audio, Chromium lets it start without a click for the rest of the run.
test('without any click on the page yet, it waits for one before audio', async ({ page }) => {
  // As a browser that does not carry the click across the reload finds it.
  await page.addInitScript(() => sessionStorage.setItem('voiceActive', 'test'));
  await page.goto('/tests/voice.html');
  const status = page.getByRole('status');
  await expect(status).toContainText('Click or press a key to continue voice mode', { timeout: 25000 });
  await page.getByTestId('workspace').screenshot({ path: '/tmp/pithagoras-voice-reload.png' });
  await page.keyboard.press('Shift');
  await expect(status).toContainText('Listening', { timeout: 25000 });
});

test('a reload keeps voice mode on', async ({ page }) => {
  await page.goto('/tests/voice.html');
  await page.getByRole('button', { name: 'Turn on hands-free voice' }).click();
  await expect(page.getByRole('status')).toContainText('Listening', { timeout: 25000 });
  await page.reload();
  // Chromium carries the earlier click across a reload of the same site, so audio may start at once.
  const status = page.getByRole('status');
  await expect(page.getByRole('button', { name: 'End voice mode' })).toBeVisible({ timeout: 25000 });
  await expect(status).toContainText(/Listening|continue voice mode/, { timeout: 25000 });
  if (/continue voice mode/.test(await status.textContent() ?? '')) await page.mouse.click(200, 200);
  await expect(status).toContainText('Listening', { timeout: 25000 });
  // Ended on purpose, a reload does not bring it back.
  await page.getByRole('button', { name: 'End voice mode' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Turn on hands-free voice' })).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page.getByRole('button', { name: 'End voice mode' })).toHaveCount(0);
});
