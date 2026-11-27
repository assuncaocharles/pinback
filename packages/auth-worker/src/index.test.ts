import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomToken, seal, sha256b64url, unseal } from './crypto.js';
import worker, { type CallbackData, type Env, type FrameConfig, type TokenSet } from './index.js';

const W = 'https://auth.test';
const PREVIEW = 'https://pr-1.demo.pages.dev';
const SESSION_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';

const env: Env = {
  ALLOWED_ORIGINS: 'https://*.demo.pages.dev, http://localhost:4173',
  ALLOWED_REPOS: 'acme/web',
  GITHUB_CLIENT_ID: 'Iv1.client',
  GITHUB_CLIENT_SECRET: 'shh',
  SESSION_KEY,
  GITHUB_OAUTH_BASE: 'https://gh.test',
};

const call = (path: string, init?: RequestInit, e: Env = env) => worker.fetch(new Request(`${W}${path}`, init), e);

function dataOf(html: string): unknown {
  const m = /<script type="application\/json" id="pp-data">([\s\S]*?)<\/script>/.exec(html);
  return JSON.parse(m![1]!);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('auth worker', () => {
  it('serves /health with CORS for allowed origins only', async () => {
    const ok = await call('/health', { headers: { Origin: PREVIEW } });
    expect(await ok.text()).toBe('ok');
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe(PREVIEW);
    const bad = await call('/health', { headers: { Origin: 'https://evil.test' } });
    expect(bad.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect((await call('/health', { method: 'OPTIONS', headers: { Origin: 'https://evil.test' } })).status).toBe(403);
  });

  describe('/frame', () => {
    it('restricts embedding with frame-ancestors and locks down scripts', async () => {
      const res = await call('/frame');
      const csp = res.headers.get('Content-Security-Policy')!;
      expect(csp).toContain('frame-ancestors https://*.demo.pages.dev http://localhost:4173');
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("connect-src 'self' https://api.github.com");
      expect(res.headers.get('Cache-Control')).toBe('no-store');
    });

    it('embeds the config for the client', async () => {
      const config = dataOf(await (await call('/frame')).text()) as FrameConfig;
      expect(config).toEqual({ allowedOrigins: env.ALLOWED_ORIGINS, allowedRepos: ['acme/web'], apiBase: 'https://api.github.com', screenshots: false });
    });

    it("refuses to be framed by anyone when the allowlist is empty", async () => {
      const res = await call('/frame', undefined, { ...env, ALLOWED_ORIGINS: '' });
      expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    });
  });

  describe('/auth/start', () => {
    const challenge = 'a'.repeat(43);

    it('redirects to GitHub with PKCE and sets a __Host- state cookie', async () => {
      const res = await call(`/auth/start?challenge=${challenge}&return=${encodeURIComponent(`${PREVIEW}/checkout`)}`);
      expect(res.status).toBe(302);
      const loc = new URL(res.headers.get('Location')!);
      expect(loc.origin + loc.pathname).toBe('https://gh.test/login/oauth/authorize');
      expect(loc.searchParams.get('client_id')).toBe('Iv1.client');
      expect(loc.searchParams.get('redirect_uri')).toBe(`${W}/auth/callback`);
      expect(loc.searchParams.get('code_challenge_method')).toBe('S256');
      expect(loc.searchParams.get('state')).toBeTruthy();
      const cookie = res.headers.get('Set-Cookie')!;
      expect(cookie).toMatch(/^__Host-pp_oauth=/);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Secure');
    });

    it('rejects return URLs outside the allowlist', async () => {
      const res = await call(`/auth/start?challenge=${challenge}&return=${encodeURIComponent('https://evil.test/')}`);
      expect(res.status).toBe(403);
    });

    it('rejects a malformed challenge', async () => {
      const res = await call(`/auth/start?challenge=short&return=${encodeURIComponent(PREVIEW)}`);
      expect(res.status).toBe(400);
    });
  });

  describe('full sign-in handoff', () => {
    async function signIn(secret: string) {
      const challenge = await sha256b64url(secret);
      const startRes = await call(`/auth/start?challenge=${challenge}&return=${encodeURIComponent(`${PREVIEW}/checkout#x`)}`);
      const cookie = startRes.headers.get('Set-Cookie')!.split(';')[0]!;
      const loc = new URL(startRes.headers.get('Location')!);
      const verifierChallenge = loc.searchParams.get('code_challenge');

      const exchange = vi.fn((_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string) as Record<string, string>;
        expect(body.code).toBe('the-code');
        expect(body.client_secret).toBe('shh');
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: 'ghu_SECRET', refresh_token: 'ghr_R', expires_in: 28800 }), { status: 200 }),
        );
      });
      vi.stubGlobal('fetch', exchange);

      const res = await call(`/auth/callback?code=the-code&state=${loc.searchParams.get('state')!}`, { headers: { Cookie: cookie } });
      const html = await res.text();
      // PKCE: the verifier sent to GitHub hashes to the challenge from /start.
      const body = JSON.parse(exchange.mock.calls[0]![1].body as string) as { code_verifier: string };
      expect(await sha256b64url(body.code_verifier)).toBe(verifierChallenge);
      return { res, html };
    }

    it('never puts the token in the callback page, only a sealed blob', async () => {
      const { res, html } = await signIn(randomToken());
      expect(res.status).toBe(200);
      expect(html).not.toContain('ghu_SECRET');
      const data = (dataOf(html) as CallbackData);
      expect(data.returnOrigin).toBe(PREVIEW);
      expect(data.returnUrl).toBe(`${PREVIEW}/checkout`);
      expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    });

    it('redeems only with the matching frame secret, from the same origin', async () => {
      const secret = randomToken();
      const { html } = await signIn(secret);
      const { blob } = (dataOf(html) as CallbackData);
      const same = { Origin: W, 'Content-Type': 'application/json' };

      const wrong = await call('/auth/redeem', { method: 'POST', headers: same, body: JSON.stringify({ blob, secret: randomToken() }) });
      expect(wrong.status).toBe(403);

      const crossOrigin = await call('/auth/redeem', { method: 'POST', headers: { ...same, Origin: PREVIEW }, body: JSON.stringify({ blob, secret }) });
      expect(crossOrigin.status).toBe(403);

      const ok = await call('/auth/redeem', { method: 'POST', headers: same, body: JSON.stringify({ blob, secret }) });
      expect(ok.status).toBe(200);
      const tokens: TokenSet = await ok.json();
      expect(tokens.accessToken).toBe('ghu_SECRET');
      expect(tokens.refreshToken).toBe('ghr_R');
    });

    it('rejects a callback without the state cookie', async () => {
      const res = await call('/auth/callback?code=x&state=y');
      expect(res.status).toBe(400);
    });
  });

  it('rejects expired and tampered blobs', async () => {
    const secret = randomToken();
    const ch = await sha256b64url(secret);
    const same = { Origin: W, 'Content-Type': 'application/json' };
    const old = await seal(SESSION_KEY, { tokens: { accessToken: 'x' }, ch, iat: Date.now() - 11 * 60 * 1000 });
    expect((await call('/auth/redeem', { method: 'POST', headers: same, body: JSON.stringify({ blob: old, secret }) })).status).toBe(400);
    const fresh = await seal(SESSION_KEY, { tokens: { accessToken: 'x' }, ch, iat: Date.now() });
    const tampered = fresh.slice(0, -2) + (fresh.endsWith('A') ? 'BB' : 'AA');
    expect((await call('/auth/redeem', { method: 'POST', headers: same, body: JSON.stringify({ blob: tampered, secret }) })).status).toBe(400);
  });

  it('refreshes tokens for the frame only', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify({ access_token: 'ghu_NEW', expires_in: 10 }))));
    const body = JSON.stringify({ refreshToken: 'ghr_R' });
    expect((await call('/auth/refresh', { method: 'POST', headers: { Origin: PREVIEW }, body })).status).toBe(403);
    const ok = await call('/auth/refresh', { method: 'POST', headers: { Origin: W }, body });
    expect((await ok.json<TokenSet>()).accessToken).toBe('ghu_NEW');
  });
});

describe('seal/unseal', () => {
  it('round-trips and rejects the wrong key', async () => {
    const blob = await seal(SESSION_KEY, { a: 1 });
    expect(await unseal(SESSION_KEY, blob)).toEqual({ a: 1 });
    expect(await unseal('BAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8', blob)).toBeNull();
  });
});

describe('screenshots (ADR 11)', () => {
  class MemoryBucket {
    store = new Map<string, { body: Uint8Array; contentType: string }>();
    put(key: string, body: Uint8Array, opts: { httpMetadata: { contentType: string } }) {
      this.store.set(key, { body, contentType: opts.httpMetadata.contentType });
      return Promise.resolve({});
    }
    get(key: string) {
      const v = this.store.get(key);
      return Promise.resolve(v ? { body: v.body } : null);
    }
  }
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const withBucket = () => {
    const bucket = new MemoryBucket();
    return { bucket, e: { ...env, SCREENSHOTS: bucket as unknown as R2Bucket } };
  };
  const upload = (e: Env, init: { origin?: string; token?: string | null; type?: string; body?: Uint8Array; repo?: string } = {}) =>
    call(`/screenshots?owner=acme&repo=${init.repo ?? 'web'}`, {
      method: 'POST',
      headers: {
        Origin: init.origin ?? W,
        'Content-Type': init.type ?? 'image/png',
        ...(init.token === null ? {} : { Authorization: `Bearer ${init.token ?? 'ghu_x'}` }),
      },
      body: init.body ?? PNG,
    }, e);

  it('is off without an R2 binding', async () => {
    expect((await upload(env)).status).toBe(501);
  });

  it('stores an image under an unguessable key and serves it locked down', async () => {
    const { bucket, e } = withBucket();
    const gh = vi.fn((u: string, init: RequestInit) => {
      expect(u).toBe('https://api.github.com/repos/acme/web');
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ghu_x');
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    vi.stubGlobal('fetch', gh);
    const res = await upload(e);
    expect(res.status).toBe(201);
    const { url } = await res.json<{ url: string }>();
    expect(url).toMatch(/^https:\/\/auth\.test\/s\/acme\/web\/[A-Za-z0-9_-]{22}\.png$/);
    expect(bucket.store.size).toBe(1);

    const served = await call(new URL(url).pathname, undefined, e);
    expect(served.status).toBe(200);
    expect(served.headers.get('Content-Type')).toBe('image/png');
    expect(served.headers.get('Content-Security-Policy')).toContain('sandbox');
    expect(served.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(PNG);
  });

  it('refuses uploads from other origins, without a token, or for repos the token cannot see', async () => {
    const { e } = withBucket();
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 404 })));
    expect((await upload(e, { origin: PREVIEW })).status).toBe(403);
    expect((await upload(e, { token: null })).status).toBe(401);
    expect((await upload(e)).status).toBe(403);
    expect((await upload(e, { repo: 'not-allowed' })).status).toBe(403);
  });

  it('rejects non-images and oversized bodies', async () => {
    const { e } = withBucket();
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 200 })));
    expect((await upload(e, { type: 'text/html', body: new TextEncoder().encode('<script>') })).status).toBe(415);
    expect((await upload(e, { body: new TextEncoder().encode('<svg onload=alert(1)>') })).status).toBe(415);
    expect((await upload(e, { body: new Uint8Array(2 * 1024 * 1024 + 1).fill(0x89) })).status).toBe(413);
  });

  it('404s on unknown or malformed keys', async () => {
    const { e } = withBucket();
    expect((await call('/s/acme/web/nope.png', undefined, e)).status).toBe(404);
    expect((await call('/s/../../etc/passwd', undefined, e)).status).toBe(404);
  });
});
