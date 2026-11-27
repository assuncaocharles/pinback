// Runs the built auth worker (packages/auth-worker/dist) in Node for e2e
// tests, with a fake GitHub OAuth server under /__mock. The browser-side
// GitHub REST calls are mocked by Playwright routes instead.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '../../packages/auth-worker/dist');
const { default: worker } = await import(join(dist, 'worker/index.js'));

// The worker checks repo access with GitHub before storing a screenshot.
// Answer that server-side call here: our fake token can see acme/web only.
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.startsWith('https://api.github.com/repos/')) {
    const auth = new Headers(init?.headers).get('authorization');
    const ok = auth === `Bearer ${E2E_TOKEN}` && url === 'https://api.github.com/repos/acme/web';
    return Promise.resolve(Response.json({}, { status: ok ? 200 : 404 }));
  }
  return realFetch(input, init);
};

const PORT = Number(process.env.PP_WORKER_PORT ?? 8787);
const ORIGIN = `http://localhost:${PORT}`;
export const E2E_TOKEN = 'ghu_E2E_SECRET_TOKEN_do_not_leak';

/** In-memory stand-in for an R2 bucket (enough for put/get). */
const screenshots = new Map();
const bucket = {
  async put(key, body, opts) {
    screenshots.set(key, { body: new Uint8Array(body), contentType: opts?.httpMetadata?.contentType });
    return {};
  },
  async get(key) {
    const v = screenshots.get(key);
    return v ? { body: v.body } : null;
  },
};

const env = {
  ALLOWED_ORIGINS: 'http://localhost:4173',
  ALLOWED_REPOS: '',
  GITHUB_CLIENT_ID: 'Iv1.e2e',
  GITHUB_CLIENT_SECRET: 'e2e-secret',
  SESSION_KEY: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
  GITHUB_OAUTH_BASE: `${ORIGIN}/__mock`,
  SCREENSHOTS: bucket,
};

async function mock(url, req, body) {
  if (url.pathname === '/__mock/login/oauth/authorize') {
    // Pretend the user approved: bounce straight back with a code.
    const back = new URL(url.searchParams.get('redirect_uri'));
    back.searchParams.set('code', 'e2e-code');
    back.searchParams.set('state', url.searchParams.get('state'));
    return new Response(null, { status: 302, headers: { Location: back.href } });
  }
  if (url.pathname === '/__mock/login/oauth/access_token' && req.method === 'POST') {
    const params = JSON.parse(body.toString());
    if (params.client_secret !== env.GITHUB_CLIENT_SECRET || !params.code_verifier) {
      return Response.json({ error: 'bad_verification_code' });
    }
    return Response.json({ access_token: E2E_TOKEN, expires_in: 28800, refresh_token: 'ghr_E2E', refresh_token_expires_in: 15897600 });
  }
  return new Response('not found', { status: 404 });
}

createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, ORIGIN);

    let response;
    if (url.pathname.startsWith('/__mock/')) {
      response = await mock(url, req, body);
    } else if (url.pathname === '/frame.js' || url.pathname === '/callback.js' || url.pathname.startsWith('/chunks/')) {
      response = new Response(await readFile(join(dist, 'public', url.pathname)), {
        headers: { 'Content-Type': 'text/javascript' },
      });
    } else {
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
      response = await worker.fetch(
        new Request(url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }),
        env,
      );
    }

    const out = {};
    response.headers.forEach((v, k) => {
      if (k !== 'set-cookie') out[k] = v;
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) out['set-cookie'] = cookies;
    res.writeHead(response.status, out);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    console.error(err);
    res.writeHead(500).end('harness error');
  }
}).listen(PORT, () => console.log(`auth worker harness on ${ORIGIN}`));
