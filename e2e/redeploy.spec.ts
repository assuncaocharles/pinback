import { expect, test, type Locator } from '@playwright/test';
import { CONTEXT_QUERY, mockGitHub, pinComment } from './fixtures.js';

/**
 * Definition of done: comments survive a redeploy where classes and DOM order
 * changed. Each pin below was "recorded" against an older build of the demo
 * page (different order, class names, text), then loaded on today's build.
 */

async function centreInside(pin: Locator, target: Locator): Promise<boolean> {
  const p = await pin.boundingBox();
  const t = await target.boundingBox();
  if (!p || !t) return false;
  const cx = p.x + p.width / 2;
  const cy = p.y + p.height / 2;
  return cx >= t.x - 1 && cx <= t.x + t.width + 1 && cy >= t.y - 1 && cy <= t.y + t.height + 1;
}

test('pins recorded on an older build land on the right elements', async ({ page }) => {
  await mockGitHub(page, [
    // The mug used to be the first item: its old CSS path now points at the tee.
    pinComment('Price looks wrong', {
      anchor: {
        testId: 'cart-item-mug',
        cssPath: '#root > main > section > ul > li:nth-of-type(1) > span:nth-of-type(2)',
        textQuote: { exact: '$16', prefix: 'Enamel mug', suffix: '' },
        rect: { x: 0.5, y: 0.5 },
      },
    }),
    // The button had a different (generated) class and slightly different text.
    pinComment('Bigger CTA', {
      anchor: {
        testId: 'checkout-button',
        cssPath: '#root > main > section > div.actions > button.btn-legacy',
        textQuote: { exact: 'Place your order', prefix: 'Total $62', suffix: '' },
        rect: { x: 0.5, y: 0.5 },
      },
    }),
    // A promo banner that no longer exists.
    pinComment('Typo in banner', {
      anchor: {
        testId: 'promo-banner',
        cssPath: '#root > main > aside',
        textQuote: { exact: 'Free shipping over $50!', prefix: '', suffix: 'Checkout' },
      },
      sha: 'oldsha1',
    }),
  ]);

  await page.goto(`/${CONTEXT_QUERY}`);
  const w = page.locator('pinback-widget');

  const mugPin = w.getByRole('button', { name: /^Comment 1 by/ });
  const ctaPin = w.getByRole('button', { name: /^Comment 2 by/ });
  await expect(mugPin).toBeVisible();
  await expect(ctaPin).toBeVisible();

  const mugPrice = page.getByTestId('cart-item-mug').locator('span').last();
  await expect.poll(() => centreInside(mugPin, mugPrice)).toBe(true);
  await expect.poll(() => centreInside(ctaPin, page.getByTestId('checkout-button'))).toBe(true);

  // The banner pin is outdated: listed with its original SHA, not drawn.
  await expect(w.locator('.pin')).toHaveCount(3);
  await expect(w.locator('.pin:visible')).toHaveCount(2);
  await w.getByRole('button', { name: /^Comments \d/ }).click();
  await expect(w.getByRole('heading', { name: 'Outdated' })).toBeVisible();
  await expect(w.locator('.panel')).toContainText('pinned at oldsha1');
});
