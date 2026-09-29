import { test, expect, type Page } from '@playwright/test';

/** The portal with no server: enough canned answers for Settings and the sidebar to draw. */
async function portal(page: Page) {
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (p === '/api/auth/status') body = { authed: true, authRequired: false };
    else if (p === '/api/sessions') body = { sessions: [], executor: 'host' };
    else if (p === '/api/settings') body = {
      settings: { provider: 'llama-swap', model: 'Ornith', thinkingLevel: 'medium' }, stored: {}, defaults: { provider: 'llama-swap', model: 'Ornith', thinkingLevel: 'medium' },
      piSettingsPath: '/a/settings.json', compaction: { keepRecentTokens: 20000 }, compactionDefaults: { keepRecentTokens: 20000 }, contextDefault: null, executor: 'host', workspaceRoot: '/w',
    };
    else if (p === '/api/models') body = { models: [{ provider: 'llama-swap', id: 'Ornith', name: 'Ornith 1.5', contextWindow: 65536, reasoning: true }], providers: { 'llama-swap': 'llama-swap' } };
    else if (p === '/api/routines/report-targets') body = { targets: [], default: null };
    else if (p === '/api/extensions') body = { settingsPath: '/a/settings.json', extensions: [] };
    else if (p === '/api/features/flags') body = { subagent: false, understory: false };
    await route.fulfill({ json: body });
  });
}

const pickLanguage = async (page: Page, name: RegExp) => {
  await page.getByRole('combobox', { name: /^(Language|Sprache)$/ }).click();
  await page.getByRole('option', { name }).click();
};

test('the portal can be switched to German and back, and keeps the choice', async ({ page }) => {
  await portal(page);
  await page.goto('/settings/browser');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Appearance', { exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  await pickLanguage(page, /^Deutsch/);
  // Drawn again at once, the page it was changed on included.
  await expect(dialog.getByText('Darstellung', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Einstellungen' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(page.getByRole('button', { name: 'Sitzungen' }).first()).toBeVisible();

  // Remembered in this browser.
  await page.reload();
  await expect(page.getByRole('dialog').getByText('Darstellung', { exact: true })).toBeVisible();

  await pickLanguage(page, /^English/);
  await expect(page.getByRole('dialog').getByText('Appearance', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('dialog').getByText('Appearance', { exact: true })).toBeVisible();
});

test.describe('in a browser set to German', () => {
  test.use({ locale: 'de-DE' });

  test('the portal speaks German until another language is chosen', async ({ page }) => {
    await portal(page);
    await page.goto('/settings/browser');
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Darstellung', { exact: true })).toBeVisible();
    // The choice that follows the browser names what it comes to.
    await expect(page.getByRole('combobox', { name: 'Sprache' })).toContainText('Wie der Browser');

    await pickLanguage(page, /^English/);
    await expect(dialog.getByText('Appearance', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('dialog').getByText('Appearance', { exact: true })).toBeVisible();

    // Back to the browser's.
    await pickLanguage(page, /^Match the browser/);
    await expect(page.getByRole('dialog').getByText('Darstellung', { exact: true })).toBeVisible();
  });

  test('a setting is found by its German name and by its English one', async ({ page }) => {
    await portal(page);
    await page.goto('/settings/general');
    const search = page.getByRole('combobox', { name: 'Einstellungen durchsuchen' });
    await search.fill('Design');
    await expect(page.getByRole('option').first()).toContainText('Design');
    await search.fill('theme');
    await expect(page.getByRole('option').first()).toContainText('Design');
    await page.getByRole('option').first().click();
    await expect(page.getByRole('dialog').getByRole('radiogroup', { name: 'Design' })).toBeVisible();
  });
});
