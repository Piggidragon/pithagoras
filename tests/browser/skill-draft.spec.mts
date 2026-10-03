import { test, expect, type Page } from '@playwright/test';

/** Settings → Skills with one skill the user can edit, over canned answers. */
async function portal(page: Page) {
  const skill = { name: 'notes', description: 'Take notes', path: '/agent/skills/notes/SKILL.md', scope: 'user', editable: true, manualOnly: false, broken: false, enabled: true, source: null, content: '---\nname: notes\n---\nTake notes.' };
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (p === '/api/auth/status') return route.fulfill({ json: { authed: true, authRequired: false } });
    if (p === '/api/sessions' && method === 'GET') return route.fulfill({ json: { sessions: [], executor: 'host' } });
    if (p === '/api/skills') return route.fulfill({ json: { root: '/agent/skills', skills: [skill], diagnostics: [] } });
    return route.fulfill({ json: {} });
  });
  await page.addInitScript(() => {
    (window as any).EventSource = class { onmessage: any; onopen: any; onerror: any; addEventListener() {} close() {} };
    localStorage.setItem('pithagoras.setup', 'done');
  });
}

test('Escape in a skill that was rewritten asks before Settings closes; an unchanged skill closes at once', async ({ page }) => {
  await portal(page);
  await page.goto('/settings/skills');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('button', { name: /notes/ }).click();
  const editor = dialog.getByRole('textbox');
  await expect(editor).toHaveValue(/Take notes/);
  // Opened, not changed: nothing to lose.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await page.goto('/settings/skills');
  await dialog.getByRole('button', { name: /notes/ }).click();
  await editor.fill('Half a rewrite');
  await page.keyboard.press('Escape');
  const ask = page.getByRole('alertdialog', { name: 'Discard your changes?' });
  await expect(ask).toBeVisible();
  // One Escape for one question: the one that asks does not also answer it.
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeVisible();
  await expect(editor).toHaveValue('Half a rewrite');
  await page.keyboard.press('Escape');
  await ask.getByRole('button', { name: 'Discard' }).click();
  await expect(dialog).toBeHidden();
});
