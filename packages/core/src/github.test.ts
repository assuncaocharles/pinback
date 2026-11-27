import { describe, expect, it, vi } from 'vitest';
import { BackendError } from './backend.js';
import { GitHubBackend, nextLink } from './github.js';

const ctx = { owner: 'acme', repo: 'web', prNumber: 7, commitSha: 'abc1234' };
const API = 'https://api.test';

function comment(id: number) {
  return {
    id,
    body: `body ${id}`,
    body_html: `<p>body ${id}</p>`,
    html_url: `https://github.com/acme/web/pull/7#issuecomment-${id}`,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    author_association: 'MEMBER',
    user: { login: 'alice', avatar_url: 'https://avatars.test/a' },
  };
}

type Handler = (url: string, init: RequestInit) => Response;

function mockFetch(handler: Handler) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(input instanceof Request ? input.url : input.toString(), init ?? {})),
  );
}

const json = (data: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json', ...headers } });

describe('GitHubBackend', () => {
  it('fetches issue and review comments and maps them', async () => {
    const fetch = mockFetch((url) => (url.includes('/issues/') ? json([comment(1)]) : json([comment(2)])));
    const backend = new GitHubBackend({ apiBase: API, fetch });
    const out = await backend.listComments(ctx);
    expect(out.map((c) => [c.id, c.kind])).toEqual([['1', 'issue'], ['2', 'review']]);
    expect(out[0]!.author).toEqual({ login: 'alice', avatarUrl: 'https://avatars.test/a', association: 'MEMBER' });
    expect(fetch.mock.calls[0]![0]).toBe(`${API}/repos/acme/web/issues/7/comments?per_page=100`);
  });

  it('follows Link rel="next"', async () => {
    const fetch = mockFetch((url) => {
      if (url.includes('/pulls/')) return json([]);
      if (url.includes('page=2')) return json([comment(2)]);
      return json([comment(1)], { Link: `<${API}/repos/acme/web/issues/7/comments?per_page=100&page=2>; rel="next"` });
    });
    const out = await new GitHubBackend({ apiBase: API, fetch }).listComments(ctx);
    expect(out.map((c) => c.id)).toEqual(['1', '2']);
  });

  it('sends If-None-Match and serves 304s from cache', async () => {
    let calls = 0;
    const fetch = mockFetch((_url, init) => {
      calls++;
      const inm = (init.headers as Record<string, string>)['If-None-Match'];
      if (inm === '"v1"') return new Response(null, { status: 304 });
      return json([comment(1)], { ETag: '"v1"' });
    });
    const backend = new GitHubBackend({ apiBase: API, fetch });
    await backend.listComments(ctx);
    const second = await backend.listComments(ctx);
    expect(calls).toBe(4);
    expect(second.map((c) => c.id)).toEqual(['1', '1']);
    expect(fetch.mock.calls[2]![1]).toMatchObject({ cache: 'no-store' });
  });

  it('reports rate limiting with the reset time', async () => {
    const fetch = mockFetch(
      () => new Response('{}', { status: 403, headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': '1800000000' } }),
    );
    const err = await new GitHubBackend({ apiBase: API, fetch }).listComments(ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BackendError);
    expect((err as BackendError).code).toBe('rate-limited');
    expect((err as BackendError).resetAt?.getTime()).toBe(1800000000 * 1000);
  });

  it('maps 404 to not-found', async () => {
    const fetch = mockFetch(() => new Response('{}', { status: 404 }));
    await expect(new GitHubBackend({ apiBase: API, fetch }).listComments(ctx)).rejects.toMatchObject({ code: 'not-found' });
  });

  it('maps fetch failures to network errors', async () => {
    const fetch = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(new GitHubBackend({ apiBase: API, fetch }).listComments(ctx)).rejects.toMatchObject({ code: 'network' });
  });
});

describe('nextLink', () => {
  it('finds rel="next" among others', () => {
    expect(nextLink('<https://a/2>; rel="next", <https://a/9>; rel="last"')).toBe('https://a/2');
    expect(nextLink('<https://a/1>; rel="prev"')).toBeNull();
    expect(nextLink(null)).toBeNull();
  });
});

describe('GitHubBackend (authenticated)', () => {
  it('sends the token and posts comments', async () => {
    const fetch = mockFetch((url, init) => {
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t0k');
      expect(url).toBe(`${API}/repos/acme/web/issues/7/comments`);
      expect(JSON.parse(init.body as string)).toEqual({ body: 'hello' });
      return new Response(JSON.stringify(comment(5)), { status: 201 });
    });
    const backend = new GitHubBackend({ apiBase: API, fetch, token: () => Promise.resolve('t0k') });
    const created = await backend.createComment(ctx, 'hello');
    expect(created.id).toBe('5');
  });

  it('renders markdown in the repo context', async () => {
    const fetch = mockFetch((url, init) => {
      expect(url).toBe(`${API}/markdown`);
      expect(JSON.parse(init.body as string)).toEqual({ text: '#1', mode: 'gfm', context: 'acme/web' });
      return new Response('<p><a>#1</a></p>');
    });
    const html = await new GitHubBackend({ apiBase: API, fetch }).renderMarkdown(ctx, '#1');
    expect(html).toBe('<p><a>#1</a></p>');
  });

  it('maps 401 to unauthenticated', async () => {
    const fetch = mockFetch(() => new Response('{}', { status: 401 }));
    await expect(new GitHubBackend({ apiBase: API, fetch }).getViewer()).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('reads push permission', async () => {
    const fetch = mockFetch(() => json({ permissions: { push: true } }));
    expect(await new GitHubBackend({ apiBase: API, fetch }).canMaintain(ctx)).toBe(true);
  });
});
