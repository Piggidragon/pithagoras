import { test, expect, type Page } from '@playwright/test';

const tree = {
  name: '/', path: '/', kind: 'directory', children: [
    { name: 'deployment', path: '/deployment', kind: 'directory', children: [
      { name: 'branches.md', path: '/deployment/branches.md', kind: 'concept', type: 'Deployment Process', title: 'Branch Deployment on Test Host', description: 'The test host deploys branches using deploy-branch.sh.' },
      { name: 'index.md', path: '/deployment/index.md', kind: 'reserved' },
    ] },
    { name: 'people', path: '/people', kind: 'directory', children: [
      { name: 'owner.md', path: '/people/owner.md', kind: 'concept', title: 'The owner' },
    ] },
    { name: 'index.md', path: '/index.md', kind: 'reserved' },
    { name: 'log.md', path: '/log.md', kind: 'reserved' },
  ],
};
const concepts: Record<string, unknown> = {
  '/deployment/branches.md': {
    path: '/deployment/branches.md',
    frontmatter: { type: 'Deployment Process', title: 'Branch Deployment on Test Host', description: 'The test host deploys branches using deploy-branch.sh.', tags: ['deployment', 'test-host'], timestamp: '2026-09-28T09:17:59.631Z' },
    body: '## Overview\n\nBranches go out with `deploy-branch.sh`. Asked for by [the owner](../people/owner.md); see also [the docs](https://example.com/docs).',
  },
  '/people/owner.md': { path: '/people/owner.md', frontmatter: { title: 'The owner' }, body: 'Runs the test host.' },
};

/** The Agent page with Understory on or off, over canned answers. */
async function portal(page: Page, { memory = 'understory' as 'understory' | 'file', broken = false } = {}) {
  const asked: string[] = [];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    let body: unknown = {};
    if (p === '/api/auth/status') body = { authed: true, authRequired: false };
    else if (p === '/api/sessions') body = { sessions: [], executor: 'host' };
    else if (p === '/api/projects') body = { root: '/w', home: '/h', projects: [] };
    else if (p === '/api/agent/setup') body = { home: '/h', initialised: true, memory, files: [{ name: 'SOUL.md', exists: true, content: '# Soul' }, { name: 'MEMORY.md', exists: true, content: '# Memory' }] };
    else if (p === '/api/agent/sessions') body = { sessions: [], agentHome: '/h' };
    else if (p === '/api/features') body = { subagent: {}, understory: { enabled: true, url: 'http://understory:3800/mcp' } };
    else if (p.startsWith('/api/memory/')) {
      asked.push(`${p}${url.search}`);
      if (broken) return route.fulfill({ status: 502, json: { error: 'Could not reach Understory at http://understory:3800: it did not answer in time.' } });
      if (p === '/api/memory/tree') body = tree;
      else if (p === '/api/memory/log') body = [
        { date: '2026-09-27', action: 'Creation', summary: 'Added [The owner](/people/owner.md).' },
        { date: '2026-09-28', action: 'Creation', summary: 'Added [Branch Deployment on Test Host](/deployment/branches.md).' },
      ];
      else if (p === '/api/memory/search') body = url.searchParams.get('q') === 'deploy' ? [{ path: '/deployment/branches.md', title: 'Branch Deployment on Test Host', description: 'The test host deploys branches.' }] : [];
      else if (p === '/api/memory/concept') {
        const c = concepts[url.searchParams.get('path') ?? ''];
        if (!c) return route.fulfill({ status: 404, json: { error: 'Concept not found' } });
        body = c;
      }
    }
    await route.fulfill({ json: body });
  });
  await page.addInitScript(() => {
    localStorage.setItem('pithagoras.setup', 'done');
    (window as any).EventSource = class { onmessage: any; onopen: any; onerror: any; addEventListener() {} close() {} };
  });
  return { asked };
}

test('without Understory the Agent page has no memory tab', async ({ page }) => {
  await portal(page, { memory: 'file' });
  await page.goto('/agent?tab=memory');
  await expect(page.getByText('Nothing has reached the agent yet.')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Memory' })).toHaveCount(0);
});

test("the memory tab lists Understory's notes, newest changes first, and opens one with its tags", async ({ page }) => {
  const { asked } = await portal(page);
  await page.goto('/agent');
  await page.getByRole('tab', { name: 'Memory' }).click();
  await expect(page).toHaveURL(/\/agent\?tab=memory$/);
  const nav = page.getByRole('navigation', { name: 'Memory' });
  await expect(nav.getByRole('button', { name: 'Branch Deployment on Test Host' })).toBeVisible();
  // Understory's own index and log are not notes.
  await expect(nav.getByText('index.md')).toHaveCount(0);
  await expect(nav.getByRole('button', { name: /deployment/ })).toHaveAttribute('aria-expanded', 'true');
  const changes = page.getByRole('region', { name: 'Recent changes to the memory' });
  await expect(changes.locator('li').first()).toContainText('2026-09-28');

  await nav.getByRole('button', { name: 'Branch Deployment on Test Host' }).click();
  await expect(page).toHaveURL(/note=%2Fdeployment%2Fbranches\.md/);
  const note = page.getByRole('article', { name: 'Branch Deployment on Test Host' });
  await expect(note.getByText('#test-host')).toBeVisible();
  await expect(note.getByText('Deployment Process')).toBeVisible();
  await expect(note.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(note.getByRole('link', { name: 'the docs' })).toHaveAttribute('target', '_blank');
  // A link to another note opens it here, relative to where this one is.
  await note.getByRole('link', { name: 'the owner' }).click();
  await expect(page.getByRole('article', { name: 'The owner' })).toContainText('Runs the test host.');
  await expect(page).toHaveURL(/note=%2Fpeople%2Fowner\.md/);
  // Back goes to the note before.
  await page.goBack();
  await expect(page.getByRole('article', { name: 'Branch Deployment on Test Host' })).toBeVisible();
  // Nothing here writes.
  expect(asked.every((a) => /^\/api\/memory\/(tree|log|concept|search)/.test(a))).toBe(true);
});

test('a link in the changes opens the note it names', async ({ page }) => {
  await portal(page);
  await page.goto('/agent?tab=memory');
  await page.getByRole('region', { name: 'Recent changes to the memory' }).getByRole('link', { name: 'The owner' }).click();
  await expect(page.getByRole('article', { name: 'The owner' })).toBeVisible();
});

test('the search lists what matches, and says when nothing does', async ({ page }) => {
  await portal(page);
  await page.goto('/agent?tab=memory');
  await page.getByLabel('Search the memory').fill('deploy');
  const found = page.getByRole('list', { name: 'Found in the memory' });
  await expect(found.getByRole('button', { name: /Branch Deployment on Test Host/ })).toBeVisible();
  await page.getByLabel('Search the memory').fill('nothing like it');
  await expect(page.getByText('Nothing in the memory matches “nothing like it”.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear the search' }).click();
  await expect(page.getByRole('navigation', { name: 'Memory' }).getByRole('button', { name: 'The owner' })).toBeVisible();
});

test('Understory not answering is said, with a way to try again', async ({ page }) => {
  await portal(page, { broken: true });
  await page.goto('/agent?tab=memory');
  await expect(page.getByText('The memory could not be read.')).toBeVisible();
  await expect(page.getByText(/did not answer in time/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Open in Understory/ })).toHaveAttribute('href', 'http://understory:3800');
});

test('on a phone the list and the note take turns', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await portal(page);
  await page.goto('/agent?tab=memory');
  const nav = page.getByRole('navigation', { name: 'Memory' });
  await nav.getByRole('button', { name: 'The owner' }).click();
  await expect(page.getByRole('article', { name: 'The owner' })).toBeVisible();
  await expect(nav).toBeHidden();
  await page.getByRole('button', { name: 'Back to the memory' }).click();
  await expect(nav).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
