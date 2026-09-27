import { test, expect, type Page } from '@playwright/test';

const calls = (page: Page) => page.evaluate(() => (window as any).gitCalls.filter((c: any) => c.method === 'POST').map((c: any) => ({ url: c.url.replace('/api/sessions/s/git', ''), body: c.body })));
const row = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(name.replace(/[.]/g, '\\.')) }).first();

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 760 });
});

test('what changed is listed staged and not; a file is staged from its row, and the staged ones are committed with the message', async ({ page }) => {
  await page.goto('/tests/git.html');
  await expect(page.getByRole('button', { name: 'Unstage login.ts' })).toBeAttached();
  await expect(page.getByText('login flow.md')).toBeVisible();

  await page.getByRole('button', { name: 'Stage session.ts' }).click();
  await expect(page.getByRole('button', { name: 'Unstage session.ts' })).toBeAttached();

  await page.getByRole('textbox', { name: 'Commit message' }).fill('Check the session too');
  await expect(page.getByRole('button', { name: 'Commit 2 staged' })).toBeEnabled();
  await page.getByRole('textbox', { name: 'Commit message' }).press('Control+Enter');
  await expect(page.getByRole('textbox', { name: 'Commit message' })).toHaveValue('');
  expect(await calls(page)).toEqual([
    { url: '/stage', body: { paths: ['src/auth/session.ts'] } },
    { url: '/commit', body: { message: 'Check the session too', amend: false } },
  ]);
});

test('with nothing staged the button commits everything, staging it first', async ({ page }) => {
  await page.goto('/tests/git.html');
  await page.getByRole('button', { name: 'Unstage everything' }).click();
  await expect(page.getByRole('button', { name: 'Commit all 4' })).toBeDisabled();
  await page.getByRole('textbox', { name: 'Commit message' }).fill('All of it');
  await page.getByRole('button', { name: 'Commit all 4' }).click();
  await expect(page.getByText('Nothing has changed since the last commit.')).toBeVisible();
  expect((await calls(page)).map((c) => c.url)).toEqual(['/unstage', '/stage', '/commit']);
  expect((await calls(page))[1].body).toEqual({ all: true });
});

test("a file's diff is shown with the lines numbered where they were and where they are, and can be staged from there", async ({ page }) => {
  await page.goto('/tests/git.html');
  await row(page, 'session.ts').click();
  const table = page.getByRole('table', { name: 'Changes to src/auth/session.ts' });
  await expect(table).toBeVisible();
  await expect(table.locator('[data-kind="del"]')).toHaveCount(1);
  await expect(table.locator('[data-kind="add"]')).toHaveCount(4);
  await expect(table.locator('[data-kind="del"]')).toContainText('11');
  await expect(table.locator('[data-kind="add"]').first()).toContainText('if (!stored) throw');

  await page.getByRole('button', { name: 'Stage', exact: true }).click();
  // Back on the list, with it staged.
  await expect(page.getByRole('button', { name: 'Unstage session.ts' })).toBeAttached();
});

test('discarding asks first, and nothing is thrown away when the answer is no', async ({ page }) => {
  await page.goto('/tests/git.html');
  await page.getByRole('button', { name: 'Discard the changes to README.md' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Discard the changes to README.md?');
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect(await calls(page)).toEqual([]);
  await page.getByRole('button', { name: 'Discard the changes to README.md' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByText('README.md')).toHaveCount(0);
  expect(await calls(page)).toEqual([{ url: '/discard', body: { paths: ['README.md'] } }]);
});

test('what the agent writes shows up without a refresh, and a file opens in Files from its row', async ({ page }) => {
  await page.goto('/tests/git.html');
  await expect(page.getByText('login.ts')).toBeVisible();
  await page.evaluate(() => (window as any).agentWrote('src/auth/logout.ts'));
  await expect(page.getByText('logout.ts')).toBeVisible();
  await page.getByRole('button', { name: 'Open README.md in Files' }).click();
  await expect(page.getByTestId('opened')).toHaveText('README.md');
});

test('a push the remote refuses says why', async ({ page }) => {
  await page.goto('/tests/git.html?push=fail');
  await page.getByRole('button', { name: /^Push/ }).click();
  await expect(page.getByRole('alert')).toContainText('Updates were rejected because the remote contains work that you do not have locally.');
});

test('history: a commit opens with its message and files, and a file of it with its diff', async ({ page }) => {
  await page.goto('/tests/git.html?tab=history');
  await page.getByText('Add the login form').click();
  await expect(page.getByText('With a body that explains why.')).toBeVisible();
  await row(page, 'new.ts').click();
  await expect(page.getByRole('table', { name: 'Changes to src/auth/new.ts' })).toBeVisible();
  expect((await page.evaluate(() => (window as any).gitCalls.map((c: any) => c.url))).some((u: string) => u.includes('of=commit') && u.includes('sha=b2c3d4e5'))).toBe(true);
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByText('Compare this branch with its base')).toBeVisible();
});

test('branches: one is made from a name, and one on the remote is checked out as a local branch following it', async ({ page }) => {
  await page.goto('/tests/git.html?tab=branches');
  await page.getByRole('textbox', { name: 'Name of the new branch' }).fill('fix/typo');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('button', { name: /fix\/typo/ }).first()).toBeVisible();
  await page.getByRole('button', { name: /On the remote/ }).click();
  await page.getByRole('button', { name: /origin\/feature\/signup/ }).click();
  await expect(page.locator('[data-git-tab]').getByText('feature/signup').first()).toBeVisible();
  expect(await calls(page)).toEqual([
    { url: '/branches', body: { name: 'fix/typo' } },
    { url: '/switch', body: { name: 'origin/feature/signup', remote: true } },
  ]);
});

test('pull requests: listed through gh, one opened with its checks and conversation, merged only once asked', async ({ page }) => {
  await page.goto('/tests/git.html?tab=pulls');
  await page.getByRole('button', { name: /Dark mode for the settings/ }).click();
  await expect(page.getByText('Looks good — one question about the hash.')).toBeVisible();
  await expect(page.getByText('lint')).toBeVisible();
  // A draft is not merged.
  await expect(page.getByRole('button', { name: 'Merge' })).toBeDisabled();
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: /Login with a password/ }).last().click();
  await page.getByRole('combobox', { name: 'How to merge' }).selectOption('rebase');
  await page.getByRole('button', { name: 'Merge' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Rebased on main');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Merge' }).click();
  await expect.poll(() => calls(page)).toEqual([{ url: '/pulls/41/merge', body: { method: 'rebase', deleteBranch: true } }]);
});

test('a branch without a pull request offers to open one, filled in from its commits', async ({ page }) => {
  await page.goto('/tests/git.html?tab=branches');
  await page.getByRole('textbox', { name: 'Name of the new branch' }).fill('feature/export');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByRole('tab', { name: 'Pull requests' }).click();
  await page.getByRole('button', { name: 'Open a pull request for feature/export' }).click();
  await expect(page.getByRole('textbox', { name: 'Description of the pull request' })).toHaveValue('- Add the login form\n- Check the password before the session is made');
  await page.getByRole('textbox', { name: 'Title of the pull request' }).fill('Export to CSV');
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  // Straight to the one just opened.
  await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();
  const opened = (await calls(page)).find((c) => c.url === '/pulls');
  expect(opened?.body).toEqual({ title: 'Export to CSV', body: '- Add the login form\n- Check the password before the session is made', base: 'main', draft: false });
});

test('without gh, pull requests say how to get them — and the branch can still be compared with its base', async ({ page }) => {
  await page.goto('/tests/git.html?tab=pulls&gh=off');
  await expect(page.getByText('Install the GitHub CLI (gh)')).toBeVisible();
  await page.getByRole('button', { name: /Compare feature\/login with its base/ }).click();
  await expect(page.getByText('Check the password before the session is made')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Compare with' })).toHaveValue('origin/main');
});

test('a folder in no repository is offered git init', async ({ page }) => {
  await page.goto('/tests/git.html?repo=none');
  await expect(page.getByText("This chat's folder is not in a git repository.")).toBeVisible();
  await page.getByRole('button', { name: 'Make it one (git init)' }).click();
  expect(await calls(page)).toEqual([{ url: '/init', body: {} }]);
});

test('amending with nothing staged changes only the last commit: the unstaged work is not swept into it', async ({ page }) => {
  await page.goto('/tests/git.html');
  await page.getByRole('button', { name: 'Unstage everything' }).click();
  await page.getByRole('checkbox', { name: 'Amend' }).check();
  await page.getByRole('textbox', { name: 'Commit message' }).fill('Better words');
  await page.getByRole('button', { name: 'Amend', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Amend' })).not.toBeChecked();
  expect((await calls(page)).map((c) => c.url)).toEqual(['/unstage', '/commit']);
  expect((await calls(page))[1].body).toEqual({ message: 'Better words', amend: true });
});

test('a renamed file with more changes is staged by its new name, and unstaged with its old one', async ({ page }) => {
  await page.goto('/tests/git.html?rename=1');
  await page.getByRole('button', { name: 'Stage token.ts', exact: true }).click();
  await expect.poll(() => calls(page)).toEqual([{ url: '/stage', body: { paths: ['src/auth/token.ts'] } }]);
  await page.getByRole('button', { name: 'Unstage token.ts', exact: true }).click();
  await expect.poll(async () => (await calls(page))[1]).toEqual({ url: '/unstage', body: { paths: ['src/auth/token.ts', 'src/auth/jwt.ts'] } });
});

test("a file in conflict is shown a column per side: ours, theirs, and git's markers", async ({ page }) => {
  await page.goto('/tests/git.html?conflict=1');
  await expect(page.getByText('Merging —')).toBeVisible();
  await row(page, 'a.txt').click();
  const table = page.getByRole('table', { name: 'Changes to a.txt' });
  const ours = table.locator('[role=row]', { hasText: 'TWO main' });
  await expect(ours).toHaveAttribute('data-kind', 'add');
  // Ours: line 2 before, line 3 now — not a line of context that reads "+TWO main".
  await expect(ours).toHaveText(/^2\s*3\s*\+TWO main$/);
  await expect(table.locator('[role=row]', { hasText: 'TWO side' })).toHaveText(/^\s*5\s*\+\s+TWO side$/);
  await expect(table.locator('[data-kind=add]')).toHaveCount(6);
});

test('what changed is shown at once, however long GitHub takes to answer', async ({ page }) => {
  await page.goto('/tests/git.html?ghslow=1&tab=pulls');
  await expect(page.getByText('Asking GitHub…')).toBeVisible();
  await page.getByRole('tab', { name: 'Changes' }).click();
  await expect(page.getByText('session.ts')).toBeVisible({ timeout: 1500 });
  await page.getByRole('tab', { name: 'Pull requests' }).click();
  await expect(page.getByText('Dark mode for the settings')).toBeVisible({ timeout: 8000 });
});
