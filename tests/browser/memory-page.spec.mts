import { test, expect, type Page } from '@playwright/test';

const tree = {
  name: '/', path: '/', kind: 'directory', children: [
    { name: 'deployment', path: '/deployment', kind: 'directory', children: [
      { name: 'branches.md', path: '/deployment/branches.md', kind: 'concept', type: 'Deployment Process', title: 'Branch Deployment on Test Host', description: 'The test host deploys branches using deploy-branch.sh.' },
      { name: 'index.md', path: '/deployment/index.md', kind: 'reserved' },
    ] },
    { name: 'people', path: '/people', kind: 'directory', children: [
      { name: 'owner.md', path: '/people/owner.md', kind: 'concept', type: 'Person', title: 'The owner' },
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
  '/people/owner.md': { path: '/people/owner.md', frontmatter: { title: 'The owner', type: 'Person' }, body: 'Runs the test host.' },
  '/index.md': { path: '/index.md', frontmatter: {}, body: '# Knowledge Base\n\n* [deployment](deployment/) - 1 concept' },
  '/deployment/index.md': { path: '/deployment/index.md', frontmatter: {}, body: '# deployment\n\n* [Branch Deployment](branches.md)' },
};

/** The portal with Understory as the memory, or not, over canned answers. */
async function portal(page: Page, { enabled = true, broken = false, conformant = true } = {}) {
  const asked: string[] = [];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    let body: unknown = {};
    if (p === '/api/auth/status') body = { authed: true, authRequired: false };
    else if (p === '/api/sessions') body = { sessions: [], executor: 'host' };
    else if (p === '/api/projects') body = { root: '/w', home: '/h', projects: [] };
    else if (p === '/api/features') body = { subagent: {}, understory: { enabled, url: 'http://127.0.0.1:3800/mcp', managed: { available: true, container: 'running', config: { llm: null, dreamInterval: '' }, providers: [], pulling: { active: false } } } };
    else if (p === '/api/browser') body = { running: false, configured: false, routines: [] };
    else if (p.startsWith('/api/memory/')) {
      asked.push(`${p}${url.search}`);
      if (broken) return route.fulfill({ status: 502, json: { error: 'Could not reach Understory at http://127.0.0.1:3800: it did not answer in time.' } });
      if (p === '/api/memory/tree') body = tree;
      else if (p === '/api/memory/validate') body = conformant ? { conformant: true, conceptCount: 2, directoryCount: 2, issues: [] } : { conformant: false, conceptCount: 2, directoryCount: 2, issues: [{ path: '/people/owner.md', severity: 'warning', message: 'No description in its frontmatter' }] };
      else if (p === '/api/memory/log') body = [
        { date: '2026-09-27', action: 'Creation', summary: 'Added [The owner](/people/owner.md).' },
        { date: '2026-09-28', action: 'Update', summary: 'Linked [Branch Deployment on Test Host](/deployment/branches.md) to its owner.' },
      ];
      else if (p === '/api/memory/graph') body = {
        nodes: [
          { path: '/deployment/branches.md', title: 'Branch Deployment on Test Host', type: 'Deployment Process', links: 1 },
          { path: '/people/owner.md', title: 'The owner', type: 'Person', links: 1 },
          { path: '/loose.md', title: 'A loose note', links: 0 },
        ],
        edges: [{ source: '/deployment/branches.md', target: '/people/owner.md' }],
      };
      else if (p === '/api/memory/traces') body = [{ id: 't1', kind: 'mutation', input: 'Persist the following knowledge', startedAt: '2026-09-28T09:17:47Z', notation: 'browse layout → write branches.md → ✓', usage: { inputTokens: 9683, outputTokens: 735 } }];
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

const notes = (page: Page) => page.getByRole('navigation', { name: 'Notes' });

test('the sidebar has Memory only while Understory is the memory', async ({ page }) => {
  await portal(page, { enabled: false });
  await page.goto('/sessions');
  await expect(page.getByRole('button', { name: 'Sessions' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Memory' })).toHaveCount(0);
});

test("Memory in the sidebar opens the tree, with each note's type and Understory's own files set apart", async ({ page }) => {
  const { asked } = await portal(page);
  await page.goto('/sessions');
  await page.getByRole('button', { name: 'Memory' }).first().click();
  await expect(page).toHaveURL(/\/memory$/);
  await expect(notes(page).getByRole('button', { name: /Branch Deployment on Test Host/ })).toContainText('Deployment Process');
  await expect(notes(page).getByRole('button', { name: /deployment\// })).toHaveAttribute('aria-expanded', 'true');
  await expect(notes(page).getByRole('button', { name: 'log.md' }).locator('span.italic')).toBeVisible();
  await expect(page.getByRole('button', { name: 'conformant' })).toBeVisible();
  await expect(page.getByText('2 notes in 2 folders')).toBeVisible();
  // A folder shuts.
  await notes(page).getByRole('button', { name: /people\// }).click();
  await expect(notes(page).getByRole('button', { name: /The owner/ })).toHaveCount(0);
  // Nothing here writes.
  expect(asked.every((a) => /^\/api\/memory\/(tree|log|concept|search|graph|traces|validate)/.test(a))).toBe(true);
});

test('a note opens with its type, tags and time; its links open other notes, and Back returns', async ({ page }) => {
  await portal(page);
  await page.goto('/memory');
  await notes(page).getByRole('button', { name: /Branch Deployment on Test Host/ }).click();
  await expect(page).toHaveURL(/note=%2Fdeployment%2Fbranches\.md/);
  const note = page.getByRole('article', { name: 'Branch Deployment on Test Host' });
  await expect(note.getByText('#test-host')).toBeVisible();
  await expect(note.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(note.getByRole('link', { name: 'the docs' })).toHaveAttribute('target', '_blank');
  await note.getByRole('link', { name: 'the owner' }).click();
  await expect(page.getByRole('article', { name: 'The owner' })).toContainText('Runs the test host.');
  await page.goBack();
  await expect(page.getByRole('article', { name: 'Branch Deployment on Test Host' })).toBeVisible();
  // Understory's index, and a folder's link in it to that folder's index.
  await notes(page).getByRole('button', { name: 'index.md' }).last().click();
  await page.getByRole('article', { name: 'index.md' }).getByRole('link', { name: 'deployment' }).click();
  await expect(page).toHaveURL(/note=%2Fdeployment%2Findex\.md/);
});

test('the log lists the changes newest first, and its links open the notes', async ({ page }) => {
  await portal(page);
  await page.goto('/memory');
  await page.getByRole('button', { name: 'Log', exact: true }).click();
  await expect(page).toHaveURL(/view=log/);
  const log = page.getByRole('region', { name: 'Changes to the memory' });
  await expect(log.locator('li').first()).toContainText('2026-09-28');
  await expect(log.locator('li').first()).toContainText('Update');
  await log.getByRole('link', { name: 'The owner' }).click();
  await expect(page.getByRole('article', { name: 'The owner' })).toBeVisible();
});

test('the graph draws the notes and their links, says what the colours are, and a note opens from it', async ({ page }) => {
  await portal(page);
  await page.goto('/memory?view=graph');
  const graph = page.getByRole('img', { name: /3 notes, 1 links/ });
  await expect(graph).toBeVisible();
  await expect(graph.locator('line')).toHaveCount(1);
  const legend = page.getByRole('list', { name: 'What the colours are' });
  await expect(legend).toContainText('Deployment Process');
  await expect(legend).toContainText('orphan (unlinked)');
  await page.getByText('Query paths').click();
  await expect(page.getByText('9.7k→735 tok')).toBeVisible();
  const before = await graph.getAttribute('viewBox');
  await page.getByRole('button', { name: 'Zoom in' }).click();
  expect(await graph.getAttribute('viewBox')).not.toBe(before);
  await page.getByRole('button', { name: 'Show all of it' }).click();
  expect(await graph.getAttribute('viewBox')).toBe(before);
  await graph.getByRole('button', { name: 'The owner' }).click();
  await expect(page.getByRole('article', { name: 'The owner' })).toBeVisible();
});

test('the search lists what matches, and says when nothing does', async ({ page }) => {
  await portal(page);
  await page.goto('/memory');
  await page.getByLabel('Search the memory').fill('deploy');
  await expect(page.getByRole('list', { name: 'Found in the memory' }).getByRole('button', { name: /Branch Deployment on Test Host/ })).toBeVisible();
  await page.getByLabel('Search the memory').fill('nothing like it');
  await expect(page.getByText('Nothing in the memory matches “nothing like it”.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear the search' }).click();
  await expect(notes(page).getByRole('button', { name: /The owner/ })).toBeVisible();
});

test('a bundle with issues says how many, and lists them', async ({ page }) => {
  await portal(page, { conformant: false });
  await page.goto('/memory');
  await page.getByRole('button', { name: '1 issues' }).click();
  await expect(page.getByText('No description in its frontmatter')).toBeVisible();
  await page.getByRole('button', { name: '/people/owner.md' }).click();
  await expect(page.getByRole('article', { name: 'The owner' })).toBeVisible();
});

test('Understory not answering is said, with a way to try again', async ({ page }) => {
  await portal(page, { broken: true });
  await page.goto('/memory');
  await expect(page.getByText('The memory could not be read.')).toBeVisible();
  await expect(page.getByText(/did not answer in time/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('on a phone the notes and what is open take turns', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await portal(page);
  await page.goto('/memory');
  await notes(page).getByRole('button', { name: /The owner/ }).click();
  await expect(page.getByRole('article', { name: 'The owner' })).toBeVisible();
  await expect(notes(page)).toBeHidden();
  await page.getByRole('button', { name: 'Back to the notes' }).click();
  await expect(notes(page)).toBeVisible();
  await page.getByRole('button', { name: 'Graph', exact: true }).click();
  await expect(page.getByRole('img', { name: /3 notes/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
