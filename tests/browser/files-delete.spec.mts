import { test, expect, type Page } from '@playwright/test';

type Unsaved = { changed: number; unpushed: number; stashes: number; unknown?: true };

/**
 * The chat page with its Files panel, over a folder with one entry, "api".
 * `held` is what the server finds in it: DELETE answers 409 while it holds any,
 * unless ?discard=1 comes with it. Returns what DELETE was sent, as the query.
 */
async function files(page: Page, opts: { held?: Unsaved; asks?: boolean } = {}) {
  const deletes: string[] = [];
  let gone = false;
  await page.route('**/api/sessions/preview/files**', (route) =>
    route.fulfill({ json: { path: '', entries: gone ? [] : [{ name: 'api', type: 'dir', size: 0, mtime: 1 }], truncated: false } }),
  );
  await page.route('**/api/sessions/preview/file?**', (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'DELETE') return route.fulfill({ status: 404, json: {} });
    deletes.push(url.search);
    const held = opts.held && (opts.held.changed || opts.held.unpushed || opts.held.stashes || opts.held.unknown);
    if (held && url.searchParams.get('discard') !== '1') {
      return route.fulfill({ status: 409, json: { error: 'This folder holds work that exists nowhere else. Delete it only when that is meant.', code: 'unsaved-work', unsaved: opts.held } });
    }
    gone = true;
    return route.fulfill({ json: { ok: true } });
  });
  await page.addInitScript((asks) => {
    if (!asks) localStorage.setItem('confirmDeletes', 'off');
  }, opts.asks ?? true);
  await page.setViewportSize({ width: 1300, height: 800 });
  await page.goto('/tests/chat.html?phase=tools');
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete api' })).toBeAttached();
  return deletes;
}

const dialog = (page: Page) => page.getByRole('alertdialog');
const deleteApi = (page: Page) => page.getByRole('button', { name: 'Delete api' }).click();

test('a folder with nothing of its own to lose is deleted after the one question', async ({ page }) => {
  const deletes = await files(page);
  await deleteApi(page);
  await expect(dialog(page)).toContainText('Delete "api"?');
  await dialog(page).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect.poll(() => deletes).toEqual(['?path=api']);
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete api' })).toHaveCount(0);
});

test('git work that nothing else has is named after the 409, and goes only with ?discard=1', async ({ page }) => {
  const deletes = await files(page, { held: { changed: 0, unpushed: 5, stashes: 1 } });
  await deleteApi(page);
  await dialog(page).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(dialog(page)).toContainText('Delete "api" and its unsaved work?');
  await expect(dialog(page)).toContainText('This folder holds git work that exists nowhere else: 5 commits that no remote has, 1 stash.');
  await expect(dialog(page)).toContainText('Files git ignores, such as .env, are not looked at.');
  // Said in the dialog, not shown as an error in the panel.
  await expect(page.getByText('Delete it only when that is meant')).toHaveCount(0);
  await dialog(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(deletes).toEqual(['?path=api']);
  await expect(page.getByRole('button', { name: 'Delete api' })).toBeAttached();

  await deleteApi(page);
  await dialog(page).getByRole('button', { name: 'Delete', exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Delete anyway' }).click();
  await expect.poll(() => deletes).toEqual(['?path=api', '?path=api', '?path=api&discard=1']);
  await expect(page.getByRole('button', { name: 'Delete api' })).toHaveCount(0);
});

test('the question is asked even when Settings says not to ask before deleting', async ({ page }) => {
  const deletes = await files(page, { held: { changed: 2, unpushed: 0, stashes: 0 }, asks: false });
  await deleteApi(page);
  // No first question; the server's refusal is what is asked about.
  await expect(dialog(page)).toContainText('2 uncommitted changes');
  expect(deletes).toEqual(['?path=api']);
  await dialog(page).getByRole('button', { name: 'Delete anyway' }).click();
  await expect.poll(() => deletes).toEqual(['?path=api', '?path=api&discard=1']);
});

test('what could not be read is not said as a fact', async ({ page }) => {
  await files(page, { held: { changed: 0, unpushed: 0, stashes: 0, unknown: true }, asks: false });
  await deleteApi(page);
  await expect(dialog(page)).toContainText('Whether the folder holds git work that exists nowhere else could not be told.');
  await expect(dialog(page)).toContainText('Delete "api"?');
  await expect(dialog(page)).not.toContainText('unsaved work');
  await expect(dialog(page).getByRole('button', { name: 'Delete anyway' })).toBeVisible();
});
