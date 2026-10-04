import { test, expect, type Page } from '@playwright/test';

/** Settings → MCP over canned answers, with every save that was sent. */
async function portal(page: Page) {
  const saves: string[] = [];
  const mcp = {
    path: '/a/mcp.json', exists: true, adapterInstalled: true, adapterSpec: 'npm:pi-mcp-adapter', settings: {}, raw: '{}', parseError: null,
    servers: [
      { name: 'github', entry: { url: 'https://mcp.example.test', auth: 'oauth', headers: { 'X-Org': 'a' } }, transport: 'http', disabled: false },
      { name: 'notes', entry: { command: 'notes-mcp' }, transport: 'stdio', disabled: false },
    ],
  };
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/api/auth/status') return route.fulfill({ json: { authed: true, authRequired: false } });
    if (p === '/api/sessions') return route.fulfill({ json: { sessions: [], executor: 'host' } });
    if (p === '/api/mcp') return route.fulfill({ json: mcp });
    if (p.startsWith('/api/mcp/servers/') && route.request().method() === 'PUT') {
      saves.push(`${p.slice('/api/mcp/servers/'.length)} from ${route.request().postDataJSON().from}`);
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: {} });
  });
  await page.addInitScript(() => {
    (window as any).EventSource = class { onmessage: any; onopen: any; onerror: any; addEventListener() {} close() {} };
    localStorage.setItem('pithagoras.setup', 'done');
  });
  await page.goto('/settings/mcp');
  return { saves, dialog: page.getByRole('dialog', { name: 'Settings' }) };
}

test('a new server cannot take the name of one that is there: it is said, and nothing is saved', async ({ page }) => {
  const { saves, dialog } = await portal(page);
  await dialog.getByRole('button', { name: 'Add server' }).click();
  const name = dialog.getByPlaceholder('filesystem', { exact: true });
  await name.fill('github');
  await dialog.getByRole('textbox', { name: 'Command' }).fill('other');
  await expect(dialog.getByText('A server called github already exists')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('alert')).toContainText('A server called github already exists');
  expect(saves).toEqual([]);
  // Another name is saved.
  await name.fill('github-two');
  await expect(dialog.getByText('A server called github-two already exists')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => saves).toEqual(['github-two from undefined']);
});

test('a server cannot be renamed onto another, and keeps its own name for an edit', async ({ page }) => {
  const { saves, dialog } = await portal(page);
  await dialog.getByRole('button', { name: /^notes/ }).first().click();
  const name = dialog.getByPlaceholder('filesystem', { exact: true });
  await name.fill('github');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('alert')).toContainText('A server called github already exists');
  expect(saves).toEqual([]);
  // Its own name is no clash.
  await name.fill('notes');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => saves).toEqual(['notes from notes']);
});
