import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { CONTEXT_QUERY, CORS, blockUnmockedGitHub, mockGitHub, pinComment } from './fixtures.js';

/**
 * Definition of done: axe reports zero violations for the widget UI.
 * Every scan is scoped to <preview-pins> (axe pierces its shadow root), so the
 * demo page's own markup doesn't count for or against us.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

async function audit(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).include('preview-pins').withTags(TAGS).analyze();
  const summary = results.violations.map(
    (v) => `${v.id} (${v.impact ?? 'n/a'}): ${v.help}\n${v.nodes.map((n) => `    ${n.target.join(' ')} :: ${n.failureSummary ?? ''}`).join('\n')}`,
  );
  expect(summary, `axe violations in state "${label}"`).toEqual([]);
}

const root = pinComment('Button needs more contrast', { anchor: { testId: 'checkout-button' } }, 'octocat');
const threads = () => [
  root,
  pinComment('Agreed, will fix', { parent: root.id }, 'bob'),
  pinComment('Approximate one', { anchor: { cssPath: '#root > div > button', textQuote: { exact: 'Place your order now', prefix: '', suffix: '' } } }),
  pinComment('Old banner', { anchor: { testId: 'gone' }, sha: 'deadbee' }),
  pinComment('Elsewhere', { url: '/other' }),
  pinComment('Done thing', { anchor: { testId: 'cart-total' } }, 'octocat'),
];

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`widget accessibility (${scheme})`, () => {
    // Reduced motion zeroes the widget's transitions (--pp-duration), so axe
    // measures final colours instead of a frame mid-transition. Without it,
    // CI sampled a hovered button halfway between two backgrounds.
    test.use({ colorScheme: scheme, reducedMotion: 'reduce' });

    test('read-only states', async ({ page, context }) => {
      await blockUnmockedGitHub(context);
      const all = threads();
      const done = all[5]!;
      await mockGitHub(page, [...all, pinComment('', { parent: done.id, state: 'resolved' }, 'octocat')]);
      await page.goto(`/${CONTEXT_QUERY}`);
      const w = page.locator('preview-pins');
      await expect(w.locator('.pin').first()).toBeVisible();
      await audit(page, 'toolbar and pins');

      await w.getByRole('button', { name: /^Comments \d/ }).click();
      await expect(w.getByRole('heading', { name: 'Outdated' })).toBeVisible();
      await audit(page, 'comment list');
      await page.keyboard.press('Escape');

      // Open from the keyboard, as a screen-reader user would.
      await w.getByRole('button', { name: /^Comment 1 by/ }).focus();
      await page.keyboard.press('Enter');
      await expect(w.getByRole('dialog', { name: 'Comment 1' })).toBeVisible();
      await audit(page, 'thread view, signed out');
    });

    test('writing states', async ({ page, context }) => {
      await blockUnmockedGitHub(context);
      await context.route('https://api.github.com/user', (r) =>
        r.fulfill({ headers: CORS, json: { login: 'octocat', avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4' } }),
      );
      await context.route('https://api.github.com/repos/acme/web', (r) => r.fulfill({ headers: CORS, json: { permissions: { push: true } } }));
      await context.route('https://api.github.com/markdown', (r) =>
        r.fulfill({ headers: { ...CORS, 'Content-Type': 'text/html' }, body: '<p><strong>Bold</strong> preview</p>' }),
      );
      await mockGitHub(page, threads().slice(0, 2));
      await page.goto(`/${CONTEXT_QUERY}`);
      const w = page.locator('preview-pins');

      await w.getByRole('button', { name: /^Comments \d/ }).click();
      const [popup] = await Promise.all([page.waitForEvent('popup'), w.getByRole('button', { name: 'Sign in with GitHub' }).click()]);
      await expect(w.locator('#pp-list').getByText('Signed in as octocat')).toBeVisible();
      await expect.poll(() => popup.isClosed()).toBe(true);
      await audit(page, 'comment list, signed in');
      await page.keyboard.press('Escape');

      await w.getByRole('button', { name: /^Comment 1 by/ }).click();
      await expect(w.getByRole('button', { name: 'Resolve' })).toBeVisible();
      await audit(page, 'thread view with reply box');
      await page.keyboard.press('Escape');

      await w.getByRole('button', { name: 'Comment', exact: true }).click();
      await page.getByTestId('cart-total').hover();
      await audit(page, 'comment mode with outline');

      await page.getByTestId('cart-total').click();
      const composer = w.getByRole('dialog', { name: 'New comment' });
      await composer.getByRole('textbox', { name: 'Comment' }).fill('**Bold** preview');
      await audit(page, 'composer, write tab');
      await composer.getByRole('tab', { name: 'Preview' }).click();
      await expect(composer.getByText('preview')).toBeVisible();
      await audit(page, 'composer, preview tab');
    });
  });
}
