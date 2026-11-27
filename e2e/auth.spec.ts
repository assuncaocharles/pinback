import { expect, test, type Page } from '@playwright/test';
import { CONTEXT_QUERY, CORS, blockUnmockedGitHub, mockGitHub, pinComment } from './fixtures.js';

const TOKEN = 'ghu_E2E_SECRET_TOKEN_do_not_leak';
const AUTH = 'http://localhost:8787';
const widget = 'pinback-widget';

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
  await w.getByRole('button', { name: /^Comments \d/ }).click();
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    w.getByRole('button', { name: 'Sign in with GitHub' }).click(),
  ]);
  // The callback page posts the sealed blob to us and closes itself.
  await expect(w.locator('#pp-list').getByText('Signed in as octocat')).toBeVisible();
  await expect.poll(() => popup.isClosed()).toBe(true);
}

test.describe('auth and writing (M2)', () => {
  const trace: string[] = [];

  test.afterEach(async ({ page }, info) => {
    // On failure, print what the browser actually did: which GitHub requests ran,
    // from which frame, how they were answered, and the frame's RPC replies.
    if (info.status !== info.expectedStatus) {
      const messages = await page
        .evaluate(() => (window as unknown as { __ppMessages?: string[] }).__ppMessages ?? [])
        .catch(() => []);
      console.log(`--- ${info.title}\n${trace.join('\n')}\n--- host messages\n${messages.join('\n')}`);
    }
    trace.length = 0;
  });

  test.beforeEach(async ({ page, context }) => {
    await blockUnmockedGitHub(context);
    context.on('request', (r) => {
      if (!/github\.com|localhost:8787/.test(r.url())) return;
      const from = r.isNavigationRequest() ? '(navigation)' : r.frame().url();
      trace.push(`REQ ${r.method()} ${r.url()} from=${from}`);
    });
    context.on('response', (r) => {
      if (/github\.com|localhost:8787/.test(r.url())) trace.push(`RES ${r.status()} ${r.request().method()} ${r.url()} fromServiceWorker=${r.fromServiceWorker()}`);
    });
    context.on('requestfailed', (r) => trace.push(`FAIL ${r.method()} ${r.url()} ${r.failure()?.errorText ?? ''}`));
    page.on('console', (m) => trace.push(`CONSOLE ${m.type()} ${m.text()}`));
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
    expect(created[0]!.body).toContain('<!-- pinback:v1 ');

    // Nothing the host page can read contains the token.
    const leaks = await page.evaluate((token) => {
      const host = document.querySelector('pinback-widget');
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
      const iframe = document.querySelector('pinback-widget')!.shadowRoot!.querySelector('iframe')!;
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

  test('a pin on a component in the diff becomes a review comment on its line (M4)', async ({ page }) => {
    await mockGitHub(page, []);
    await page.goto(`/${CONTEXT_QUERY}`);

    // The preview build tags host elements with their source location.
    const src = await page.getByTestId('checkout-button').getAttribute('data-pp-src');
    expect(src).toMatch(/^examples\/react-vite\/src\/App\.tsx:\d+:\d+$/);
    const [path, lineStr] = src!.split(':') as [string, string];
    const line = Number(lineStr);

    const posts: { url: string; body: Record<string, unknown> }[] = [];
    await page.context().route('https://api.github.com/repos/acme/web/pulls/12/files**', (route) =>
      route.fulfill({
        headers: CORS,
        json: [{ filename: path, status: 'modified', patch: `@@ -${line},1 +${line},2 @@\n-old\n+<button>\n+</button>` }],
      }),
    );
    await page.context().route('https://api.github.com/repos/acme/web/pulls/12/comments', async (route) => {
      const req = route.request();
      if (req.method() !== 'POST') return route.fallback();
      const body = req.postDataJSON() as Record<string, unknown>;
      posts.push({ url: req.url(), body });
      await route.fulfill({
        status: 201,
        headers: CORS,
        json: { ...pinComment('x', {}), id: 777, body: body.body, body_html: '<p>On the line</p>', html_url: 'https://github.com/acme/web/pull/12#discussion_r777', user: { login: 'octocat', avatar_url: '' } },
      });
    });

    await signIn(page);
    await page.keyboard.press('Escape');
    const w = page.locator('pinback-widget');
    await w.getByRole('button', { name: 'Comment', exact: true }).click();
    await page.getByTestId('checkout-button').click();
    await w.getByRole('dialog', { name: 'New comment' }).getByRole('textbox', { name: 'Comment' }).fill('On the line');
    await page.keyboard.press('Control+Enter');
    await expect(w.locator('.pin')).toHaveCount(1);

    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toMatchObject({ path, line, side: 'RIGHT', commit_id: 'abc1234def5678abc1234def5678abc1234def56' });
  });

  test('attaches a real screenshot, stored by the worker and embedded in the comment (ADR 11)', async ({ page }) => {
    await mockGitHub(page, []);
    const uploads: { from: string; type: string | undefined }[] = [];
    page.context().on('request', (r) => {
      if (r.url().startsWith(`${AUTH}/screenshots`)) uploads.push({ from: r.frame().url(), type: r.headers()['content-type'] });
    });
    let body = '';
    await page.context().route('https://api.github.com/repos/acme/web/issues/12/comments', async (route) => {
      const req = route.request();
      if (req.method() !== 'POST') return route.fallback();
      body = (req.postDataJSON() as { body: string }).body;
      await route.fulfill({ status: 201, headers: CORS, json: { ...pinComment('x', {}), id: 4343, body, body_html: '<p>With picture</p>', user: { login: 'octocat', avatar_url: '' } } });
    });

    await page.goto(`/${CONTEXT_QUERY}`);
    await signIn(page);
    await page.keyboard.press('Escape');
    const w = page.locator('pinback-widget');
    await w.getByRole('button', { name: 'Comment', exact: true }).click();
    await page.getByTestId('cart-total').click();
    const dialog = w.getByRole('dialog', { name: 'New comment' });
    await dialog.getByRole('textbox', { name: 'Comment' }).fill('With picture');
    await dialog.getByRole('checkbox', { name: 'Attach screenshot' }).check();
    await dialog.getByRole('button', { name: 'Comment', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    // Uploaded by the auth frame, not the host page.
    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.from).toBe(`${AUTH}/frame`);
    const m = /!\[Screenshot of the pinned element\]\((http:\/\/localhost:8787\/s\/acme\/web\/[A-Za-z0-9_-]{22}\.(?:webp|png))\)/.exec(body);
    expect(m, body).not.toBeNull();

    // The stored image is served, as an image, with a locked-down CSP.
    const img = await page.request.get(m![1]!);
    expect(img.status()).toBe(200);
    expect(img.headers()['content-type']).toMatch(/^image\/(webp|png)$/);
    expect(img.headers()['content-security-policy']).toContain('sandbox');
    expect((await img.body()).length).toBeGreaterThan(1000);
  });
});

