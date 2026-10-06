import { type Page } from '@playwright/test';
import { test, expect, mockPortal, reply } from './portal-mock';

/** The Devices add-on with no server: its switch in Settings → Add-ons, and its page, over canned answers. */

const info = (mode: 'ask' | 'folders' | 'full') => ({
  name: 'laptop', os: 'linux', arch: 'x86_64', os_release: 'Debian 13', hostname: 'laptop', user: 'alice', uid: 1000, home: '/home/alice', shell: 'bash',
  session: 'headless', mode, mode_expires_ms: null, folders: [{ path: '/home/alice/src', access: 'rw', execute: true }], folders_shell: 'landlock',
  tools: ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls'], client_version: '0.1.0',
});

const approval = {
  id: 12, call: 4, chat: 'chat-1', tool: 'exec', target: 'make deploy', reasons: ['Ask mode: every call asks'], preview: null,
  choices: ['once', 'chat', 'time', 'deny'], max_minutes: 60, created_ms: 0, expires_ms: 0,
};

function device(over: Record<string, unknown> = {}) {
  return {
    id: 'd0123456789abcdef', name: 'laptop', os: 'linux', arch: 'x86_64', created_at: '2026-10-05 08:00:00', last_seen: '2026-10-05 08:00:00',
    online: true, connectedAt: '2026-10-05T08:00:00Z', hello: { clientVersion: '0.1.0', user: 'alice', shell: 'bash', capabilities: ['fs', 'exec', 'probe', 'approvals', 'policy'] },
    info: info('ask'), sameMachine: false, approvals: [approval],
    policy: { portal_policy: 'read', version: 'v1', settings: { policy: { mode: 'ask', tools: { bash: true } }, exec: {} }, device_only: ['exec.shell'] },
    alert: null, ...over,
  };
}

async function portal(page: Page, { enabled = true, switchedOn = enabled, refused = null as string | null, devices = [device()] as any[] } = {}) {
  const sent: { method: string; path: string; body: any }[] = [];
  const state = { enabled, switchedOn, devices, pairing: null as null | { expires: string } };
  await mockPortal(page, ({ path, method, json }) => {
    if (method !== 'GET') sent.push({ method, path, body: method === 'DELETE' ? null : json() });
    if (path === '/api/features/flags') return { subagent: { enabled: false }, understory: { enabled: false }, images: { enabled: false }, devices: { enabled: state.enabled } };
    if (path === '/api/features/devices' && method === 'GET') return { enabled: state.enabled, switchedOn: state.switchedOn, refused };
    if (path === '/api/features/devices' && method === 'PUT') {
      state.enabled = json().enabled;
      state.switchedOn = state.enabled;
      return { enabled: state.enabled, switchedOn: state.switchedOn, refused, reloaded: 0, waiting: 0 };
    }
    if (path === '/api/devices' && method === 'GET') return { devices: state.devices, pairing: state.pairing, spki: 'pin-of-the-portal' };
    if (path === '/api/devices/pair' && method === 'POST') {
      state.pairing = { expires: new Date(Date.now() + 600_000).toISOString() };
      return { code: 'K7Q2M9XZ', expires: state.pairing.expires, attempts: 10, spki: 'pin-of-the-portal' };
    }
    if (path === '/api/devices/pair' && method === 'DELETE') {
      state.pairing = null;
      return { ok: true };
    }
    const one = /^\/api\/devices\/([^/]+)(\/.*)?$/.exec(path);
    if (one && !one[2] && method === 'PUT') {
      state.devices = state.devices.map((d) => (d.id === one[1] ? { ...d, name: json().name } : d));
      return { device: state.devices[0] };
    }
    if (one && !one[2] && method === 'DELETE') {
      state.devices = state.devices.filter((d) => d.id !== one[1]);
      return { ok: true };
    }
    if (one && one[2]?.startsWith('/approvals/')) {
      state.devices = state.devices.map((d) => ({ ...d, approvals: [] }));
      return { ok: true };
    }
    if (one && one[2] === '/policy' && method === 'PUT') {
      if (json().ifVersion !== 'v1') return reply(409, { error: 'The settings changed on the device meanwhile' });
      return { policy: { ...state.devices[0].policy, version: 'v2', settings: json().settings } };
    }
    return undefined;
  });
  return { sent, state };
}

const settings = (page: Page) => page.getByRole('dialog', { name: 'Settings' });

test('the add-on is off at first; switched on, the Devices page is in the sidebar', async ({ page }) => {
  const { sent } = await portal(page, { enabled: false, devices: [] });
  await page.goto('/settings/add-ons');
  await settings(page).getByRole('tab', { name: 'Devices' }).click();
  const toggle = settings(page).getByRole('switch', { name: 'Devices' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('navigation', { name: 'Destinations' }).last().getByRole('button', { name: 'Devices' })).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  expect(sent).toEqual([{ method: 'PUT', path: '/api/features/devices', body: { enabled: true } }]);
  await expect(settings(page).getByRole('link', { name: 'Pair and manage devices' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('navigation', { name: 'Destinations' }).last().getByRole('button', { name: 'Devices' })).toBeVisible();
});

test('a portal without a password cannot switch devices on, and says why', async ({ page }) => {
  await portal(page, { enabled: false, refused: 'no password', devices: [] });
  await page.goto('/settings/add-ons');
  await settings(page).getByRole('tab', { name: 'Devices' }).click();
  await expect(settings(page).getByRole('switch', { name: 'Devices' })).toBeDisabled();
  await expect(settings(page).getByText(/Set PORTAL_PASSWORD first/)).toBeVisible();
});

test('a switch left on in a portal that lost its password says nothing answers, and can still be switched off', async ({ page }) => {
  const { sent } = await portal(page, { enabled: false, switchedOn: true, refused: 'no password', devices: [] });
  await page.goto('/settings/add-ons');
  await settings(page).getByRole('tab', { name: 'Devices' }).click();
  const toggle = settings(page).getByRole('switch', { name: 'Devices' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(settings(page).getByText('Switched on, but nothing answers while the portal runs without a password.')).toBeVisible();
  await expect(settings(page).getByText(/Set PORTAL_PASSWORD first/)).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  expect(sent).toEqual([{ method: 'PUT', path: '/api/features/devices', body: { enabled: false } }]);
});

test('the page links to the newest client release, one program per system', async ({ page }) => {
  await portal(page, { devices: [] });
  await page.goto('/devices');
  const box = page.getByTestId('client-downloads');
  const base = 'https://github.com/Piggidragon/Pithagoras-Sync/releases/latest';
  await expect(box.getByRole('link', { name: 'Linux (x86-64)' })).toHaveAttribute('href', `${base}/download/pithagoras-sync-x86_64-linux`);
  await expect(box.getByRole('link', { name: 'Linux (ARM64)' })).toHaveAttribute('href', `${base}/download/pithagoras-sync-aarch64-linux`);
  await expect(box.getByRole('link', { name: 'Windows (x86-64)' })).toHaveAttribute('href', `${base}/download/pithagoras-sync-x86_64-windows.exe`);
  await expect(box.getByRole('link', { name: 'All downloads and the install guide' })).toHaveAttribute('href', base);
});

test('pairing shows the code once, with the command that carries the portal address; no pin over plain HTTP', async ({ page }) => {
  const { sent } = await portal(page, { devices: [] });
  await page.goto('/devices');
  await expect(page.getByText('No device is paired yet.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Pair a device' }).click();
  await expect(page.getByTestId('pairing-code')).toHaveText('K7Q2M9XZ');
  await expect(page.getByRole('timer')).toHaveText(/Runs out in (9:5\d|10:00)/);
  const origin = new URL(page.url()).origin;
  const uri = `pithagoras-sync://pair?portal=${encodeURIComponent(origin)}&code=K7Q2M9XZ`;
  await expect(page.getByText(`pithagoras-sync pair '${uri}'`)).toBeVisible();
  await expect(page.getByText(uri, { exact: true })).toBeVisible();
  await expect(page.getByText(/spki=/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel the code' }).click();
  await expect(page.getByTestId('pairing-code')).toHaveCount(0);
  expect(sent.map((s) => `${s.method} ${s.path}`)).toEqual(['POST /api/devices/pair', 'DELETE /api/devices/pair']);
});

test('a device shows its state; an approval is answered from the page, for a time the device allows', async ({ page }) => {
  const { sent } = await portal(page);
  await page.goto('/devices');
  const card = page.getByRole('listitem', { name: 'laptop' });
  await expect(card.getByText('connected')).toBeVisible();
  await expect(card.getByText('Ask: every call asks you first')).toBeVisible();
  await expect(card.getByText('alice@laptop', { exact: false })).toBeVisible();
  const asks = card.getByTestId('device-approval');
  await expect(asks.getByText('make deploy')).toBeVisible();
  await expect(asks.getByRole('link', { name: 'from this chat' })).toHaveAttribute('href', '/s/chat-1');
  // Longer than the device's max_minutes is not offered.
  await expect(asks.getByRole('combobox', { name: 'Minutes' }).locator('option')).toHaveText(['15 minutes', '30 minutes', '60 minutes']);
  await asks.getByRole('combobox', { name: 'Minutes' }).selectOption('60');
  await asks.getByRole('button', { name: 'Allow for', exact: true }).click();
  await expect(card.getByTestId('device-approval')).toHaveCount(0);
  expect(sent).toEqual([{ method: 'POST', path: '/api/devices/d0123456789abcdef/approvals/12', body: { answer: 'time', minutes: 60 } }]);
});

test('settings the device keeps to itself are only shown; where it allows it, a change is saved with the version it is based on', async ({ page }) => {
  const { sent, state } = await portal(page);
  await page.goto('/devices');
  const card = page.getByRole('listitem', { name: 'laptop' });
  await card.getByText('Settings (shown only', { exact: false }).click();
  await expect(card.getByRole('textbox', { name: 'Device settings' })).toHaveAttribute('readonly', '');
  await expect(card.getByRole('radiogroup', { name: 'Mode' })).toHaveCount(0);

  state.devices = [device({ policy: { portal_policy: 'write', version: 'v1', settings: { policy: { mode: 'ask', tools: { bash: true } }, exec: {} }, device_only: ['exec.shell'] } })];
  await page.reload();
  await page.getByRole('listitem', { name: 'laptop' }).getByText('Settings (the device lets', { exact: false }).click();
  const writable = page.getByRole('listitem', { name: 'laptop' });
  await writable.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name: 'Full' }).click();
  await writable.getByRole('checkbox', { name: 'bash' }).uncheck();
  await expect(writable.getByText('Only the device changes: exec.shell')).toBeVisible();
  await writable.getByRole('button', { name: 'Save on the device' }).click();
  await expect(writable.getByRole('button', { name: 'Save on the device' })).toHaveCount(0);
  const put = sent.find((s) => s.method === 'PUT')!;
  expect(put).toEqual({
    method: 'PUT', path: '/api/devices/d0123456789abcdef/policy',
    body: { settings: { policy: { mode: 'full', tools: { bash: false } }, exec: {} }, ifVersion: 'v1' },
  });
});

test('rename, and removal after asking; a second connection with the token is said', async ({ page }) => {
  const { sent } = await portal(page, { devices: [device({ alert: { at: Date.parse('2026-10-05T09:00:00Z'), message: 'x' }, approvals: [] })] });
  await page.goto('/devices');
  await expect(page.getByRole('alert')).toContainText("something else tried to connect with this device's token");
  await page.getByRole('button', { name: 'Rename laptop' }).click();
  await page.getByRole('textbox', { name: 'Device name' }).fill('desk');
  await page.getByRole('textbox', { name: 'Device name' }).press('Enter');
  await expect(page.getByRole('listitem', { name: 'desk' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove desk' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('No device is paired yet.', { exact: false })).toBeVisible();
  expect(sent.map((s) => `${s.method} ${s.path} ${JSON.stringify(s.body)}`)).toEqual([
    'PUT /api/devices/d0123456789abcdef {"name":"desk"}',
    'DELETE /api/devices/d0123456789abcdef null',
  ]);
});

test('the page fits a phone without scrolling sideways', async ({ page }) => {
  await portal(page);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/devices');
  await page.getByRole('button', { name: 'Pair a device' }).click();
  await expect(page.getByTestId('pairing-code')).toBeVisible();
  const overflow = await page.evaluate(() => [...document.querySelectorAll('main *')].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1).map((el) => el.outerHTML.slice(0, 80)));
  expect(overflow).toEqual([]);
});
