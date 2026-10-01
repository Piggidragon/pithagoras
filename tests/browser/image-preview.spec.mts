import { test, expect, type Locator, type Page } from '@playwright/test';
import zlib from 'node:zlib';

/**
 * A picture being made, made and not made (ImagePreview.tsx), in the chat, from
 * web/tests/pictures.tsx.
 */

/** A plain picture of this size, as the chat's folder would serve one. */
function picture(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head[8] = 8;
  head[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 150)]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
}

/** The pictures the folder has, by path, in pixels; `held` keeps every answer back until it is settled. */
const SIZES: Record<string, [number, number]> = {
  'generated-images/lighthouse.png': [192, 128],
  'generated-images/harbour.png': [128, 192],
  'photos/dog.png': [200, 100],
};

async function folder(page: Page, sessionId: string, held?: Promise<void>) {
  await page.route(`**/api/sessions/${sessionId}/picture?**`, async (route) => {
    const size = SIZES[new URL(route.request().url()).searchParams.get('path') ?? ''] ?? SIZES['generated-images/harbour.png'];
    await held;
    await route.fulfill({ body: picture(...size), contentType: 'image/png' });
  });
}

const preview = (page: Page, text: string) => page.locator('.image-preview', { hasText: text });
/** The call under the preview, which is what its Details open. */
const call = (page: Page, of: Locator) => page.locator('.picture-call', { has: of });
const shapeOf = async (frame: Locator) => {
  const box = (await frame.boundingBox())!;
  return box.width / box.height;
};

test.describe('in the chat', () => {
  test.beforeEach(async ({ page }) => {
    await folder(page, 'preview');
  });

  test('a picture being made is a preview in the shape of the coming picture, not a tool card', async ({ page }) => {
    await page.goto('/tests/pictures.html');
    const making = preview(page, 'A foggy harbour');
    await expect(making).toHaveClass(/is-making/);
    await expect(making.getByRole('status')).toContainText('Making a picture');
    // The size the agent asked for, 1024x1536, is the shape of the frame, with nothing there yet.
    expect(await shapeOf(making.locator('.image-preview-frame'))).toBeCloseTo(2 / 3, 1);
    await expect(making.locator('img')).toHaveCount(0);

    // An edit shows the picture it is changing, in that picture's shape.
    const editing = preview(page, 'The dog in the snow');
    await expect(editing.getByRole('status')).toContainText('Editing a picture');
    await expect(editing.locator('.image-preview-before')).toHaveAttribute('src', /photos%2Fdog\.png/);
    await expect.poll(() => shapeOf(editing.locator('.image-preview-frame'))).toBeCloseTo(2, 1);

    // In place of the card, whose call is a click away: its name and what it was given.
    await expect(page.locator('.chat-tool', { hasText: /generate_image|edit_image/ })).toHaveCount(0);
    await making.getByRole('button', { name: 'Details' }).click();
    await expect(call(page, making).locator('.chat-tool-body')).toContainText('generate_image');
    await expect(call(page, making).locator('.chat-tool-body')).toContainText('A foggy harbour at first light');
    await expect(call(page, making).locator('.chat-tool-body')).toContainText('1024x1536');
  });

  test('a picture that is made fills the frame it was given, and is a link to itself', async ({ page }) => {
    let release!: () => void;
    await folder(page, 'preview', new Promise<void>((resolve) => (release = resolve)));
    await page.goto('/tests/pictures.html');
    const done = preview(page, 'A lighthouse at dusk');
    const frame = done.locator('.image-preview-frame');
    await expect(done).toHaveClass(/is-done/);
    // The size that was asked for holds its place while the picture is on its way.
    const before = (await frame.boundingBox())!;
    expect(before.width / before.height).toBeCloseTo(1.5, 1);
    await expect(frame).not.toHaveClass(/is-loaded/);

    release();
    await expect(frame).toHaveClass(/is-loaded/);
    await expect(done.getByRole('img', { name: 'A lighthouse at dusk' })).toBeVisible();
    // Where the guess was right, nothing moved.
    expect(await frame.boundingBox()).toEqual(before);
    await expect(done.getByRole('link')).toHaveAttribute('href', /picture\?path=generated-images%2Flighthouse\.png/);
    // From the history: it is there, it does not arrive.
    await expect(frame).not.toHaveClass(/is-arriving/);
  });

  test('a call that made no picture says so quietly, with the reason, in place of the card', async ({ page }) => {
    await page.goto('/tests/pictures.html');
    const failed = preview(page, 'A cat on a sofa');
    await expect(failed).toHaveClass(/is-failed/);
    await expect(failed.getByRole('status')).toContainText('No picture was made');
    await expect(failed).toContainText('The image endpoint answered 401: the key was refused');
    // A run that ended with the call open never heard of its end.
    const cut = preview(page, 'A castle in the clouds');
    await expect(cut).toHaveClass(/is-failed/);
    await expect(cut).toContainText('Interrupted before the picture arrived');
    await expect(page.locator('.chat-tool', { hasText: /generate_image/ })).toHaveCount(0);

    // What was said is whole under Details.
    await failed.getByRole('button', { name: 'Details' }).click();
    await expect(call(page, failed).locator('pre.chat-tool-output')).toHaveText('The image endpoint answered 401: the key was refused');
  });

  test('the picture arrives in the place of the wait, and nothing under it moves', async ({ page }) => {
    await page.goto('/tests/pictures.html');
    const making = preview(page, 'A foggy harbour');
    await expect(making).toHaveClass(/is-making/);
    await making.evaluate((el) => el.setAttribute('data-first', 'yes'));
    // How far the next thing in the chat is from it: where the chat is scrolled to is not what is asked.
    const next = preview(page, 'The dog in the snow');
    await expect.poll(() => shapeOf(next.locator('.image-preview-frame'))).toBeCloseTo(2, 1);
    const apart = async () => (await next.boundingBox())!.y - (await making.boundingBox())!.y;
    const was = await apart();

    await page.evaluate(() => (window as any).emit('tool_execution_end', (window as any).madePayload('making', 'generated-images/harbour.png', 'A foggy harbour')));
    // The same element, now with its picture, as high as the wait was.
    await expect(making).toHaveClass(/is-done/);
    await expect(making).toHaveAttribute('data-first', 'yes');
    await expect(making.locator('.image-preview-frame')).toHaveClass(/is-loaded/);
    await expect(making.getByRole('img', { name: 'A foggy harbour' })).toBeVisible();
    expect(await apart()).toBeCloseTo(was, 0);
    // The wait is taken away once the picture is there.
    await expect(making.locator('.image-preview-making')).toHaveCount(0);
  });

  test('a picture of another shape than was asked for takes its own shape when it arrives', async ({ page }) => {
    await page.goto('/tests/pictures.html');
    const editing = preview(page, 'The dog in the snow');
    await expect.poll(() => shapeOf(editing.locator('.image-preview-frame'))).toBeCloseTo(2, 1);
    // The result is square, whatever shape the original was.
    await page.route('**/api/sessions/preview/picture?path=generated-images%2Fdog-edited.png**', (route) => route.fulfill({ body: picture(120, 120), contentType: 'image/png' }));
    await page.evaluate(() => (window as any).emit('tool_execution_end', (window as any).madePayload('editing', 'generated-images/dog-edited.png', 'The dog in the snow')));
    await expect(editing.locator('.image-preview-frame')).toHaveClass(/is-loaded/);
    expect(await shapeOf(editing.locator('.image-preview-frame'))).toBeCloseTo(1, 1);
  });

  test('the animation of a picture being made plays only while the animations are on, and the placeholder is the same without it', async ({ page }) => {
    await page.goto('/tests/pictures.html');
    const making = preview(page, 'A foggy harbour');
    await expect(making).toHaveClass(/is-making/);
    const look = () => making.evaluate((el) => {
      const wait = el.querySelector('.image-preview-making')!;
      const frame = el.querySelector('.image-preview-frame')!.getBoundingClientRect();
      return {
        light: getComputedStyle(wait, '::before').animationName,
        sheen: getComputedStyle(wait, '::after').animationName,
        mark: getComputedStyle(wait.querySelector('svg')!).animationName,
        going: el.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length,
        label: (wait.querySelector('span') as HTMLElement).textContent,
        shape: [Math.round(frame.width), Math.round(frame.height)],
      };
    });
    const html = page.locator('html');

    // The tests start with the switch off, as Settings would leave it: a still frame with its words.
    await expect(html).not.toHaveAttribute('data-motion', /.+/);
    const off = await look();
    expect(off).toMatchObject({ light: 'none', sheen: 'none', mark: 'none', going: 0, label: 'Making a picture' });

    // Switched on in this browser while the page is open: the same frame, moving.
    await page.evaluate(() => { localStorage.setItem('animations', 'on'); window.dispatchEvent(new StorageEvent('storage', { key: 'animations' })); });
    await expect(html).toHaveAttribute('data-motion', 'fancy');
    const on = await look();
    expect(on).toMatchObject({ light: 'fx-preview-drift', sheen: 'fx-preview-sheen', mark: 'fx-preview-breathe', label: 'Making a picture', shape: off.shape });
    expect(on.going).toBeGreaterThan(0);

    // The system's own wish for less motion wins over the switch.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(html).not.toHaveAttribute('data-motion', /.+/);
    expect(await look()).toMatchObject({ light: 'none', sheen: 'none', mark: 'none', going: 0, label: 'Making a picture', shape: off.shape });
  });

  test('a picture arrives with a transition only while the animations are on, and only one that was watched being made', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('animations', 'on'));
    await page.goto('/tests/pictures.html');
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'fancy');
    const fade = (frame: Locator) => frame.locator('.image-preview-img').evaluate((img) => getComputedStyle(img).transitionDuration);
    // Out of the history: it is there.
    const old = preview(page, 'A lighthouse at dusk').locator('.image-preview-frame');
    await expect(old).toHaveClass(/is-loaded/);
    expect(await fade(old)).toBe('0s');
    // Made while it was watched: it fades in over the wait.
    const making = preview(page, 'A foggy harbour').locator('.image-preview-frame');
    await expect(making).toHaveClass(/is-arriving/);
    await page.evaluate(() => (window as any).emit('tool_execution_end', (window as any).madePayload('making', 'generated-images/harbour.png', 'A foggy harbour')));
    await expect(making.locator('.image-preview-img')).toHaveCount(1);
    expect(await fade(making)).toBe('0.7s, 0.9s');
    await expect(making).toHaveClass(/is-loaded/);
    // The wait stays under it for the fade, and then goes.
    await expect(making.locator('.image-preview-making')).toHaveCount(0);
  });
});
