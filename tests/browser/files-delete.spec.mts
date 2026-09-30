import { test, expect, type Page } from '@playwright/test';

type Unsaved = { changed: number; unpushed: number; stashes: number; unknown?: true };

/**
 * The chat page with its Files panel, over a folder "api" and a file "notes.md".
 * `unsaved` is what asking first says the folder holds; `found` is what DELETE
 * finds without ?discard=1, which answers 409 while it holds any. Returns what
 * was asked and what DELETE was sent, as their queries.
 */
async function files(page: Page, opts: { unsaved?: Unsaved | null; found?: Unsaved; asks?: boolean } = {}) {
  const asked: string[] = [];
  const deletes: string[] = [];
  const gone = new Set<string>();
  await page.route('**/api/sessions/preview/files**', (route) =>
    route.fulfill({
      json: {
        path: '',
        entries: [{ name: 'api', type: 'dir', size: 0, mtime: 1 }, { name: 'notes.md', type: 'file', size: 3, mtime: 1 }].filter((e) => !gone.has(e.name)),
        truncated: false,
      },
    }),
  );
  await page.route('**/api/sessions/preview/unsaved?**', (route) => {
    asked.push(new URL(route.request().url()).search);
    return route.fulfill({ json: { unsaved: opts.unsaved ?? null } });
  });
  await page.route('**/api/sessions/preview/file?**', (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'DELETE') return route.fulfill({ status: 404, json: {} });
    deletes.push(url.search);
    const found = opts.found ?? opts.unsaved;
    const held = found && (found.changed || found.unpushed || found.stashes || found.unknown);
    if (held && url.searchParams.get('path') === 'api' && url.searchParams.get('discard') !== '1') {
      return route.fulfill({ status: 409, json: { error: 'This folder holds work that exists nowhere else. Delete it only when that is meant.', code: 'unsaved-work', unsaved: found } });
    }
    gone.add(url.searchParams.get('path')!);
    return route.fulfill({ json: { ok: true } });
  });
  await page.addInitScript((asks) => {
    if (!asks) localStorage.setItem('confirmDeletes', 'off');
  }, opts.asks ?? true);
  await page.setViewportSize({ width: 1300, height: 800 });
  await page.goto('/tests/chat.html?phase=tools');
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete api' })).toBeAttached();
  return { asked, deletes };
}

const dialog = (page: Page) => page.getByRole('alertdialog');
const deleteRow = (page: Page, name = 'api') => page.getByRole('button', { name: `Delete ${name}` }).click();

test('a folder with nothing of its own to lose is deleted after the one plain question', async ({ page }) => {
  const { asked, deletes } = await files(page, { unsaved: { changed: 0, unpushed: 0, stashes: 0 } });
  await deleteRow(page);
  await expect(dialog(page)).toContainText('Delete "api"?');
  await expect(dialog(page)).toContainText('Files git ignores, such as .env, are not looked at.');
  await dialog(page).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect.poll(() => deletes).toEqual(['?path=api']);
  expect(asked).toEqual(['?path=api']);
  await expect(page.getByRole('button', { name: 'Delete api' })).toHaveCount(0);
});

test('git work that nothing else has is named in the one question, and goes only with ?discard=1', async ({ page }) => {
  const { deletes } = await files(page, { unsaved: { changed: 0, unpushed: 5, stashes: 1 } });
  await deleteRow(page);
  await expect(dialog(page)).toContainText('Delete "api" and its unsaved work?');
  await expect(dialog(page)).toContainText('This folder holds git work that exists nowhere else: 5 commits that no remote has, 1 stash.');
  await dialog(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(deletes).toEqual([]);

  await deleteRow(page);
  await dialog(page).getByRole('button', { name: 'Delete anyway' }).click();
  await expect.poll(() => deletes).toEqual(['?path=api&discard=1']);
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete api' })).toHaveCount(0);
});

test('the question is asked even when Settings says not to ask before deleting', async ({ page }) => {
  const { deletes } = await files(page, { unsaved: { changed: 2, unpushed: 0, stashes: 0 }, asks: false });
  await deleteRow(page);
  await expect(dialog(page)).toContainText('2 uncommitted changes');
  expect(deletes).toEqual([]);
  await dialog(page).getByRole('button', { name: 'Delete anyway' }).click();
  await expect.poll(() => deletes).toEqual(['?path=api&discard=1']);
});

test('what could not be read is not said as a fact, and not in the plain words', async ({ page }) => {
  await files(page, { unsaved: { changed: 0, unpushed: 0, stashes: 0, unknown: true } });
  await deleteRow(page);
  await expect(dialog(page)).toContainText('Delete "api" anyway?');
  await expect(dialog(page)).toContainText('Whether the folder holds git work that exists nowhere else could not be told.');
  await expect(dialog(page)).not.toContainText('ignores');
  await expect(dialog(page).getByRole('button', { name: 'Delete anyway' })).toBeVisible();
});

test('work that turns up after the question is asked about, not shown as an error', async ({ page }) => {
  // Nothing when asked, and "ask before deleting" off: no question, until the server finds work.
  const { deletes } = await files(page, { unsaved: null, found: { changed: 0, unpushed: 4, stashes: 0 }, asks: false });
  await deleteRow(page);
  await expect(dialog(page)).toContainText('4 commits that no remote has');
  await expect(page.getByText('Delete it only when that is meant')).toHaveCount(0);
  await dialog(page).getByRole('button', { name: 'Delete anyway' }).click();
  await expect.poll(() => deletes).toEqual(['?path=api', '?path=api&discard=1']);
});

test('a file is not asked about: it holds no repository', async ({ page }) => {
  const { asked, deletes } = await files(page);
  await deleteRow(page, 'notes.md');
  await expect(dialog(page)).toContainText('This removes the file.');
  await dialog(page).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect.poll(() => deletes).toEqual(['?path=notes.md']);
  expect(asked).toEqual([]);
});
