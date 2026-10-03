import { test, expect, type Page } from '@playwright/test';

/** A portal with a password: signed in once the right one is posted, and signed out again when `expired` says so. */
async function portal(page: Page, state: { authed: boolean; expired?: boolean }) {
  const calls = { status: 0, login: [] as unknown[], rename: 0 };
  const session = { id: 's1', title: 'Old name', workspace: '/w/site', status: 'idle', kind: 'task', pinned: false, updated_at: new Date().toISOString() };
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (p === '/api/auth/status') { calls.status++; return route.fulfill({ json: { authRequired: true, authed: state.authed } }); }
    if (p === '/api/auth/login') {
      const body = route.request().postDataJSON();
      calls.login.push(body);
      if (body.password !== 'secret') return route.fulfill({ status: 401, json: { error: 'Wrong password' } });
      state.authed = true;
      state.expired = false;
      return route.fulfill({ json: { ok: true } });
    }
    // The portal has forgotten this browser: what the server answers to a cookie it no longer takes.
    if (state.expired) return route.fulfill({ status: 401, json: { error: 'Unauthorized' } });
    if (p === '/api/sessions' && method === 'GET') return route.fulfill({ json: { sessions: [session], executor: 'host' } });
    if (p === '/api/sessions/s1' && method === 'PATCH') { calls.rename++; return route.fulfill({ json: session }); }
    if (p === '/api/workspaces') return route.fulfill({ json: { root: '/w', workspaces: [] } });
    return route.fulfill({ json: {} });
  });
  await page.addInitScript(() => {
    (window as any).EventSource = class { onmessage: any; onopen: any; onerror: any; addEventListener() {} close() {} };
    localStorage.setItem('pithagoras.setup', 'done');
  });
  return calls;
}

test('without a login the page asks for the password, and the right one opens the portal', async ({ page }) => {
  const state = { authed: false };
  const calls = await portal(page, state);
  await page.goto('/sessions');
  const password = page.getByPlaceholder('Password');
  const signIn = page.getByRole('button', { name: 'Sign in' });
  await expect(password).toBeVisible();
  await expect(page.getByText('Old name')).toHaveCount(0);
  await expect(signIn).toBeDisabled();

  await password.fill('secret');
  await signIn.click();
  // The password goes as the body's `password`, which is what the server reads.
  await expect.poll(() => calls.login).toEqual([{ password: 'secret' }]);
  await expect(page.getByRole('main').getByText('Old name')).toBeVisible();
  await expect(password).toHaveCount(0);
});

test('a wrong password is said so, and asked again without looping on the 401', async ({ page }) => {
  const calls = await portal(page, { authed: false });
  await page.goto('/sessions');
  await expect(page.getByPlaceholder('Password')).toBeVisible();
  const asked = calls.status;
  await page.getByPlaceholder('Password').fill('guess');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Wrong password')).toBeVisible();
  await expect(page.getByPlaceholder('Password')).toBeVisible();
  // Settled: the refusal of the login itself is not the portal forgetting a login, which would ask the server again.
  await page.waitForTimeout(500);
  expect(calls.login).toEqual([{ password: 'guess' }]);
  expect(calls.status).toBe(asked);
});

test('a login that runs out in the middle of the work returns to the form, and signing in again goes on', async ({ page }) => {
  const state = { authed: true, expired: false };
  const calls = await portal(page, state);
  await page.goto('/sessions');
  await expect(page.getByRole('main').getByText('Old name')).toBeVisible();

  state.expired = true;
  await page.getByRole('button', { name: 'Rename Old name' }).click();
  const field = page.getByLabel('Session name');
  await field.fill('New name');
  await field.press('Enter');
  await expect(page.getByPlaceholder('Password')).toBeVisible();
  await expect(page.getByText(/HTTP 401|Unauthorized/)).toHaveCount(0);

  await page.getByPlaceholder('Password').fill('secret');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('main').getByText('Old name')).toBeVisible();
  expect(calls.login).toEqual([{ password: 'secret' }]);
});
