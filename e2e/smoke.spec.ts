import { expect, test } from '@playwright/test';
import { mockGitHub } from './fixtures.js';

test.beforeEach(async ({ page }) => {
  await mockGitHub(page, []);
});

const SHA = 'abc1234def5678abc1234def5678abc1234def56';

test('the script tag mounts the widget in a shadow root', async ({ page }) => {
  await page.goto('/');
  const toggle = page.locator('preview-pins').getByRole('button', { name: 'Comment', exact: true });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
});

test('host page styles do not leak into the widget', async ({ page }) => {
  await page.goto('/');
  await page.addStyleTag({ content: 'button { background: rgb(255, 0, 0) !important; font-family: monospace !important; }' });
  const toggle = page.locator('preview-pins').getByRole('button', { name: 'Comment', exact: true });
  const bg = await toggle.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe('rgb(255, 0, 0)');
});

test('PR context resolves from query params', async ({ page }) => {
  await page.goto(`/?pp_owner=acme&pp_repo=web&pp_pr=12&pp_sha=${SHA}`);
  await expect(page.locator('preview-pins').getByText('PR #12')).toBeVisible();
});
