// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { decodeMetadata, type PinMetadata, type RpcEvent, type RpcResponse } from '@preview-pins/core';
import { sha256b64url } from '../crypto.js';
import { FrameServer, type FrameDeps } from './frame-server.js';

const HOST = 'https://pr-1.demo.pages.dev';
const W = 'https://auth.test';
const API = 'https://api.test';
const TOKEN = 'ghu_TOPSECRET';
const ctx = { owner: 'acme', repo: 'web', prNumber: 3, commitSha: 'abc1234' };
const meta: PinMetadata = { anchor: { testId: 'x' }, viewport: { w: 1, h: 1 }, url: '/', sha: 'abc1234', parent: null };

class MemoryStorage {
  map = new Map<string, string>();
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
}

function setup(opts: { fetch?: FrameDeps['fetch']; allowedRepos?: string[]; signedIn?: Partial<{ expiresAt: number; refreshToken: string }>; now?: number } = {}) {
  const parent = {} as MessageEventSource;
  const posted: { msg: RpcResponse | RpcEvent; origin: string }[] = [];
  const storage = new MemoryStorage();
  if (opts.signedIn) {
    storage.setItem('pp:auth', JSON.stringify({ tokens: { accessToken: TOKEN, ...opts.signedIn }, viewer: { login: 'alice', avatarUrl: '' } }));
  }
  const fetch = vi.fn(opts.fetch ?? (() => Promise.resolve(new Response('[]'))));
  const server = new FrameServer({
    config: { allowedOrigins: 'https://*.demo.pages.dev', allowedRepos: opts.allowedRepos ?? [], apiBase: API, screenshots: true },
    storage,
    fetch,
    workerOrigin: W,
    parent,
    post: (msg, origin) => posted.push({ msg, origin }),
    now: () => opts.now ?? Date.now(),
  });
  let id = 0;
  const send = async (method: string, params: object = {}, origin = HOST, source: MessageEventSource = parent) => {
    const myId = ++id;
    server.handle(new MessageEvent('message', { data: { pp: 1, id: myId, method, params }, origin, source }));
    await vi.waitFor(() => {
      if (!posted.some((p) => 'id' in p.msg && p.msg.id === myId)) throw new Error('no reply');
    });
    return posted.find((p) => 'id' in p.msg && p.msg.id === myId)!;
  };
  return { server, posted, storage, fetch, send, parent };
}

const result = <T>(p: { msg: RpcResponse | RpcEvent }) => {
  const m = p.msg as RpcResponse;
  if (!m.ok) throw new Error(`${m.error.code}: ${m.error.message}`);
  return m.result as T;
};

const tick = () => new Promise((r) => setTimeout(r, 20));

describe('FrameServer', () => {
  it('answers hello with a challenge derived from its secret and pins the origin', async () => {
    const { send, storage, server } = setup();
    const reply = await send('hello');
    const { challenge, viewer } = result<{ challenge: string; viewer: unknown }>(reply);
    expect(viewer).toBeNull();
    expect(challenge).toBe(await sha256b64url(storage.getItem('pp:secret')!));
    expect(reply.origin).toBe(HOST);
    expect(server.parentOrigin).toBe(HOST);
  });

  it('ignores messages from other windows, disallowed origins, and before hello', async () => {
    const { server, posted, parent } = setup();
    const msg = (origin: string, source: MessageEventSource, method = 'listComments') =>
      new MessageEvent('message', { data: { pp: 1, id: 1, method, params: { ctx } }, origin, source });
    server.handle(msg(HOST, {} as MessageEventSource, 'hello')); // not the parent
    server.handle(msg('https://evil.test', parent, 'hello')); // not allowed
    server.handle(msg(HOST, parent)); // no hello yet
    await tick();
    expect(posted).toEqual([]);
  });

  it('ignores a different allowed origin once pinned', async () => {
    const { send, server, posted, parent } = setup();
    await send('hello');
    const before = posted.length;
    server.handle(new MessageEvent('message', { data: { pp: 1, id: 99, method: 'hello', params: {} }, origin: 'https://pr-2.demo.pages.dev', source: parent }));
    await tick();
    expect(posted.length).toBe(before);
  });

  it('requires sign-in for writes', async () => {
    const { send } = setup();
    await send('hello');
    const reply = await send('createComment', { ctx, text: 'hi', meta });
    expect(reply.msg).toMatchObject({ ok: false, error: { code: 'unauthenticated' } });
  });

  it('builds the comment body itself and sends the token only to GitHub', async () => {
    const { send, fetch } = setup({
      signedIn: {},
      fetch: (_url, init) => {
        const body = (JSON.parse(init!.body as string) as { body: string }).body;
        return Promise.resolve(new Response(JSON.stringify({ id: 9, body, body_html: '', html_url: 'u', created_at: 'x', updated_at: 'x', user: { login: 'alice', avatar_url: '' } }), { status: 201 }));
      },
    });
    await send('hello');
    const created = result<{ id: string; body: string }>(await send('createComment', { ctx, text: 'Looks off', meta, previewUrl: `${HOST}/` }));
    expect(created.id).toBe('9');
    expect(decodeMetadata(created.body)).toEqual(meta);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`${API}/repos/acme/web/issues/3/comments`);
    expect((init!.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('rejects invalid metadata and disallowed repos', async () => {
    const { send } = setup({ signedIn: {}, allowedRepos: ['acme/web'] });
    await send('hello');
    expect((await send('createComment', { ctx, text: 'x', meta: { url: 'nope' } })).msg).toMatchObject({ ok: false, error: { code: 'invalid' } });
    expect((await send('createComment', { ctx: { ...ctx, repo: 'other' }, text: 'x', meta })).msg).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('redeems a blob with its secret, rotates the secret, and never posts the token', async () => {
    const { send, storage, posted } = setup({
      fetch: (url, init) => {
        if (String(url) === `${W}/auth/redeem`) {
          const { secret } = JSON.parse(init!.body as string) as { secret: string };
          expect(secret).toBe(storage.getItem('pp:secret'));
          return Promise.resolve(new Response(JSON.stringify({ accessToken: TOKEN })));
        }
        return Promise.resolve(new Response(JSON.stringify({ login: 'alice', avatar_url: 'a' })));
      },
    });
    const { challenge } = result<{ challenge: string }>(await send('hello'));
    const reply = await send('redeem', { blob: 'sealed' });
    expect(result<{ viewer: { login: string } }>(reply).viewer.login).toBe('alice');
    const event = posted.find((p) => 'event' in p.msg)!.msg as RpcEvent;
    expect(event.viewer?.login).toBe('alice');
    expect(event.challenge).not.toBe(challenge);
    expect(JSON.stringify(posted)).not.toContain(TOKEN);
  });

  it('refreshes an expiring token through the worker', async () => {
    const now = 1_000_000;
    const { send, fetch, storage } = setup({
      now,
      signedIn: { expiresAt: now + 1000, refreshToken: 'ghr_R' },
      fetch: (url) =>
        String(url) === `${W}/auth/refresh`
          ? Promise.resolve(new Response(JSON.stringify({ accessToken: 'ghu_NEW', expiresAt: now + 3_600_000 })))
          : Promise.resolve(new Response('[]')),
    });
    await send('hello');
    await send('listComments', { ctx });
    expect(fetch.mock.calls[0]![0]).toBe(`${W}/auth/refresh`);
    const listCall = fetch.mock.calls.find((c) => String(c[0]).includes('/issues/'))!;
    expect((listCall[1]!.headers as Record<string, string>).Authorization).toBe('Bearer ghu_NEW');
    expect(storage.getItem('pp:auth')).toContain('ghu_NEW');
  });

  it('signs out when GitHub rejects the token', async () => {
    const { send, storage, posted } = setup({ signedIn: {}, fetch: () => Promise.resolve(new Response('{}', { status: 401 })) });
    await send('hello');
    await send('canMaintain', { ctx });
    expect(storage.getItem('pp:auth')).toBeNull();
    expect(posted.some((p) => 'event' in p.msg && p.msg.viewer === null)).toBe(true);
  });
});

describe('FrameServer state events', () => {
  it('allows an empty body only for resolve/reopen replies', async () => {
    const { send } = setup({
      signedIn: {},
      fetch: (_u, init) => {
        const body = (JSON.parse(init!.body as string) as { body: string }).body;
        return Promise.resolve(new Response(JSON.stringify({ id: 2, body, html_url: 'u', created_at: 'x', updated_at: 'x', user: null }), { status: 201 }));
      },
    });
    await send('hello');
    const ok = await send('createComment', { ctx, text: '', meta: { ...meta, parent: 1, state: 'resolved' } });
    expect(result<{ body: string }>(ok).body).toContain('✅ Resolved via preview-pins');
    const bad = await send('createComment', { ctx, text: '  ', meta: { ...meta, parent: 1 } });
    expect(bad.msg).toMatchObject({ ok: false, error: { code: 'invalid' } });
  });
});

describe('FrameServer source-line comments (M4)', () => {
  const SHA40 = 'a'.repeat(40);
  const fullCtx = { ...ctx, commitSha: SHA40 };
  const patch = '@@ -1,3 +1,4 @@\n <main>\n+  <h1>Title</h1>\n   <p>x</p>\n </main>';
  const files = [{ filename: 'src/App.tsx', status: 'modified', patch }];
  const sourced = (source: string): PinMetadata => ({ ...meta, anchor: { ...meta.anchor, source } });
  const echo = (id: number, init: RequestInit, extra: object = {}) => {
    const body = (JSON.parse(init.body as string) as { body: string }).body;
    return new Response(JSON.stringify({ id, body, html_url: 'u', created_at: 'x', updated_at: 'x', user: null, ...extra }), { status: 201 });
  };

  function routes(handlers: Record<string, (init: RequestInit) => Response>) {
    return (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      for (const [pattern, h] of Object.entries(handlers)) if (u.includes(pattern)) return Promise.resolve(h(init ?? {}));
      return Promise.resolve(new Response('not mocked', { status: 500 }));
    };
  }

  it('posts a review comment on the exact line when it is in the diff', async () => {
    const { send, fetch } = setup({
      signedIn: {},
      fetch: routes({
        '/pulls/3/files': () => new Response(JSON.stringify(files)),
        '/pulls/3/comments': (init) => echo(10, init),
      }),
    });
    await send('hello');
    const created = result<{ kind: string; body: string }>(await send('createComment', { ctx: fullCtx, text: 'Title too big', meta: sourced('src/App.tsx:2:3') }));
    expect(created.kind).toBe('review');
    const post = fetch.mock.calls.find((c) => String(c[0]).endsWith('/pulls/3/comments'))!;
    expect(JSON.parse(post[1]!.body as string)).toMatchObject({ commit_id: SHA40, path: 'src/App.tsx', line: 2, side: 'RIGHT' });
    expect(created.body).not.toContain('element at');
  });

  it('uses the nearest hunk line and notes where the element really is', async () => {
    const { send, fetch } = setup({
      signedIn: {},
      fetch: routes({
        '/pulls/3/files': () => new Response(JSON.stringify(files)),
        '/pulls/3/comments': (init) => echo(11, init),
      }),
    });
    await send('hello');
    const created = result<{ body: string }>(await send('createComment', { ctx: fullCtx, text: 'x', meta: sourced('src/App.tsx:9:1') }));
    const post = fetch.mock.calls.find((c) => String(c[0]).endsWith('/pulls/3/comments'))!;
    expect(JSON.parse(post[1]!.body as string)).toMatchObject({ line: 4 });
    expect(created.body).toContain('element at `src/App.tsx:9`');
  });

  it('falls back to a plain PR comment when the file is not in the diff', async () => {
    const { send, fetch } = setup({
      signedIn: {},
      fetch: routes({
        '/pulls/3/files': () => new Response(JSON.stringify(files)),
        '/issues/3/comments': (init) => echo(12, init),
      }),
    });
    await send('hello');
    const created = result<{ kind: string }>(await send('createComment', { ctx: fullCtx, text: 'x', meta: sourced('src/Other.tsx:1:1') }));
    expect(created.kind).toBe('issue');
    expect(fetch.mock.calls.some((c) => String(c[0]).endsWith('/pulls/3/comments'))).toBe(false);
  });

  it('falls back to a plain PR comment when GitHub rejects the review comment', async () => {
    const { send } = setup({
      signedIn: {},
      fetch: routes({
        '/pulls/3/files': () => new Response(JSON.stringify(files)),
        '/pulls/3/comments': () => new Response('{"message":"line must be part of the diff"}', { status: 422 }),
        '/issues/3/comments': (init) => echo(13, init),
      }),
    });
    await send('hello');
    const created = result<{ kind: string }>(await send('createComment', { ctx: fullCtx, text: 'x', meta: sourced('src/App.tsx:2:3') }));
    expect(created.kind).toBe('issue');
  });

  it('never tries a review comment without the full commit SHA', async () => {
    const { send, fetch } = setup({ signedIn: {}, fetch: routes({ '/issues/3/comments': (init) => echo(14, init) }) });
    await send('hello');
    await send('createComment', { ctx, text: 'x', meta: sourced('src/App.tsx:2:3') });
    expect(fetch.mock.calls.some((c) => String(c[0]).includes('/pulls/'))).toBe(false);
  });

  it('replies inside review threads and mirrors resolve onto GitHub', async () => {
    const graphql: string[] = [];
    const { send, fetch } = setup({
      signedIn: {},
      fetch: routes({
        '/pulls/3/comments/10/replies': (init) => echo(15, init, { in_reply_to_id: 10 }),
        '/graphql': (init) => {
          const { query } = JSON.parse(init.body as string) as { query: string };
          graphql.push(query);
          return new Response(
            JSON.stringify(
              query.startsWith('query')
                ? { data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: 'T1', isResolved: false, comments: { nodes: [{ databaseId: 10 }] } }] } } } } }
                : { data: { resolveReviewThread: { thread: { id: 'T1' } } } },
            ),
          );
        },
      }),
    });
    await send('hello');
    const reply = result<{ kind: string; inReplyTo: string }>(
      await send('createComment', { ctx, text: '', meta: { ...meta, parent: 10, state: 'resolved' }, parentKind: 'review' }),
    );
    expect(reply).toMatchObject({ kind: 'review', inReplyTo: '10' });
    expect(fetch.mock.calls.some((c) => String(c[0]).includes('/issues/'))).toBe(false);
    expect(graphql.some((q) => q.includes('resolveReviewThread'))).toBe(true);
  });

  it("adds GitHub's resolved state to review comments when signed in", async () => {
    const reviewComment = { id: 10, body: 'b', body_html: '', html_url: 'u', created_at: 'x', updated_at: 'x', user: null };
    const { send } = setup({
      signedIn: {},
      fetch: routes({
        '/issues/3/comments': () => new Response('[]'),
        '/pulls/3/comments': () => new Response(JSON.stringify([reviewComment])),
        '/graphql': () =>
          new Response(JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: 'T1', isResolved: true, comments: { nodes: [{ databaseId: 10 }] } }] } } } } })),
      }),
    });
    await send('hello');
    const list = result<{ id: string; threadResolved?: boolean }[]>(await send('listComments', { ctx }));
    expect(list).toEqual([expect.objectContaining({ id: '10', threadResolved: true })]);
  });
});

describe('FrameServer screenshots (ADR 11)', () => {
  it('advertises the feature in hello', async () => {
    const { send } = setup();
    expect(result<{ features: { screenshots: boolean } }>(await send('hello')).features).toEqual({ screenshots: true });
  });

  it('uploads with the token to the worker and returns the URL', async () => {
    const { send, fetch } = setup({
      signedIn: {},
      fetch: (url, init) => {
        expect(String(url)).toBe(`${W}/screenshots?owner=acme&repo=web`);
        expect((init!.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
        return Promise.resolve(new Response(JSON.stringify({ url: `${W}/s/acme/web/${'a'.repeat(22)}.png` }), { status: 201 }));
      },
    });
    await send('hello');
    const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
    const reply = await send('uploadScreenshot', { ctx, data, type: 'image/png' });
    expect(result<{ url: string }>(reply).url).toContain('/s/acme/web/');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects other types and oversized images before uploading', async () => {
    const { send, fetch } = setup({ signedIn: {} });
    await send('hello');
    expect((await send('uploadScreenshot', { ctx, data: new ArrayBuffer(4), type: 'image/svg+xml' })).msg).toMatchObject({ ok: false, error: { code: 'invalid' } });
    expect((await send('uploadScreenshot', { ctx, data: new ArrayBuffer(3 * 1024 * 1024), type: 'image/png' })).msg).toMatchObject({ ok: false, error: { code: 'invalid' } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('embeds only screenshots hosted by this worker', async () => {
    const { send } = setup({
      signedIn: {},
      fetch: (_u, init) => {
        const body = (JSON.parse(init!.body as string) as { body: string }).body;
        return Promise.resolve(new Response(JSON.stringify({ id: 3, body, html_url: 'u', created_at: 'x', updated_at: 'x', user: null }), { status: 201 }));
      },
    });
    await send('hello');
    const good = `${W}/s/acme/web/${'b'.repeat(22)}.png`;
    const ok = await send('createComment', { ctx, text: 'Look', meta, screenshotUrl: good });
    expect(result<{ body: string }>(ok).body).toContain(`![Screenshot of the pinned element](${good})`);
    const bad = await send('createComment', { ctx, text: 'Look', meta, screenshotUrl: 'https://evil.test/x.png' });
    expect(bad.msg).toMatchObject({ ok: false, error: { code: 'invalid' } });
  });
});
