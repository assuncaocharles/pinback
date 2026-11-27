// Records the frames for docs/public/demo.gif. Skipped unless RECORD_DEMO=1;
// run `pnpm demo:record` (needs ffmpeg) to regenerate the GIF.
import { mkdirSync, writeFileSync } from 'node:fs';
import { test, type Page } from '@playwright/test';
import { CONTEXT_QUERY, CORS, mockGitHub, pinComment } from './fixtures.js';

const OUT = 'test-results/demo';

test.use({
  viewport: { width: 960, height: 600 },
  colorScheme: 'light',
});

async function glide(page: Page, x: number, y: number, steps = 18) {
  await page.mouse.move(x, y, { steps });
}

test('demo', async ({ page, context }) => {
  test.skip(!process.env.RECORD_DEMO, 'Set RECORD_DEMO=1 (pnpm demo:record) to record the docs GIF.');
  test.setTimeout(120_000);
  // A visible cursor (headless video has none).
  await page.addInitScript(() => {
    window.addEventListener('DOMContentLoaded', () => {
      const c = document.createElement('div');
      c.style.cssText =
        'position:fixed;left:0;top:0;width:18px;height:18px;border-radius:50%;background:rgba(20,20,20,.55);border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);pointer-events:none;z-index:2147483647;transform:translate(-50%,-50%);transition:transform .08s';
      document.body.append(c);
      document.addEventListener('pointermove', (e) => { c.style.left = `${e.clientX}px`; c.style.top = `${e.clientY}px`; }, true);
      document.addEventListener('pointerdown', () => { c.style.transform = 'translate(-50%,-50%) scale(.7)'; }, true);
      document.addEventListener('pointerup', () => { c.style.transform = 'translate(-50%,-50%)'; }, true);
    });
  });
  await context.route('https://api.github.com/user', (r) => r.fulfill({ headers: CORS, json: { login: 'octocat', avatar_url: 'https://avatars.githubusercontent.com/u/583231?v=4' } }));
  await context.route('https://api.github.com/repos/acme/web', (r) => r.fulfill({ headers: CORS, json: { permissions: { push: true } } }));
  const carol = pinComment('Total should include tax', { anchor: { testId: 'cart-total' } }, 'carol');
  await mockGitHub(page, [carol]);
  await context.route('https://api.github.com/repos/acme/web/issues/12/comments', async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.fallback();
    const { body } = req.postDataJSON() as { body: string };
    const text = body.split('\n')[0] ?? '';
    await route.fulfill({ status: 201, headers: CORS, json: { ...pinComment('x', {}), id: 9001, body, body_html: `<p>${text}</p>`, user: { login: 'octocat', avatar_url: '' } } });
  });

  await page.goto(`/${CONTEXT_QUERY}`);
  const w = page.locator('pinback-widget');
  // Sign in first; the recording is trimmed to start after this.
  await w.getByRole('button', { name: /^Comments \d/ }).click();
  const [popup] = await Promise.all([page.waitForEvent('popup'), w.getByRole('button', { name: 'Sign in with GitHub' }).click()]);
  await w.locator('#pp-list').getByText('Signed in as octocat').waitFor();
  for (let i = 0; i < 50 && !popup.isClosed(); i++) await page.waitForTimeout(100);
  await page.keyboard.press('Escape');
  await page.mouse.move(480, 300);
  await page.waitForTimeout(300);
  // Record via Chrome's screencast (frames + timestamps).
  const dir = `${OUT}/frames`;
  mkdirSync(dir, { recursive: true });
  const cdp = await context.newCDPSession(page);
  const frames: { file: string; t: number }[] = [];
  cdp.on('Page.screencastFrame', (f) => {
    const file = `${process.cwd()}/${dir}/f${String(frames.length).padStart(5, '0')}.png`;
    writeFileSync(file, Buffer.from(f.data, 'base64'));
    frames.push({ file, t: f.metadata.timestamp ?? Date.now() / 1000 });
    void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId });
  });
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: 960, maxHeight: 600 });

  await page.waitForTimeout(900);
  const toggle = await w.getByRole('button', { name: 'Comment', exact: true }).boundingBox();
  await glide(page, toggle!.x + toggle!.width / 2, toggle!.y + toggle!.height / 2, 25);
  await page.waitForTimeout(300);
  await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(500);

  // Hover across the page, then onto the checkout button.
  const mug = await page.getByTestId('cart-item-mug').boundingBox();
  await glide(page, mug!.x + 60, mug!.y + mug!.height / 2, 20);
  await page.waitForTimeout(400);
  const btn = await page.getByTestId('checkout-button').boundingBox();
  await glide(page, btn!.x + btn!.width * 0.7, btn!.y + btn!.height / 2, 20);
  await page.waitForTimeout(600);
  await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(500);

  const box = w.getByRole('dialog', { name: 'New comment' }).getByRole('textbox', { name: 'Comment' });
  await box.pressSequentially('The CTA blends into the card. Can we bump the contrast?', { delay: 45 });
  await page.waitForTimeout(500);
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(1400);

  // Open the new pin's thread.
  const pin = w.locator('.pin').filter({ hasText: '2' });
  const p = await pin.boundingBox();
  await glide(page, p!.x + p!.width / 2, p!.y + p!.height / 2, 20);
  await page.waitForTimeout(300);
  await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(2200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // The list shows both comments.
  const list = await w.getByRole('button', { name: /^Comments \d/ }).boundingBox();
  await glide(page, list!.x + list!.width / 2, list!.y + list!.height / 2, 20);
  await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(2200);
  await cdp.send('Page.stopScreencast');
  // ffmpeg concat list with per-frame durations.
  const lines: string[] = [];
  frames.forEach((f, i) => {
    const next = frames[i + 1];
    lines.push(`file '${f.file}'`, `duration ${next ? Math.max(0.01, next.t - f.t).toFixed(3) : '1.5'}`);
  });
  const last = frames.at(-1);
  if (last) lines.push(`file '${last.file}'`);
  writeFileSync(`${OUT}/frames.txt`, lines.join('\n'));
  console.log('FRAMES', frames.length);
});
