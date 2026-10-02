import { test, expect, type Locator, type Page, type Route } from '@playwright/test';

/**
 * The Images page (web/src/components/ImagesPage.tsx) over a portal that is made up: the pictures
 * of its gallery, and the jobs that make more, which the test lets finish when it likes.
 */

interface Pic {
  id: string;
  origin: 'page' | 'chat';
  chat: { id: string; title: string } | null;
  kind: 'generated' | 'edited' | 'uploaded';
  prompt: string;
  params: Record<string, unknown>;
  from: string | null;
  createdAt: number;
  bytes: number;
  fileName: string;
}
interface Job {
  id: string;
  kind: 'generate' | 'edit';
  state: 'running' | 'done' | 'failed';
  prompt: string;
  size?: string;
  from?: string;
  startedAt: number;
  finishedAt?: number;
  pictureId?: string;
  error?: string;
}

const hex = (n: number) => n.toString(16).padStart(12, '0');
const NOW = Date.parse('2026-10-02T12:00:00Z');

let next = 1;
/** A picture of the gallery; `age` is how many minutes ago it was made. */
const pic = (over: Partial<Pic> & { age?: number } = {}): Pic => {
  const { age = 0, ...rest } = over;
  const n = next++;
  return {
    id: hex(n),
    origin: 'page',
    chat: null,
    kind: 'generated',
    prompt: `Picture ${n}`,
    params: {},
    from: null,
    createdAt: Date.now() - age * 60_000,
    bytes: 120_000,
    fileName: `image-${n}.png`,
    ...rest,
  };
};

const svg = (id: string, w = 800, h = 600) => {
  const hue = (parseInt(id.slice(-4), 16) * 47) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="hsl(${hue} 55% 45%)"/><circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 4}" fill="white"/></svg>`;
};

/** An ImagesFeature as the portal tells of it. */
const feature = (over: Record<string, unknown> = {}) => ({
  enabled: true, baseUrl: 'https://images.example.com/v1', model: 'image-model', size: '1024x1024', keySet: true,
  editEnabled: true, editBaseUrl: '', editModel: '', editMultiple: false, editKeySet: false, editReady: true, ...over,
});

async function portal(page: Page, { pictures = [] as Pic[], images = feature(), flagOn = true, jobs = [] as Job[], failList = false } = {}) {
  const pics = [...pictures];
  const state = { jobs: [...jobs], generated: [] as any[], edited: [] as any[], deleted: [] as string[][], stopped: [] as string[], uploads: [] as { name: string | null; type: string | undefined; size: number }[], listed: [] as string[], files: [] as string[], limit: 4 };
  const sorted = () => [...pics].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
  const job = (over: Partial<Job>): Job => ({ id: `j${state.jobs.length + 1}`.padEnd(12, '0'), kind: 'generate', state: 'running', prompt: '', startedAt: Date.now(), ...over });

  await page.route('**/api/**', async (route: Route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const method = route.request().method();
    let body: unknown = {};
    if (p === '/api/auth/status') body = { authed: true, authRequired: false };
    else if (p === '/api/sessions') body = { sessions: [], executor: 'host' };
    else if (p === '/api/projects') body = { root: '/w', home: '/h', projects: [] };
    else if (p === '/api/features/flags') body = { subagent: { enabled: false }, understory: { enabled: false }, images: { enabled: flagOn } };
    else if (p === '/api/features/images') body = { images };
    else if (p === '/api/browser') body = { running: false, configured: false, routines: [] };
    else if (p === '/api/images' && method === 'GET') {
      state.listed.push(url.search);
      if (failList) return route.fulfill({ status: 500, json: { error: 'The gallery could not be read' } });
      const ids = url.searchParams.get('ids');
      if (ids) body = { pictures: ids.split(',').map((id) => pics.find((x) => x.id === id)).filter(Boolean) };
      else {
        const origin = url.searchParams.get('origin');
        const kind = url.searchParams.get('kind');
        const before = url.searchParams.get('before');
        const limit = Number(url.searchParams.get('limit') ?? 48);
        let all = sorted().filter((x) => (!origin || x.origin === origin) && (!kind || x.kind === kind));
        const total = all.length;
        if (before) {
          const [at, id] = before.split(':');
          all = all.filter((x) => x.createdAt < Number(at) || (x.createdAt === Number(at) && x.id < id));
        }
        const pageOf = all.slice(0, limit);
        const last = pageOf[pageOf.length - 1];
        body = { pictures: pageOf, next: all.length > limit && last ? `${last.createdAt}:${last.id}` : null, total, pageBytes: pics.filter((x) => x.origin === 'page').reduce((sum, x) => sum + x.bytes, 0) };
      }
    } else if (p === '/api/images/jobs' && method === 'GET') body = { jobs: state.jobs, limit: state.limit };
    else if (p.startsWith('/api/images/jobs/') && method === 'DELETE') {
      const id = p.split('/').pop()!;
      state.stopped.push(id);
      state.jobs = state.jobs.filter((j) => j.id !== id);
      body = { ok: true };
    } else if (p === '/api/images/generate' && method === 'POST') {
      const sent = route.request().postDataJSON();
      state.generated.push(sent);
      if (sent.prompt === 'refuse me') return route.fulfill({ status: 429, json: { error: '4 pictures are being made already: wait for one to finish, or stop one' } });
      const made = Array.from({ length: sent.count ?? 1 }, () => job({ prompt: sent.prompt, ...(sent.size ? { size: sent.size } : {}) }));
      state.jobs.unshift(...made);
      return route.fulfill({ status: 202, json: { jobs: made } });
    } else if (p === '/api/images/edit' && method === 'POST') {
      const sent = route.request().postDataJSON();
      state.edited.push(sent);
      const made = job({ kind: 'edit', prompt: sent.prompt, from: sent.sources[0] });
      state.jobs.unshift(made);
      return route.fulfill({ status: 202, json: { jobs: [made] } });
    } else if (p === '/api/images/upload' && method === 'POST') {
      const made = pic({ kind: 'uploaded', prompt: url.searchParams.get('name') ?? '' });
      state.uploads.push({ name: url.searchParams.get('name'), type: route.request().headers()['content-type'], size: route.request().postDataBuffer()?.length ?? 0 });
      pics.push(made);
      return route.fulfill({ status: 201, json: { picture: made } });
    } else if (p === '/api/images/delete' && method === 'POST') {
      const { ids } = route.request().postDataJSON();
      state.deleted.push(ids);
      for (const id of ids) pics.splice(pics.findIndex((x) => x.id === id), 1);
      body = { deleted: ids, failed: [] };
    } else if (/^\/api\/images\/[0-9a-f]{12}\/file$/.test(p)) {
      const id = p.split('/')[3];
      state.files.push(id);
      return route.fulfill({ body: svg(id), contentType: 'image/svg+xml' });
    }
    await route.fulfill({ json: body });
  });
  await page.addInitScript(() => {
    localStorage.setItem('pithagoras.setup', 'done');
    (window as any).EventSource = class { onmessage: any; onopen: any; onerror: any; addEventListener() {} close() {} };
  });

  return {
    state,
    pics,
    /** A running job is done: its picture is in the gallery, as the portal puts it. */
    finish(id: string, over: Partial<Pic> = {}) {
      const j = state.jobs.find((x) => x.id === id)!;
      const made = pic({ prompt: j.prompt, kind: j.kind === 'edit' ? 'edited' : 'generated', from: j.from ?? null, ...over });
      pics.push(made);
      Object.assign(j, { state: 'done', pictureId: made.id, finishedAt: Date.now() });
      return made;
    },
    fail(id: string, error: string) {
      Object.assign(state.jobs.find((x) => x.id === id)!, { state: 'failed', error, finishedAt: Date.now() });
    },
  };
}

const tile = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const grid = (page: Page) => page.getByRole('list', { name: 'Pictures' });
const viewer = (page: Page) => page.getByRole('dialog', { name: 'Picture viewer' });
const maker = (page: Page) => page.getByRole('region', { name: /Make a picture|Change a picture/ });

async function loaded(image: Locator) {
  await expect.poll(() => image.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
}

test('the sidebar has Images only while image generation is on and has an address', async ({ page }) => {
  await portal(page, { flagOn: false });
  await page.goto('/sessions');
  await expect(page.getByRole('button', { name: 'Sessions' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Images' })).toHaveCount(0);
});

test('Images in the sidebar opens the page: the form first, the gallery under it, newest first', async ({ page }) => {
  const a = pic({ prompt: 'A lighthouse at dusk', age: 30 });
  const b = pic({ prompt: 'A red bicycle', age: 5, origin: 'chat', chat: { id: 'c1', title: 'Holiday plans' } });
  await portal(page, { pictures: [a, b] });
  await page.goto('/sessions');
  await page.getByRole('button', { name: 'Images' }).first().click();
  await expect(page).toHaveURL(/\/images$/);
  await expect(page.getByRole('heading', { name: 'Images' })).toBeVisible();
  await expect(maker(page)).toBeVisible();
  const names = await grid(page).getByRole('button').evaluateAll((els) => els.map((e) => e.getAttribute('title')));
  expect(names).toEqual(['A red bicycle', 'A lighthouse at dusk']);
  // Where each is from, and how long ago, under it.
  await expect(grid(page).getByRole('listitem').first()).toContainText('Holiday plans');
  await expect(grid(page).getByRole('listitem').first()).toContainText('5m ago');
  await expect(grid(page).getByRole('listitem').last()).toContainText('Made');
  await expect(page.getByText('2', { exact: true }).first()).toBeVisible();
});

test('with nothing made yet the gallery says so, and a gallery that cannot be read says that', async ({ page }) => {
  await portal(page);
  await page.goto('/images');
  await expect(page.getByText('No pictures yet. Describe one above to make the first.')).toBeVisible();
});

test('a gallery that cannot be read says why', async ({ page }) => {
  await portal(page, { failList: true });
  await page.goto('/images');
  await expect(page.getByRole('alert')).toContainText('The gallery could not be read');
});

test('with image generation switched off the page says so and still shows what there is', async ({ page }) => {
  await portal(page, { pictures: [pic({ prompt: 'Left over' })], images: feature({ enabled: false }), flagOn: false });
  await page.goto('/images');
  await expect(page.getByText('Image generation is switched off, or has no address.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Set it up in Settings → Add-ons' })).toHaveAttribute('href', '/settings/add-ons');
  await expect(maker(page)).toHaveCount(0);
  await expect(tile(page, 'Left over')).toBeVisible();
});

test('the filters ask the portal for what they say, and are in the address', async ({ page }) => {
  const p = await portal(page, { pictures: [pic({ prompt: 'Mine' }), pic({ prompt: 'The agent’s', origin: 'chat', chat: { id: 'c1', title: 'A chat' } }), pic({ prompt: 'Changed one', kind: 'edited' })] });
  await page.goto('/images');
  await expect(grid(page).getByRole('listitem')).toHaveCount(3);
  await page.getByRole('radiogroup', { name: 'Where from' }).getByRole('radio', { name: 'From chats' }).click();
  await expect(page).toHaveURL(/\/images\?origin=chat$/);
  await expect(grid(page).getByRole('listitem')).toHaveCount(1);
  await expect(tile(page, 'The agent’s')).toBeVisible();
  expect(p.state.listed.some((q) => q.includes('origin=chat'))).toBe(true);
  await page.getByRole('radiogroup', { name: 'Where from' }).getByRole('radio', { name: 'All' }).click();
  await page.getByRole('radiogroup', { name: 'How it was made' }).getByRole('radio', { name: 'Changed' }).click();
  await expect(page).toHaveURL(/\/images\?kind=edited$/);
  await expect(grid(page).getByRole('listitem')).toHaveCount(1);
  await expect(tile(page, 'Changed one')).toBeVisible();
  // Back goes through the filters, one at a time: the unfiltered list in between, and the chats before it.
  await page.goBack();
  await expect(page).toHaveURL(/\/images$/);
  await expect(grid(page).getByRole('listitem')).toHaveCount(3);
  await page.goBack();
  await expect(page).toHaveURL(/\/images\?origin=chat$/);
  await expect(grid(page).getByRole('listitem')).toHaveCount(1);
  await expect(tile(page, 'The agent’s')).toBeVisible();
  // A link with a filter in it opens on it.
  await page.goto('/images?origin=chat&kind=generated');
  await expect(page.getByRole('radiogroup', { name: 'Where from' }).getByRole('radio', { name: 'From chats' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radiogroup', { name: 'How it was made' }).getByRole('radio', { name: 'Made', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(grid(page).getByRole('listitem')).toHaveCount(1);
});

test('a gallery of hundreds is asked for a page at a time, and pictures far down are not fetched', async ({ page }) => {
  // A phone is narrow, so the forty-eight of a page are a long column: most of them are far from the screen.
  await page.setViewportSize({ width: 375, height: 760 });
  const many = Array.from({ length: 150 }, (_, i) => pic({ prompt: `Many ${i + 1}`, age: i }));
  const p = await portal(page, { pictures: many });
  await page.goto('/images');
  await expect(grid(page).getByRole('listitem')).toHaveCount(48);
  expect(p.state.listed[0]).toContain('limit=48');
  await expect(page.getByText('150', { exact: true }).first()).toBeVisible();
  // What is near the screen is fetched, not all forty-eight.
  await expect.poll(() => p.state.files.length).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  expect(p.state.files.length).toBeLessThan(36);
  const before = p.state.files.length;
  await page.getByRole('button', { name: 'Show more' }).scrollIntoViewIfNeeded();
  await expect.poll(() => p.state.files.length).toBeGreaterThan(before);
  await expect(grid(page).getByRole('listitem')).toHaveCount(96);
  expect(p.state.listed.some((q) => q.includes('before='))).toBe(true);
  // Newest first all the way down, none twice.
  const titles = await grid(page).getByRole('button').evaluateAll((els) => els.map((e) => e.getAttribute('title')));
  expect(titles[0]).toBe('Many 1');
  expect(titles[95]).toBe('Many 96');
  expect(new Set(titles).size).toBe(96);
});

test('making a picture starts a job that holds its place in the grid, and the picture arrives there', async ({ page }) => {
  const p = await portal(page, { pictures: [pic({ prompt: 'Older', age: 60 })] });
  await page.goto('/images');
  await page.getByPlaceholder('Describe the picture').fill('A fox in the snow');
  await page.getByRole('button', { name: 'Make the picture' }).click();
  expect(p.state.generated).toEqual([{ prompt: 'A fox in the snow', count: 1 }]);
  // The wait is the first tile, where the picture will be.
  const waiting = grid(page).locator('.image-preview.is-making');
  await expect(waiting).toHaveCount(1);
  await expect(waiting).toContainText('Making a picture');
  await expect(page.getByText('1 of 4 being made')).toBeVisible();
  const first = grid(page).getByRole('listitem').first();
  await expect(first.locator('.image-preview.is-making')).toBeVisible();
  const made = p.finish(p.state.jobs[0].id);
  await expect(tile(page, 'A fox in the snow')).toBeVisible();
  await expect(grid(page).locator('.image-preview.is-making')).toHaveCount(0);
  await expect(grid(page).getByRole('listitem')).toHaveCount(2);
  // The same place: first, and the one that was made, once.
  await expect(grid(page).getByRole('listitem').first().getByRole('button')).toHaveAttribute('data-picture-id', made.id);
  await expect(page.getByText('1 of 4 being made')).toHaveCount(0);
});

test('the settings of a request are sent as set, and are kept for the next visit, not the words', async ({ page }) => {
  const p = await portal(page);
  await page.goto('/images');
  await page.getByRole('button', { name: 'Options' }).click();
  await page.getByLabel('Model').fill('draw-2');
  await page.getByLabel('Picture size').fill('768x512');
  await page.getByLabel('How many').selectOption('2');
  await page.getByLabel('Other fields of the request').fill('quality=high\nseed="42"\nsteps=30');
  await page.getByPlaceholder('Describe the picture').fill('Two boats');
  await page.getByRole('button', { name: 'Make 2 pictures' }).click();
  expect(p.state.generated).toEqual([{ prompt: 'Two boats', model: 'draw-2', size: '768x512', extra: { quality: 'high', seed: '"42"', steps: '30' }, count: 2 }]);
  await expect(grid(page).locator('.image-preview.is-making')).toHaveCount(2);
  await page.reload();
  await expect(page.getByLabel('Model')).toHaveValue('draw-2');
  await expect(page.getByLabel('Picture size')).toHaveValue('768x512');
  await expect(page.getByLabel('How many')).toHaveValue('2');
  await expect(page.getByLabel('Other fields of the request')).toHaveValue('quality=high\nseed="42"\nsteps=30');
  await expect(page.getByPlaceholder('Describe the picture')).toHaveValue('');
});

test('a line of the extra fields that is not name=value is said before anything is sent', async ({ page }) => {
  const p = await portal(page);
  await page.goto('/images');
  await page.getByRole('button', { name: 'Options' }).click();
  await page.getByLabel('Other fields of the request').fill('quality=high\nnonsense');
  await page.getByPlaceholder('Describe the picture').fill('A boat');
  await page.getByRole('button', { name: 'Make the picture' }).click();
  await expect(page.getByRole('alert')).toContainText('Extra fields, line 2: write it as name=value.');
  expect(p.state.generated).toEqual([]);
});

test('what the portal refuses is shown, and a button does nothing without words', async ({ page }) => {
  const p = await portal(page);
  await page.goto('/images');
  await expect(page.getByRole('button', { name: 'Make the picture' })).toBeDisabled();
  await page.getByPlaceholder('Describe the picture').fill('refuse me');
  await page.getByRole('button', { name: 'Make the picture' }).click();
  await expect(page.getByRole('alert')).toContainText('4 pictures are being made already');
  expect(p.state.jobs).toEqual([]);
});

test('when as many pictures are being made as may be, no more is started from the form', async ({ page }) => {
  const now = Date.now();
  const running: Job[] = Array.from({ length: 4 }, (_, i) => ({ id: `r${i}`.padEnd(12, '0'), kind: 'generate', state: 'running', prompt: `Running ${i}`, startedAt: now - i }));
  await portal(page, { jobs: running });
  await page.goto('/images');
  await expect(grid(page).locator('.image-preview.is-making')).toHaveCount(4);
  await page.getByPlaceholder('Describe the picture').fill('One too many');
  await expect(page.getByRole('button', { name: 'Make the picture' })).toBeDisabled();
});

test('a picture that was not made says why, and can be dismissed; one that is being made can be stopped', async ({ page }) => {
  const now = Date.now();
  const p = await portal(page, {
    jobs: [
      { id: 'a'.repeat(12), kind: 'generate', state: 'failed', prompt: 'Refused picture', startedAt: now - 5000, finishedAt: now - 4000, error: 'The image endpoint answered 400: that prompt is not allowed' },
      { id: 'b'.repeat(12), kind: 'generate', state: 'running', prompt: 'Slow picture', startedAt: now - 9000 },
    ],
  });
  await page.goto('/images');
  const failed = grid(page).locator('.image-preview.is-failed');
  await expect(failed).toContainText('No picture was made');
  await expect(failed).toContainText('that prompt is not allowed');
  await failed.getByRole('button', { name: 'Dismiss' }).click();
  await expect(failed).toHaveCount(0);
  expect(p.state.stopped).toEqual(['a'.repeat(12)]);
  await grid(page).locator('.image-preview.is-making').getByRole('button', { name: 'Stop' }).click();
  await expect(grid(page).locator('.image-preview.is-making')).toHaveCount(0);
  expect(p.state.stopped).toEqual(['a'.repeat(12), 'b'.repeat(12)]);
});

test('jobs that were done when the page was opened are not shown again: their pictures are in the gallery', async ({ page }) => {
  const made = pic({ prompt: 'Made before' });
  await portal(page, { pictures: [made], jobs: [{ id: 'd'.repeat(12), kind: 'generate', state: 'done', prompt: 'Made before', startedAt: Date.now() - 9000, finishedAt: Date.now() - 8000, pictureId: made.id }] });
  await page.goto('/images');
  await expect(grid(page).getByRole('listitem')).toHaveCount(1);
});

test('a picture opens in the viewer over the page, which steps through the gallery', async ({ page }) => {
  const a = pic({ prompt: 'First', age: 3 });
  const b = pic({ prompt: 'Second', age: 2 });
  const c = pic({ prompt: 'Third', age: 1 });
  await portal(page, { pictures: [a, b, c] });
  await page.goto('/images');
  await tile(page, 'Second').click();
  await expect(viewer(page)).toBeVisible();
  await expect(viewer(page).locator('img[data-picture]')).toHaveAttribute('src', `/api/images/${b.id}/file`);
  await expect(viewer(page)).toContainText('Second');
  await expect(viewer(page).getByText('2 / 3', { exact: true })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(viewer(page).locator('img[data-picture]')).toHaveAttribute('src', `/api/images/${a.id}/file`);
  await page.keyboard.press('Escape');
  await expect(viewer(page)).toHaveCount(0);
  // Back to the picture that was looked at last.
  await expect(tile(page, 'First')).toBeFocused();
});

test('the original and its edit reach each other, also when the original is further down than the page has loaded', async ({ page }) => {
  const original = pic({ prompt: 'The original', age: 500 });
  const filler = Array.from({ length: 60 }, (_, i) => pic({ prompt: `Filler ${i}`, age: 10 + i }));
  const edit = pic({ prompt: 'Make it blue', kind: 'edited', from: original.id, age: 1 });
  const p = await portal(page, { pictures: [original, ...filler, edit] });
  await page.goto('/images');
  await tile(page, 'Make it blue').click();
  await expect(viewer(page).getByRole('button', { name: 'Show the original' })).toBeVisible();
  expect(p.state.listed.some((q) => q.includes(`ids=${original.id}`))).toBe(true);
  await viewer(page).getByRole('button', { name: 'Show the original' }).click();
  await expect(viewer(page)).toContainText('The original');
  await expect(viewer(page).locator('img[data-picture]')).toHaveAttribute('src', `/api/images/${original.id}/file`);
  await viewer(page).getByRole('button', { name: 'Show the edited version' }).click();
  await expect(viewer(page)).toContainText('Make it blue');
});

test('an original that was reached from its edit and is deleted there is gone from the viewer, and the edit no longer points at it', async ({ page }) => {
  const original = pic({ prompt: 'The original', age: 500 });
  const filler = Array.from({ length: 60 }, (_, i) => pic({ prompt: `Filler ${i}`, age: 10 + i }));
  const edit = pic({ prompt: 'Make it blue', kind: 'edited', from: original.id, age: 1 });
  const p = await portal(page, { pictures: [original, ...filler, edit] });
  await page.goto('/images');
  await tile(page, 'Make it blue').click();
  await viewer(page).getByRole('button', { name: 'Show the original' }).click();
  await expect(viewer(page)).toContainText('The original');
  await expect(viewer(page).getByText('2 / 49', { exact: true })).toBeVisible();
  await viewer(page).getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog', { name: 'Delete this picture?' }).getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => p.state.deleted).toEqual([[original.id]]);
  // The viewer goes on with the next picture of the gallery, and the deleted one is not in what it steps through.
  await expect(viewer(page).getByText('2 / 48', { exact: true })).toBeVisible();
  await expect(viewer(page).locator('img[data-picture]')).not.toHaveAttribute('src', `/api/images/${original.id}/file`);
  await viewer(page).getByRole('button', { name: 'Previous picture' }).click();
  await expect(viewer(page)).toContainText('Make it blue');
  await expect(viewer(page).getByRole('button', { name: 'Show the original' })).toHaveCount(0);
});

test('stepping on in the viewer asks for the next page of the gallery', async ({ page }) => {
  const many = Array.from({ length: 60 }, (_, i) => pic({ prompt: `Step ${i + 1}`, age: i }));
  await portal(page, { pictures: many });
  await page.goto('/images');
  await expect(grid(page).getByRole('listitem')).toHaveCount(48);
  await tile(page, 'Step 44').click();
  // Within a few of the end of what is loaded: the rest is loaded behind it, and the count has it.
  await expect(viewer(page).getByText('44 / 60', { exact: true })).toBeVisible();
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
  await expect(viewer(page).getByText('54 / 60', { exact: true })).toBeVisible();
  await expect(viewer(page)).toContainText('Step 54');
});

test('Details tells what a picture was made with and when, and where a chat’s is from', async ({ page }) => {
  const made = pic({
    prompt: 'A fox\nin the snow', params: { model: 'draw-2', size: '1024x768', extra: { quality: 'high', seed: '42' } }, origin: 'chat', chat: { id: 'c9', title: 'Winter story' },
    createdAt: Date.parse('2026-09-30T08:15:00Z'), fileName: 'fox.png', bytes: 2_500_000,
  });
  await portal(page, { pictures: [made] });
  await page.goto('/images');
  await tile(page, 'A fox\nin the snow').click();
  await viewer(page).getByRole('button', { name: 'Details' }).click();
  const details = viewer(page).getByRole('region', { name: 'Details' });
  await expect(details).toContainText('A fox');
  await expect(details).toContainText('draw-2');
  await expect(details).toContainText('1024x768');
  await expect(details).toContainText('quality=high');
  await expect(details).toContainText('In the chat “Winter story”');
  await expect(details).toContainText('fox.png · 2.4 MB');
  await expect(details.getByRole('link', { name: 'Open the chat' })).toHaveAttribute('href', '/s/c9');
});

test('Edit it puts the picture in the form, and the change is sent with it', async ({ page }) => {
  const made = pic({ prompt: 'A fox' });
  const p = await portal(page, { pictures: [made] });
  await page.goto('/images');
  await tile(page, 'A fox').click();
  await viewer(page).getByRole('button', { name: 'Edit it' }).click();
  await expect(viewer(page)).toHaveCount(0);
  await expect(maker(page)).toHaveAccessibleName('Change a picture');
  await expect(maker(page).getByRole('img', { name: 'A fox' })).toBeVisible();
  await expect(page.getByPlaceholder('Describe the change: what to add, remove or make different')).toBeFocused();
  await page.keyboard.type('Make the fur white');
  await page.getByRole('button', { name: 'Change the picture' }).click();
  expect(p.state.edited).toEqual([{ prompt: 'Make the fur white', sources: [made.id] }]);
  // Made over the original, which is under the wait.
  const waiting = grid(page).locator('.image-preview.is-making');
  await expect(waiting).toContainText('Editing a picture');
  p.finish(p.state.jobs[0].id);
  await expect(tile(page, 'Make the fur white')).toBeVisible();
  // A new picture again, whenever it is wanted.
  await page.getByRole('button', { name: 'Make a new picture instead' }).click();
  await expect(maker(page)).toHaveAccessibleName('Make a picture');
});

test('where the endpoint cannot change pictures there is no Edit it, and no upload', async ({ page }) => {
  await portal(page, { pictures: [pic({ prompt: 'A fox' })], images: feature({ editReady: false, editEnabled: false }) });
  await page.goto('/images');
  await tile(page, 'A fox').click();
  await expect(viewer(page).getByRole('button', { name: 'Details' })).toBeVisible();
  await expect(viewer(page).getByRole('button', { name: 'Edit it' })).toHaveCount(0);
  await expect(viewer(page).getByRole('button', { name: 'Run again' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /from this computer/ })).toHaveCount(0);
});

test('Use as a reference adds pictures to an edit, in order, only where the endpoint takes several', async ({ page }) => {
  const a = pic({ prompt: 'Alpha', age: 2 });
  const b = pic({ prompt: 'Beta', age: 1 });
  const p = await portal(page, { pictures: [a, b], images: feature({ editMultiple: true }) });
  await page.goto('/images');
  await tile(page, 'Alpha').click();
  await viewer(page).getByRole('button', { name: 'Edit it' }).click();
  await tile(page, 'Beta').click();
  await viewer(page).getByRole('button', { name: 'Use as a reference' }).click();
  await expect(viewer(page).getByRole('button', { name: 'Do not use as a reference' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(maker(page).getByRole('listitem')).toHaveCount(2);
  await page.getByPlaceholder('Describe the change: what to add, remove or make different').fill('Put the second into the first');
  await page.getByRole('button', { name: 'Change the picture' }).click();
  expect(p.state.edited).toEqual([{ prompt: 'Put the second into the first', sources: [a.id, b.id] }]);
});

test('without several pictures taken there is no Use as a reference', async ({ page }) => {
  await portal(page, { pictures: [pic({ prompt: 'Alpha' })] });
  await page.goto('/images');
  await tile(page, 'Alpha').click();
  await expect(viewer(page).getByRole('button', { name: 'Edit it' })).toBeVisible();
  await expect(viewer(page).getByRole('button', { name: /reference/ })).toHaveCount(0);
});

test('Run again makes a picture from a description once more, as it was asked for', async ({ page }) => {
  const made = pic({ prompt: 'A fox', params: { model: 'draw-2', size: '768x512', extra: { quality: 'high', seed: '42', hd: true } } });
  const p = await portal(page, { pictures: [made] });
  await page.goto('/images');
  await tile(page, 'A fox').click();
  await viewer(page).getByRole('button', { name: 'Run again' }).click();
  await expect(viewer(page)).toHaveCount(0);
  // The extra fields as they were: a text that looks like a number is sent in quotes, so that it stays text.
  expect(p.state.generated).toEqual([{ prompt: 'A fox', size: '768x512', model: 'draw-2', extra: { quality: 'high', seed: '"42"', hd: 'true' } }]);
  await expect(grid(page).locator('.image-preview.is-making')).toHaveCount(1);
});

test('Run again of a change shows it in the form, with its pictures and words, since its mask is not kept', async ({ page }) => {
  const a = pic({ prompt: 'Alpha', age: 5 });
  const edit = pic({ prompt: 'Make it night', kind: 'edited', from: a.id, params: { sources: [a.id], masked: true }, age: 1 });
  const p = await portal(page, { pictures: [a, edit] });
  await page.goto('/images');
  await tile(page, 'Make it night').click();
  await viewer(page).getByRole('button', { name: 'Run again' }).click();
  await expect(maker(page)).toHaveAccessibleName('Change a picture');
  await expect(maker(page).getByRole('img', { name: 'Alpha' })).toBeVisible();
  await expect(page.getByPlaceholder('Describe the change: what to add, remove or make different')).toHaveValue('Make it night');
  expect(p.state.edited).toEqual([]);
});

test('a picture put in from this computer is in the gallery and is the one to change', async ({ page }) => {
  const p = await portal(page);
  await page.goto('/images');
  await page.getByLabel('Upload a picture').setInputFiles({ name: 'cat.png', mimeType: 'image/png', buffer: Buffer.from('not really a png, the portal looks') });
  await expect(maker(page)).toHaveAccessibleName('Change a picture');
  await expect(maker(page).getByRole('img', { name: 'cat.png' })).toBeVisible();
  expect(p.state.uploads).toEqual([{ name: 'cat.png', type: 'application/octet-stream', size: 34 }]);
  await expect(tile(page, 'cat.png')).toBeVisible();
});

test('a part of the picture can be painted as a mask, which goes with the change at the picture’s own size', async ({ page }) => {
  const made = pic({ prompt: 'A fox' });
  const p = await portal(page, { pictures: [made] });
  await page.goto('/images');
  await tile(page, 'A fox').click();
  await viewer(page).getByRole('button', { name: 'Edit it' }).click();
  await page.getByRole('button', { name: 'Only change a part: paint a mask' }).click();
  const canvas = page.getByLabel('Paint over the part that should change');
  await loaded(page.getByRole('img', { name: 'The picture to change' }));
  const box = (await canvas.boundingBox())!;
  // A stroke across the middle.
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5, { steps: 6 });
  await page.mouse.up();
  await page.getByPlaceholder('Describe the change: what to add, remove or make different').fill('Add a hat');
  await page.getByRole('button', { name: 'Change the picture' }).click();
  await expect.poll(() => p.state.edited.length).toBe(1);
  const sent = p.state.edited[0];
  expect(sent).toMatchObject({ prompt: 'Add a hat', sources: [made.id] });
  const pixels = await page.evaluate(async (mask) => {
    const img = new Image();
    img.src = `data:image/png;base64,${mask}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const alpha = (x: number, y: number) => ctx.getImageData(x, y, 1, 1).data[3];
    return { w: img.naturalWidth, h: img.naturalHeight, painted: alpha(400, 300), outside: alpha(40, 40), below: alpha(400, 560) };
  }, sent.mask);
  // The picture's own size; transparent where it was painted, and opaque elsewhere.
  expect(pixels).toEqual({ w: 800, h: 600, painted: 0, outside: 255, below: 255 });
});

test('without a stroke no mask is sent, and the whole picture may change', async ({ page }) => {
  const made = pic({ prompt: 'A fox' });
  const p = await portal(page, { pictures: [made] });
  await page.goto('/images');
  await tile(page, 'A fox').click();
  await viewer(page).getByRole('button', { name: 'Edit it' }).click();
  await page.getByRole('button', { name: 'Only change a part: paint a mask' }).click();
  await page.getByPlaceholder('Describe the change: what to add, remove or make different').fill('Add a hat');
  await page.getByRole('button', { name: 'Change the picture' }).click();
  await expect.poll(() => p.state.edited.length).toBe(1);
  expect(p.state.edited[0]).toEqual({ prompt: 'Add a hat', sources: [made.id] });
});

test('deleting a picture of the page asks, and takes it away', async ({ page }) => {
  const mine = pic({ prompt: 'Mine' });
  const other = pic({ prompt: 'Other', age: 5 });
  const p = await portal(page, { pictures: [mine, other] });
  await page.goto('/images');
  await tile(page, 'Mine').click();
  await viewer(page).getByRole('button', { name: 'Delete' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete this picture?' });
  await expect(dialog).toContainText('The file is deleted from the portal. This cannot be undone.');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(p.state.deleted).toEqual([]);
  await expect(viewer(page)).toBeVisible();
  await viewer(page).getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog', { name: 'Delete this picture?' }).getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => p.state.deleted).toEqual([[mine.id]]);
  // The viewer goes on with the next, and the gallery has lost it.
  await expect(viewer(page).locator('img[data-picture]')).toHaveAttribute('src', `/api/images/${other.id}/file`);
  await page.keyboard.press('Escape');
  await expect(tile(page, 'Mine')).toHaveCount(0);
  await expect(grid(page).getByRole('listitem')).toHaveCount(1);
});

test('the page says how much of the disk its own pictures take, and the number goes down with a delete', async ({ page }) => {
  const mine = pic({ prompt: 'Mine' });
  const more = pic({ prompt: 'More', age: 1 });
  const theirs = pic({ prompt: 'From a chat', origin: 'chat', chat: { id: 'c1', title: 'A chat' }, age: 2 });
  await portal(page, { pictures: [mine, more, theirs] });
  await page.goto('/images');
  // A chat’s files are the chat’s: only the two of the page are counted, and a filter does not change it.
  const kept = page.getByText('kept from this page').locator('..');
  await expect(kept).toContainText('234.4 KB');
  await page.getByRole('radiogroup', { name: 'Where from' }).getByRole('radio', { name: 'From chats' }).click();
  await expect(tile(page, 'From a chat')).toBeVisible();
  await expect(kept).toContainText('234.4 KB');
  await page.getByRole('radiogroup', { name: 'Where from' }).getByRole('radio', { name: 'All' }).click();
  await tile(page, 'Mine').click();
  await viewer(page).getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog', { name: 'Delete this picture?' }).getByRole('button', { name: 'Delete' }).click();
  await expect(kept).toContainText('117.2 KB');
});

test('a picture in a chat’s folder is deleted only on purpose, with a warning, whatever Settings says', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('confirmDeletes', 'off'));
  const theirs = pic({ prompt: 'From a chat', origin: 'chat', chat: { id: 'c1', title: 'Holiday plans' } });
  const mine = pic({ prompt: 'Mine', age: 5 });
  const p = await portal(page, { pictures: [theirs, mine] });
  await page.goto('/images');
  // The page's own goes at once, where Settings says not to ask.
  await tile(page, 'Mine').click();
  await viewer(page).getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => p.state.deleted).toEqual([[mine.id]]);
  // A chat's is asked about.
  await expect(viewer(page).locator('img[data-picture]')).toHaveAttribute('src', `/api/images/${theirs.id}/file`);
  await viewer(page).getByRole('button', { name: 'Delete' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete this picture?' });
  await expect(dialog).toContainText('“Holiday plans”');
  await expect(dialog).toContainText('for good');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(p.state.deleted).toEqual([[mine.id]]);
});

test('several pictures can be selected, to download or delete together', async ({ page }) => {
  const a = pic({ prompt: 'One', age: 3 });
  const b = pic({ prompt: 'Two', age: 2 });
  const c = pic({ prompt: 'Three', age: 1, origin: 'chat', chat: { id: 'c1', title: 'A chat' } });
  const p = await portal(page, { pictures: [a, b, c] });
  await page.goto('/images');
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  // A click selects, and does not open the viewer.
  await tile(page, 'One').click();
  await tile(page, 'Three').click();
  await expect(viewer(page)).toHaveCount(0);
  await expect(page.getByText('2 selected')).toBeVisible();
  await expect(page.getByLabel('Select this picture').nth(0)).toBeChecked();
  await expect(page.getByLabel('Select this picture').nth(1)).not.toBeChecked();
  const downloads: string[] = [];
  page.on('download', (d) => downloads.push(d.suggestedFilename()));
  await page.getByRole('button', { name: 'Download' }).click();
  await expect.poll(() => downloads.length).toBe(2);
  expect(downloads.sort()).toEqual([c.fileName, a.fileName].sort());
  // Deleting says that one of them is a chat’s.
  await page.getByRole('button', { name: 'Delete' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete these 2 pictures?' });
  await expect(dialog).toContainText('1 of them is a file in the folder of a chat');
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => p.state.deleted.length).toBe(1);
  expect([...p.state.deleted[0]].sort()).toEqual([a.id, c.id].sort());
  await expect(grid(page).getByRole('listitem')).toHaveCount(1);
  await expect(page.getByText('0 selected')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: 'Select', exact: true })).toBeVisible();
});

test('a selection does not follow a change of filter: a chat’s picture that is not shown is never deleted with another, whatever Settings says', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('confirmDeletes', 'off'));
  const theirs = pic({ prompt: 'From a chat', origin: 'chat', chat: { id: 'c1', title: 'Holiday plans' }, age: 5 });
  const mine = pic({ prompt: 'Mine' });
  const p = await portal(page, { pictures: [theirs, mine] });
  await page.goto('/images?origin=chat');
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await tile(page, 'From a chat').click();
  await expect(page.getByText('1 selected')).toBeVisible();
  await page.getByRole('radiogroup', { name: 'Where from' }).getByRole('radio', { name: 'Made here' }).click();
  await expect(tile(page, 'Mine')).toBeVisible();
  // What is not shown is not selected.
  await expect(page.getByText('0 selected')).toBeVisible();
  await tile(page, 'Mine').click();
  await expect(page.getByText('1 selected')).toBeVisible();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => p.state.deleted).toEqual([[mine.id]]);
  // Back to the chats: still there, and not selected.
  await page.goBack();
  await expect(tile(page, 'From a chat')).toBeVisible();
  await expect(page.getByLabel('Select this picture')).not.toBeChecked();
  expect(p.state.deleted).toEqual([[mine.id]]);
});

test('on a phone the grid has two columns, the viewer reaches every action, and nothing runs off the screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 760 });
  const many = Array.from({ length: 6 }, (_, i) => pic({ prompt: `Phone ${i + 1}`, age: i }));
  // Every button there can be: the row of them is longer than the screen.
  await portal(page, { pictures: many, images: feature({ editMultiple: true }) });
  await page.goto('/images');
  await expect(grid(page).getByRole('listitem')).toHaveCount(6);
  const columns = await grid(page).evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  expect(columns).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await tile(page, 'Phone 1').click();
  for (const name of ['Details', 'Edit it', 'Use as a reference', 'Run again', 'Delete', 'Close']) {
    const box = await viewer(page).getByRole('button', { name }).boundingBox();
    expect(box, name).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    expect(box!.x).toBeGreaterThanOrEqual(0);
  }
  // Where the buttons are too many for one row, the one that wraps stays at the right, under the others, and not at the left under the count.
  const close = await viewer(page).getByRole('button', { name: 'Close' }).boundingBox();
  expect(close!.x + close!.width).toBeGreaterThan(375 - 16);
  await viewer(page).getByRole('button', { name: 'Details' }).click();
  const panel = await viewer(page).getByRole('region', { name: 'Details' }).boundingBox();
  expect(panel!.x).toBeGreaterThanOrEqual(0);
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(375);
});

test('the gallery reads in the dark theme as in the light', async ({ page }) => {
  await portal(page, { pictures: [pic({ prompt: 'Dim one' })], jobs: [{ id: 'e'.repeat(12), kind: 'generate', state: 'failed', prompt: 'Not made', startedAt: Date.now() - 5000, error: 'No luck' }] });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/images');
    const tileBox = tile(page, 'Dim one');
    await expect(tileBox).toBeVisible();
    // The failure is readable on either: its words are not the colour of what is behind them.
    const colours = await grid(page).locator('.image-preview.is-failed').evaluate((el) => {
      const words = el.querySelector('.image-preview-failed b') as HTMLElement;
      return { ink: getComputedStyle(words).color, ground: getComputedStyle(el.querySelector('.image-preview-frame')!).backgroundColor };
    });
    expect(colours.ink).not.toBe(colours.ground);
  }
});
