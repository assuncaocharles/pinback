import type { BrowserContext, Page, Route } from '@playwright/test';
import { formatCommentBody, type PinMetadata } from '../packages/core/src/index.js';

export const SHA = 'abc1234def5678abc1234def5678abc1234def56';
export const CONTEXT_QUERY = `?pp_owner=acme&pp_repo=web&pp_pr=12&pp_sha=${SHA}`;

let nextId = 1000;

export function pinComment(text: string, meta: Partial<PinMetadata>, login = 'alice', association = 'NONE') {
  const id = nextId++;
  const full: PinMetadata = { anchor: {}, viewport: { w: 1280, h: 720 }, url: '/', sha: 'abc1234', parent: null, ...meta };
  return {
    id,
    body: formatCommentBody({ text, meta: full }),
    body_html: `<p>${text}</p><p><sub>📌 Pinned on <code>${full.url}</code> at abc1234 · pinback</sub></p>`,
    html_url: `https://github.com/acme/web/pull/12#issuecomment-${id}`,
    created_at: new Date(Date.UTC(2026, 10, 1, 12, 0, id % 60)).toISOString(),
    updated_at: new Date(Date.UTC(2026, 10, 1, 12, 0, id % 60)).toISOString(),
    author_association: association,
    user: { login, avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4' },
  };
}

/**
 * Aborts any GitHub API request no other route answers, so tests behave the
 * same offline and in CI (where unmocked calls would reach the real API).
 * Register it before every other route: later routes take precedence.
 */
export async function blockUnmockedGitHub(context: BrowserContext): Promise<void> {
  await context.route('https://api.github.com/**', (route) => route.abort('blockedbyclient'));
}

export interface ApiMock {
  requests: { url: string; ifNoneMatch: string | undefined }[];
}

/** CORS headers a GitHub mock needs, including for authenticated calls from the auth frame. */
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'ETag, Link',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, If-None-Match, X-GitHub-Api-Version',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

/**
 * Serves issue comments from `comments`, review comments as [], with ETags.
 * Routes on the browser context, not the page, so requests from the
 * cross-origin auth frame (which may run out of process) are covered too.
 */
export async function mockGitHub(page: Page, comments: unknown[]): Promise<ApiMock> {
  const mock: ApiMock = { requests: [] };
  const etag = '"fixture-v1"';
  await page.context().route('https://api.github.com/**', async (route: Route) => {
    const req = route.request();
    // GET /repos/{o}/{r}: no push access unless a test says otherwise.
    if (req.method() === 'GET' && /\/repos\/[^/]+\/[^/?]+$/.test(new URL(req.url()).pathname)) {
      await route.fulfill({ headers: CORS, json: { permissions: { push: false } } });
      return;
    }
    // Only the comment list endpoints; let other routes (or tests) handle the rest.
    if (req.method() !== 'OPTIONS' && (req.method() !== 'GET' || !/\/(issues|pulls)\/\d+\/comments/.test(req.url()))) {
      await route.fallback();
      return;
    }
    const ifNoneMatch = req.headers()['if-none-match'];
    mock.requests.push({ url: req.url(), ifNoneMatch });
    const cors = CORS;
    if (req.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    if (ifNoneMatch === etag) {
      await route.fulfill({ status: 304, headers: { ...cors, ETag: etag } });
      return;
    }
    const body = req.url().includes('/issues/') ? comments : [];
    await route.fulfill({ status: 200, headers: { ...cors, ETag: etag }, contentType: 'application/json', body: JSON.stringify(body) });
  });
  // Avatars: avoid real network in tests.
  await page.context().route('https://avatars.githubusercontent.com/**', (route) => route.fulfill({ status: 204 }));
  return mock;
}
