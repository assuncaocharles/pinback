import { expect, test, type Page } from '@playwright/test';
import { CONTEXT_QUERY, CORS, mockGitHub, pinComment } from './fixtures.js';

const TOKEN = 'ghu_E2E_SECRET_TOKEN_do_not_leak';
const AUTH = 'http://localhost:8787';
const widget = 'preview-pins';

/** Records every message the host window receives, so we can prove none carries the token. */
async function recordHostMessages(page: Page) {
  await page.addInitScript(() => {
    const log: string[] = [];
    (window as unknown as { __ppMessages: string[] }).__ppMessages = log;
    window.addEventListener('message', (e) => {
      try {
        log.push(JSON.stringify(e.data));
      } catch {
        log.push(String(e.data));
      }
    }, true);
  });
}

async function signIn(page: Page) {
  const w = page.locator(widget);
  await w.getByRole('button', { name: /Comments,/ }).click();
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    w.getByRole('button', { name: 'Sign in with GitHub' }).click(),
  ]);
  // The callback page posts the sealed blob to us and closes itself.
  await expect(w.locator('#pp-list').getByText('Signed in as octocat')).toBeVisible();
  await expect.poll(() => popup.isClosed()).toBe(true);
}

test.describe('auth and writing (M2)', () => {
  test.beforeEach(async ({ page, context }) => {
    // Route at the context level so the popup and the auth iframe are covered too.
    await context.route('https://api.github.com/user', (route) =>
      route.fulfill({ json: { login: 'octocat', avatar_url: 'https://avatars.githubusercontent.com/u/583231?v=4' }, headers: CORS }),
    );
    await recordHostMessages(page);
  });

  test('the token never reaches the host page', async ({ page }) => {
    const created: { auth: string | undefined; frameUrl: string; body: string }[] = [];
    await mockGitHub(page, []);
    await page.context().route('https://api.github.com/repos/acme/web/issues/12/comments', async (route) => {
      const req = route.request();
      if (req.method() !== 'POST') return route.fallback();
      const { body } = req.postDataJSON() as { body: string };
      created.push({ auth: req.headers().authorization, frameUrl: req.frame().url(), body });
      await route.fulfill({
        status: 201,
        headers: CORS,
        json: { ...pinComment('x', {}), id: 4242, body, body_html: '<p>Bigger please</p>', user: { login: 'octocat', avatar_url: '' } },
      });
    });

    await page.goto(`/${CONTEXT_QUERY}`);
    await signIn(page);

    // Post a pin so the token is definitely in use.
    const w = page.locator(widget);
    await w.getByRole('button', { name: 'Comment', exact: true }).click();
    await page.getByTestId('checkout-button').click();
    await w.getByRole('textbox', { name: 'Comment' }).fill('Bigger please');
    await w.getByRole('button', { name: 'Comment', exact: true }).last().click();
    await expect(w.locator('.pin')).toHaveCount(1);

    // The write carried the token, and it came from the auth frame's origin.
    expect(created).toHaveLength(1);
    expect(created[0]!.auth).toBe(`Bearer ${TOKEN}`);
    expect(created[0]!.frameUrl).toBe(`${AUTH}/frame`);
    expect(created[0]!.body).toContain('<!-- preview-pins:v1 ');

    // Nothing the host page can read contains the token.
    const leaks = await page.evaluate((token) => {
      const host = document.querySelector('preview-pins');
      const haystacks: Record<string, string> = {
        localStorage: JSON.stringify(Object.entries(localStorage)),
        sessionStorage: JSON.stringify(Object.entries(sessionStorage)),
        cookie: document.cookie,
        dom: document.documentElement.outerHTML,
        shadow: host?.shadowRoot?.innerHTML ?? '',
        messages: (window as unknown as { __ppMessages: string[] }).__ppMessages.join('\n'),
        globals: Object.keys(window).join(','),
      };
      return Object.entries(haystacks).filter(([, v]) => v.includes(token)).map(([k]) => k);
    }, TOKEN);
    expect(leaks).toEqual([]);

    // The host page can't reach into the frame's storage...
    const frameAccess = await page.evaluate(() => {
      const iframe = document.querySelector('preview-pins')!.shadowRoot!.querySelector('iframe')!;
      try {
        return String(iframe.contentWindow!.localStorage.length);
      } catch (e) {
        return (e as Error).name;
      }
    });
    expect(frameAccess).toBe('SecurityError');

    // ...and a sealed blob it saw in transit can't be redeemed without the frame's secret.
    const sealed = await page.evaluate(() =>
      (window as unknown as { __ppMessages: string[] }).__ppMessages
        .map((m) => { try { return JSON.parse(m) as { event?: string; blob?: string }; } catch { return {}; } })
        .find((m) => m.event === 'sealed')?.blob ?? null,
    );
    expect(sealed).toBeTruthy();
    const redeemFromHost = await page.evaluate(async ({ auth, blob }) => {
      try {
        const res = await fetch(`${auth}/auth/redeem`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blob, secret: 'guess' }) });
        return `status ${res.status}`;
      } catch (e) {
        return (e as Error).name; // CORS blocks reading the response
      }
    }, { auth: AUTH, blob: sealed });
    expect(redeemFromHost).toBe('TypeError');
  });

  test('replies and resolves with the keyboard', async ({ page }) => {
    const root = pinComment('Root', { anchor: { testId: 'checkout-button' } }, 'octocat');
    await mockGitHub(page, [root]);
    let lastBody = '';
    await page.context().route('https://api.github.com/repos/acme/web/issues/12/comments', async (route) => {
      const req = route.request();
      if (req.method() !== 'POST') return route.fallback();
      lastBody = (req.postDataJSON() as { body: string }).body;
      await route.fulfill({ status: 201, headers: CORS, json: { ...pinComment('r', {}), body: lastBody, body_html: '<p>Done</p>', user: { login: 'octocat', avatar_url: '' } } });
    });
    await page.context().route('https://api.github.com/repos/acme/web', (route) =>
      route.fulfill({ headers: CORS, json: { permissions: { push: false } } }),
    );

    await page.goto(`/${CONTEXT_QUERY}`);
    await signIn(page);
    const w = page.locator(widget);
    await page.keyboard.press('Escape'); // close the list
    const pin = w.locator('.pin');
    await pin.focus();
    await page.keyboard.press('Enter');
    const dialog = w.getByRole('dialog', { name: 'Comment 1' });
    await dialog.getByRole('textbox', { name: 'Reply' }).fill('Done');
    await page.keyboard.press('Control+Enter');
    await expect(dialog).toContainText('Done');
    expect(lastBody).toContain(`"parent":${root.id}`);

    await dialog.getByRole('button', { name: 'Resolve' }).click();
    await expect(dialog).toContainText('Resolved by octocat');
    expect(lastBody).toContain('"state":"resolved"');
    await page.keyboard.press('Escape');
    await expect(pin).toHaveCount(0);
  });

  test('signed-out reviewers see a sign-in prompt instead of a reply box', async ({ page }) => {
    await mockGitHub(page, [pinComment('Root', { anchor: { testId: 'checkout-button' } })]);
    await page.goto(`/${CONTEXT_QUERY}`);
    await page.locator(widget).locator('.pin').click();
    const dialog = page.locator(widget).getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Sign in with GitHub' })).toBeVisible();
  });
});
