import { expect, test } from '@playwright/test';
import { CONTEXT_QUERY, mockGitHub, pinComment } from './fixtures.js';

const widget = 'preview-pins';

test.describe('read-only pins (M1)', () => {
  test('renders a pin on the anchored element', async ({ page }) => {
    await mockGitHub(page, [
      pinComment('Button needs more contrast', { anchor: { testId: 'checkout-button', rect: { x: 0.5, y: 0.5 } } }),
    ]);
    await page.goto(`/${CONTEXT_QUERY}`);
    const pin = page.locator(widget).getByRole('button', { name: /^Comment 1 by alice/ });
    await expect(pin).toBeVisible();

    const target = await page.getByTestId('checkout-button').boundingBox();
    const marker = await pin.boundingBox();
    // Pin centre sits on the stored relative point (the target's centre).
    expect(Math.abs(marker!.x + marker!.width / 2 - (target!.x + target!.width / 2))).toBeLessThan(2);
    expect(Math.abs(marker!.y + marker!.height / 2 - (target!.y + target!.height / 2))).toBeLessThan(2);

    await expect(page.locator(widget).getByRole('button', { name: /Comments, 1 open/ })).toBeVisible();
  });

  test('pins follow their element on scroll', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 400 });
    await mockGitHub(page, [pinComment('Total looks wrong', { anchor: { testId: 'cart-total' } })]);
    await page.goto(`/${CONTEXT_QUERY}`);
    const pin = page.locator(widget).getByRole('button', { name: /^Comment 1/ });
    await expect(pin).toBeAttached();
    await page.mouse.wheel(0, 150);
    await expect
      .poll(async () => {
        const t = await page.getByTestId('cart-total').boundingBox();
        const p = await pin.boundingBox();
        // Default rect is the target's top-right corner; allow 1px for rounding.
        return t && p ? Math.abs(p.y + p.height / 2 - t.y) <= 1 : false;
      })
      .toBe(true);
  });

  test('keyboard: open a thread, Escape closes it, focus returns to the pin', async ({ page }) => {
    await mockGitHub(page, [
      pinComment('Root comment', { anchor: { testId: 'checkout-button' } }),
    ]);
    await page.goto(`/${CONTEXT_QUERY}`);
    const pin = page.locator(widget).getByRole('button', { name: /^Comment 1/ });
    await pin.focus();
    await page.keyboard.press('Enter');
    const dialog = page.locator(widget).getByRole('dialog', { name: 'Comment 1' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Root comment');
    await expect(dialog).not.toContainText('preview-pins'); // footer stripped
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(pin).toBeFocused();
  });

  test('threads replies and hides resolved pins', async ({ page }) => {
    const root = pinComment('Root', { anchor: { testId: 'checkout-button' } }, 'alice');
    const done = pinComment('Done thing', { anchor: { testId: 'cart-total' } }, 'alice');
    await mockGitHub(page, [
      root,
      pinComment('Reply from bob', { parent: root.id }, 'bob'),
      done,
      pinComment('', { parent: done.id, state: 'resolved' }, 'maint', 'MEMBER'),
    ]);
    await page.goto(`/${CONTEXT_QUERY}`);
    const pins = page.locator(widget).locator('.pin');
    await expect(pins).toHaveCount(1);
    await pins.first().click();
    await expect(page.locator(widget).getByRole('dialog')).toContainText('Reply from bob');
  });

  test('outdated pins appear only in the list, with their SHA', async ({ page }) => {
    await mockGitHub(page, [pinComment('Old element', { anchor: { testId: 'removed-thing' }, sha: 'deadbee' })]);
    await page.goto(`/${CONTEXT_QUERY}`);
    const w = page.locator(widget);
    await w.getByRole('button', { name: /Comments, 1 open/ }).click();
    await expect(w.getByRole('heading', { name: 'Outdated' })).toBeVisible();
    await w.getByRole('button', { name: 'Comment 1: Old element' }).click();
    await expect(w.getByRole('dialog')).toContainText('Outdated · pinned at deadbee');
    await expect(w.locator('.pin:visible')).toHaveCount(0);
  });

  test('re-fetches with If-None-Match and keeps state on 304', async ({ page }) => {
    const mock = await mockGitHub(page, [pinComment('Cached', { anchor: { testId: 'checkout-button' } })]);
    await page.goto(`/${CONTEXT_QUERY}`);
    await expect(page.locator(widget).locator('.pin')).toHaveCount(1);
    await page.locator(widget).evaluate((el: HTMLElement & { refresh(): Promise<void> }) => el.refresh());
    const issueRequests = mock.requests.filter((r) => r.url.includes('/issues/'));
    expect(issueRequests.length).toBeGreaterThanOrEqual(2);
    expect(issueRequests.at(-1)!.ifNoneMatch).toBe('"fixture-v1"');
    await expect(page.locator(widget).locator('.pin')).toHaveCount(1);
  });

  test('comment HTML cannot run script in the host page', async ({ page }) => {
    const evil = pinComment('x', { anchor: { testId: 'checkout-button' } });
    evil.body_html = '<p>hi</p><img src="x" onerror="window.__pwned=1"><script>window.__pwned=1</script>';
    await mockGitHub(page, [evil]);
    await page.goto(`/${CONTEXT_QUERY}`);
    await page.locator(widget).locator('.pin').click();
    await expect(page.locator(widget).getByRole('dialog')).toContainText('hi');
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  });
});
