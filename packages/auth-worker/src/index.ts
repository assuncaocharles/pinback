import { parseAllowlist } from './origins.js';

export interface Env {
  ALLOWED_ORIGINS: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
}

/**
 * M0 skeleton. Routes:
 *   GET /health  -> 200 "ok"
 * M2 adds /auth/callback (code-for-token exchange) and /frame (the RPC iframe).
 * The worker stores nothing.
 */
export default {
  fetch(request: Request, env: Env): Response {
    const url = new URL(request.url);
    const isAllowed = parseAllowlist(env.ALLOWED_ORIGINS);
    const origin = request.headers.get('Origin');
    const cors: Record<string, string> =
      origin && isAllowed(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : { Vary: 'Origin' };

    if (request.method === 'OPTIONS') {
      if (!origin || !isAllowed(origin)) return new Response(null, { status: 403 });
      return new Response(null, {
        status: 204,
        headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Max-Age': '86400' },
      });
    }

    if (url.pathname === '/health' && request.method === 'GET') {
      return new Response('ok', { headers: { ...cors, 'Content-Type': 'text/plain' } });
    }

    return new Response('Not found', { status: 404, headers: cors });
  },
} satisfies ExportedHandler<Env>;
