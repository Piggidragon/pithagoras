import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const sample = readFileSync(new URL('../fixtures/jfk.wav', import.meta.url));
// A 2×2 PNG, as a picture from the phone or the folder would be.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');

test.beforeEach(async ({ page }) => {
  await page.route('**/api/browser', route => route.fulfill({ json: { running: false, sessions: [], install: { container: 'stopped' } } }));
  await page.route('**/api/sessions/test/commands', route => route.fulfill({ json: { commands: [] } }));
  await page.route('**/api/sessions/test/config', route => route.fulfill({ status: 503, json: {} }));
  await page.route('**/api/voice', route => route.fulfill({ json: { enabled: true } }));
  await page.route('**/test-speech.wav', route => route.fulfill({ body: sample, contentType: 'audio/wav' }));
  await page.route('**/voice/speech', route => route.fulfill({ body: sample, contentType: 'audio/wav' }));
  await page.route('**/api/sessions/test/picture?**', route => route.fulfill({ body: png, contentType: 'image/png' }));
  await page.route('**/api/sessions/test/files?**', route => route.fulfill({ json: { path: 'src', entries: [{ name: 'app.ts', type: 'file', size: 3, mtime: 1 }], truncated: false } }));
  await page.route('**/api/sessions/test/file?**', route => route.fulfill({ json: { binary: false, size: 3, mtime: 1, content: 'abc' } }));
});

async function start(page: import('@playwright/test').Page) {
  await page.goto('/tests/voice.html');
  await page.getByRole('button', { name: 'Turn on hands-free voice' }).click();
  await expect(page.getByRole('button', { name: 'End voice mode' })).toBeVisible({ timeout: 25000 });
}

test('a picture goes with what is said next, and the agent can show one back', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', e => failures.push(e.message));
  await page.route('**/voice/transcribe', route => route.fulfill({ json: { text: 'What is in this picture?' } }));
  await start(page);
  await page.locator('.voice-stage input[type=file]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByLabel('Pictures for your next message').getByRole('img', { name: 'photo.png' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Add a picture' })).toContainText('1');
  await page.getByTestId('workspace').screenshot({ path: '/tmp/pithagoras-voice-attached.png' });
  await page.getByRole('button', { name: 'Inject speech' }).click();
  await expect(page.getByTestId('sent')).toHaveText('1', { timeout: 12000 });
  await expect(page.getByTestId('last-send')).toHaveText(JSON.stringify({ message: 'What is in this picture?', images: 1, steer: false }));
  await expect(page.getByLabel('Pictures for your next message')).toBeHidden();

  await page.getByRole('button', { name: 'Show picture' }).click();
  const window = page.getByRole('region', { name: 'Pictures' });
  await expect(window.getByRole('img', { name: 'Sales by month' })).toBeVisible();
  await expect(window).toContainText('Sales by month');
  await page.getByTestId('workspace').screenshot({ path: '/tmp/pithagoras-voice-picture.png' });
  await page.getByRole('button', { name: 'Show picture' }).click();
  await expect(window).toContainText('2 / 2');
  await window.getByRole('button', { name: 'Previous picture' }).click();
  await expect(window).toContainText('1 / 2');
  await window.getByRole('button', { name: 'Minimize pictures' }).click();
  await expect(page.getByRole('button', { name: 'Show pictures' })).toBeVisible();
  expect(failures).toEqual([]);
});

test('tool cards say what came of a call, and open what they are about', async ({ page }) => {
  await start(page);
  // The terminal can be opened before the agent has run anything.
  await page.getByRole('button', { name: 'Show terminal' }).click();
  await expect(page.getByLabel('Agent terminal output')).toContainText('No commands yet');
  await page.getByRole('button', { name: 'Minimize terminal' }).click();
  await page.getByRole('button', { name: 'Start search' }).click();
  const search = page.locator('.voice-tool-float', { hasText: 'Searching for “retry”' });
  await expect(search).toBeVisible();
  // Still there after the old eight seconds would have faded it, counting.
  await page.waitForTimeout(4200);
  await expect(search).toContainText(/\d+ s/);
  await page.getByRole('button', { name: 'Edit file' }).click();
  const edit = page.getByRole('button', { name: /Editing app\.ts/ });
  await expect(edit).toContainText('+2 −1');
  await page.getByTestId('workspace').screenshot({ path: '/tmp/pithagoras-voice-cards.png' });
  await edit.click();
  await expect(page.getByRole('region', { name: 'Files' })).toBeVisible();
  await expect(page.getByLabel('Contents of src/app.ts')).toHaveValue('abc');
});

test('settings, push-to-talk, adding to a running task, the conversation and repeat', async ({ page }) => {
  test.setTimeout(90000);
  // Recognition is asked several times per utterance, so what it hears is set per utterance.
  let heard = 'Also check the tests.';
  await page.route('**/voice/transcribe', route => route.fulfill({ json: { text: heard } }));
  await start(page);

  // Hands-free first: a reply is spoken, and can then be heard again.
  await page.getByRole('button', { name: 'Inject speech' }).click();
  await expect(page.getByTestId('sent')).toHaveText('1', { timeout: 12000 });
  await expect(page.getByRole('button', { name: 'Repeat the last reply' })).toBeEnabled({ timeout: 12000 });
  // "Say that again" is not sent: the page plays the reply once more.
  await page.getByRole('button', { name: 'Finish reply' }).click();
  await expect(page.getByRole('status')).toContainText('Listening', { timeout: 12000 });
  heard = 'Say that again.';
  await page.getByRole('button', { name: 'Inject speech' }).click();
  await expect(page.getByRole('status')).toContainText('Speaking', { timeout: 12000 });
  await expect(page.getByTestId('sent')).toHaveText('1');
  heard = 'Also check the tests.';

  await page.getByRole('button', { name: 'Voice settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Voice settings' });
  await settings.getByRole('group', { name: 'Speaking speed' }).getByRole('button', { name: '1.5×' }).click();
  await settings.getByRole('group', { name: 'Talking while the agent works' }).getByRole('button', { name: 'Adds to the task' }).click();
  await settings.getByRole('group', { name: 'Push to talk' }).getByRole('button', { name: 'On' }).click();
  expect(await page.evaluate(() => [localStorage.getItem('voiceRate'), localStorage.getItem('voiceSteer'), localStorage.getItem('voicePtt')])).toEqual(['1.5', 'on', 'on']);
  await page.getByTestId('workspace').screenshot({ path: '/tmp/pithagoras-voice-settings.png' });
  await page.keyboard.press('Escape');
  // With the canvas open beside the stage, the card is still on top of it.
  await page.getByRole('button', { name: 'Session canvases' }).click();
  await expect(page.getByLabel('Session canvas workspace')).toBeVisible();
  await page.getByRole('button', { name: 'Voice settings' }).click();
  const card = await settings.boundingBox();
  expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.voice-settings'), [card!.x + card!.width / 2, card!.y + 20])).toBe(true);
  await page.getByTestId('workspace').screenshot({ path: '/tmp/pithagoras-voice-settings-canvas.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Close canvas' }).click();
  await expect(settings).toBeHidden();
  await expect(page.getByRole('button', { name: 'Hold to talk' })).toBeVisible();
  // Once the repeated reply (the fixture's long clip) has finished.
  await expect(page.getByRole('status')).toContainText('Hold Space to talk', { timeout: 30000 });

  // Held while the agent works: added to its task, not stopping it.
  await page.getByRole('button', { name: 'Stream reply' }).click();
  await expect(page.getByRole('button', { name: 'Stop the agent' })).toBeVisible();
  await page.keyboard.down('Space');
  await expect(page.getByRole('status')).toContainText('Hearing you');
  await page.getByRole('button', { name: 'Inject speech' }).click();
  await page.waitForTimeout(2800);
  await page.keyboard.up('Space');
  await expect(page.getByTestId('sent')).toHaveText('2', { timeout: 12000 });
  await expect(page.getByTestId('last-send')).toHaveText(JSON.stringify({ message: 'Also check the tests.', images: 0, steer: true }));
  await expect(page.getByTestId('aborted')).toHaveText('0');
  // A tap is not a turn.
  await page.getByRole('button', { name: 'Hold to talk' }).click();
  await page.waitForTimeout(600);
  await expect(page.getByTestId('sent')).toHaveText('2');

  await page.getByRole('button', { name: 'Show the conversation' }).click();
  const conversation = page.getByRole('region', { name: 'Conversation', exact: true });
  await expect(conversation).toContainText('Also check the tests.');
  await expect(conversation).toContainText('Here is the spoken response.');
  // A window beside the orb, not over it or over another window.
  await page.waitForTimeout(800);
  const box = await conversation.boundingBox(), orb = await page.locator('.voice-presence').boundingBox();
  expect(orb!.x + orb!.width <= box!.x || box!.x + box!.width <= orb!.x).toBe(true);
  await page.getByRole('button', { name: 'Show picture' }).click();
  await page.waitForTimeout(800);
  const pictures = await page.getByRole('region', { name: 'Pictures', exact: true }).boundingBox(), beside = await conversation.boundingBox();
  expect(pictures!.x + pictures!.width <= beside!.x || beside!.x + beside!.width <= pictures!.x).toBe(true);
  await page.getByTestId('workspace').screenshot({ path: '/tmp/pithagoras-voice-conversation.png' });
  await conversation.getByRole('button', { name: 'Close the conversation' }).click();
  await page.getByRole('button', { name: 'Stop the agent' }).click();
  await expect(page.getByTestId('aborted')).toHaveText('1');
});
