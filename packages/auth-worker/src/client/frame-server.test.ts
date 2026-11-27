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
    config: { allowedOrigins: 'https://*.demo.pages.dev', allowedRepos: opts.allowedRepos ?? [], apiBase: API },
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
