import { describe, expect, it } from 'vitest';
import worker, { type Env } from './index.js';

const env: Env = { ALLOWED_ORIGINS: 'https://ok.example' };

describe('auth worker', () => {
  it('serves /health', async () => {
    const res = worker.fetch(new Request('https://w.example/health'), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('reflects only allowed origins', () => {
    const ok = worker.fetch(new Request('https://w.example/health', { headers: { Origin: 'https://ok.example' } }), env);
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('https://ok.example');
    const bad = worker.fetch(new Request('https://w.example/health', { headers: { Origin: 'https://bad.example' } }), env);
    expect(bad.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('refuses preflight from unknown origins', () => {
    const res = worker.fetch(
      new Request('https://w.example/health', { method: 'OPTIONS', headers: { Origin: 'https://bad.example' } }),
      env,
    );
    expect(res.status).toBe(403);
  });
});
