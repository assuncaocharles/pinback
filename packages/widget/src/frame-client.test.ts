// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FrameClient, FrameError } from './frame-client.js';

const AUTH = 'https://auth.test';

interface Posted { msg: { id?: number; method?: string; params?: unknown }; origin: string }

function setup() {
  const posted: Posted[] = [];
  const fakeWin = { postMessage: (msg: Posted['msg'], origin: string) => posted.push({ msg, origin }) };
  const onAuthChange = vi.fn();
  const client = new FrameClient(AUTH, { onAuthChange });
  Object.defineProperty(client.iframe, 'contentWindow', { get: () => fakeWin });
  const reply = (data: unknown, opts: { origin?: string; source?: unknown } = {}) => {
    window.dispatchEvent(new MessageEvent('message', { data, origin: opts.origin ?? AUTH, source: (opts.source ?? fakeWin) as MessageEventSource }));
  };
  return { client, posted, fakeWin, reply, onAuthChange };
}

const tick = () => new Promise((r) => setTimeout(r, 10));

describe('FrameClient', () => {
  let client: FrameClient | undefined;
  afterEach(() => {
    client?.destroy();
  });

  it('loads /frame from the auth origin, hidden from assistive tech', () => {
    ({ client } = setup());
    expect(client.iframe.src).toBe(`${AUTH}/frame`);
    expect(client.iframe.getAttribute('aria-hidden')).toBe('true');
    expect(client.iframe.tabIndex).toBe(-1);
  });

  it('handshakes on load and targets the auth origin only', async () => {
    const s = setup();
    client = s.client;
    s.client.iframe.dispatchEvent(new Event('load'));
    expect(s.posted[0]).toMatchObject({ msg: { method: 'hello' }, origin: AUTH });
    s.reply({ pp: 1, id: s.posted[0]!.msg.id, ok: true, result: { viewer: { login: 'a', avatarUrl: '' }, challenge: 'C'.repeat(43) } });
    await s.client.ready();
    expect(s.client.viewer?.login).toBe('a');
    expect(s.client.signInUrl('https://pr.test/x')).toBe(`${AUTH}/auth/start?challenge=${'C'.repeat(43)}&return=https%3A%2F%2Fpr.test%2Fx`);
  });

  it('ignores replies from the wrong origin or window', async () => {
    const s = setup();
    client = s.client;
    s.client.iframe.dispatchEvent(new Event('load'));
    const id = s.posted[0]!.msg.id;
    let settled = false;
    s.client.ready().then(
      () => { settled = true; },
      () => { settled = true; },
    );
    s.reply({ pp: 1, id, ok: true, result: { viewer: null, challenge: 'x' } }, { origin: 'https://evil.test' });
    s.reply({ pp: 1, id, ok: true, result: { viewer: null, challenge: 'x' } }, { source: window });
    await tick();
    expect(settled).toBe(false);
  });

  it('turns error replies into FrameErrors', async () => {
    const s = setup();
    client = s.client;
    s.client.iframe.dispatchEvent(new Event('load'));
    s.reply({ pp: 1, id: s.posted[0]!.msg.id, ok: true, result: { viewer: null, challenge: 'x' } });
    await s.client.ready();
    const p = s.client.call('canMaintain', { ctx: { owner: 'a', repo: 'b', prNumber: 1, commitSha: 'abc1234' } });
    await tick();
    s.reply({ pp: 1, id: s.posted[1]!.msg.id, ok: false, error: { code: 'unauthenticated', message: 'nope' } });
    await expect(p).rejects.toEqual(new FrameError('unauthenticated', 'nope'));
  });

  it('forwards auth-changed events from the frame only', () => {
    const s = setup();
    client = s.client;
    s.reply({ pp: 1, event: 'auth-changed', viewer: { login: 'x', avatarUrl: '' }, challenge: 'c' }, { source: window });
    expect(s.onAuthChange).not.toHaveBeenCalled();
    s.reply({ pp: 1, event: 'auth-changed', viewer: { login: 'x', avatarUrl: '' }, challenge: 'c' });
    expect(s.onAuthChange).toHaveBeenCalledWith({ login: 'x', avatarUrl: '' });
  });

  it('redeems a sealed blob sent by the callback popup (auth origin, other window)', async () => {
    const s = setup();
    client = s.client;
    s.client.iframe.dispatchEvent(new Event('load'));
    s.reply({ pp: 1, id: s.posted[0]!.msg.id, ok: true, result: { viewer: null, challenge: 'x' } });
    await s.client.ready();
    const popup = {};
    s.reply({ pp: 1, event: 'sealed', blob: 'BLOB' }, { source: popup });
    s.reply({ pp: 1, event: 'sealed', blob: 'EVIL' }, { source: popup, origin: 'https://evil.test' });
    await tick();
    const redeems = s.posted.filter((p) => p.msg.method === 'redeem');
    expect(redeems.map((r) => r.msg.params)).toEqual([{ blob: 'BLOB' }]);
  });
});
