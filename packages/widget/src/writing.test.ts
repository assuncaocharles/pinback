// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeMetadata, type Backend, type RawComment, type RpcMethod, type RpcMethods, type Viewer } from '@preview-pins/core';
import { rawPin } from '@preview-pins/core/testing';
import { setCaptureLoader } from './capture-loader.js';
import { setAuthFrameFactory, type AuthFrame, type FrameClientEvents } from './frame-client.js';
import { PreviewPinsElement, TAG_NAME } from './index.js';

const SHA = 'abc1234def5678abc1234def5678abc1234def56';
const CTX = { owner: 'acme', repo: 'web', prNumber: 5, commitSha: SHA };
const AUTH = 'https://auth.test';
const ALICE: Viewer = { login: 'alice', avatarUrl: '' };

class FakeFrame implements AuthFrame {
  readonly iframe = document.createElement('span');
  viewer: Viewer | null;
  calls: { method: RpcMethod; params: unknown }[] = [];
  redeemed: string[] = [];
  nextId = 100;
  features = { screenshots: false };
  constructor(readonly origin: string, readonly events: FrameClientEvents, viewer: Viewer | null) {
    this.viewer = viewer;
  }
  ready() { return Promise.resolve(); }
  signInUrl(ret: string) { return `${this.origin}/auth/start?challenge=c&return=${encodeURIComponent(ret)}`; }
  call<M extends RpcMethod>(method: M, params: RpcMethods[M][0]): Promise<RpcMethods[M][1]> {
    this.calls.push({ method, params });
    if (method === 'createComment') {
      const p = params as RpcMethods['createComment'][0];
      const raw = rawPin(this.nextId++, p.text || 'x', p.meta, { login: this.viewer?.login ?? 'x' });
      return Promise.resolve(raw as RpcMethods[M][1]);
    }
    if (method === 'listComments') return Promise.resolve([] as RpcMethods[M][1]);
    if (method === 'canMaintain') return Promise.resolve(false as RpcMethods[M][1]);
    if (method === 'renderMarkdown') return Promise.resolve('<p><strong>bold</strong></p>' as RpcMethods[M][1]);
    if (method === 'uploadScreenshot') return Promise.resolve({ url: `${this.origin}/s/acme/web/${'x'.repeat(22)}.png` } as RpcMethods[M][1]);
    return Promise.resolve(null as RpcMethods[M][1]);
  }
  redeem(blob: string) {
    this.redeemed.push(blob);
    this.viewer = ALICE;
    this.events.onAuthChange(ALICE);
    return Promise.resolve(ALICE);
  }
  destroy() {}
}

const PAGE = `<main id="app"><h1>Checkout</h1><button data-testid="checkout">Place order</button></main>`;
const flush = () => new Promise((r) => setTimeout(r, 30));

let frame: FakeFrame;

async function mount(opts: { viewer?: Viewer | null; comments?: RawComment[]; screenshots?: boolean } = {}) {
  setAuthFrameFactory((origin, events) => {
    frame = new FakeFrame(origin, events, opts.viewer === undefined ? ALICE : opts.viewer);
    frame.features = { screenshots: !!opts.screenshots };
    return frame;
  });
  const el = document.createElement(TAG_NAME);
  if (!(el instanceof PreviewPinsElement)) throw new Error('not upgraded');
  const backend: Backend = { kind: 'fake', listComments: () => Promise.resolve(opts.comments ?? []) };
  el.backend = backend;
  el.config = { ...CTX, authOrigin: AUTH };
  document.body.append(el);
  await flush();
  return el;
}

const sr = (el: PreviewPinsElement) => el.shadowRoot!;
const btn = (el: PreviewPinsElement, sel: string) => sr(el).querySelector<HTMLButtonElement>(sel)!;
const newDialog = (el: PreviewPinsElement) => sr(el).querySelector<HTMLDialogElement>('dialog.composer-dialog')!;

describe('writing (M2)', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = PAGE;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 200, 120, 40));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setAuthFrameFactory(null);
  });

  it('enables comment mode when an auth worker is configured', async () => {
    const el = await mount();
    const toggle = btn(el, '[part="toggle"]');
    expect(toggle.disabled).toBe(false);
    toggle.click();
    expect(el.commentMode).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(el.commentMode).toBe(false);
  });

  it('in comment mode, page clicks are swallowed and open the composer', async () => {
    const el = await mount();
    const pageHandler = vi.fn();
    const target = document.querySelector('button')!;
    target.addEventListener('click', pageHandler);
    el.commentMode = true;
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, clientX: 160, clientY: 210 }));
    expect(pageHandler).not.toHaveBeenCalled();
    expect(newDialog(el).open).toBe(true);
    expect(newDialog(el).textContent).toContain('On button “Place order”');
    expect(el.commentMode).toBe(false);
  });

  it('posts a new pin with full anchor metadata through the frame', async () => {
    const el = await mount();
    el.commentMode = true;
    document.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, clientX: 160, clientY: 210 }));
    const dialog = newDialog(el);
    dialog.querySelector('textarea')!.value = 'Too small';
    dialog.querySelector('textarea')!.dispatchEvent(new Event('input'));
    dialog.querySelector('form')!.requestSubmit();
    await flush();
    const create = frame.calls.find((c) => c.method === 'createComment')!.params as RpcMethods['createComment'][0];
    expect(create.ctx).toEqual(CTX);
    expect(create.text).toBe('Too small');
    expect(create.meta).toMatchObject({ url: '/', sha: SHA, parent: null });
    expect(create.meta.anchor).toMatchObject({ testId: 'checkout', textQuote: { exact: 'Place order' }, rect: { x: 0.5, y: 0.25 } });
    expect(dialog.open).toBe(false);
    expect(el.threads).toHaveLength(1);
    expect(sr(el).querySelectorAll('.pin')).toHaveLength(1);
  });

  it('picks elements with the keyboard', async () => {
    const el = await mount();
    el.commentMode = true;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); // <main>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); // <h1>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); // <button>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(newDialog(el).open).toBe(true);
    expect(newDialog(el).textContent).toContain('button “Place order”');
  });

  it('asks signed-out users to sign in, keeping the draft', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    const el = await mount({ viewer: null });
    el.commentMode = true;
    document.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    const dialog = newDialog(el);
    dialog.querySelector('textarea')!.value = 'Draft';
    const submit = dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(submit.textContent).toBe('Sign in with GitHub');
    submit.click();
    expect(open).toHaveBeenCalledWith(expect.stringContaining(`${AUTH}/auth/start?challenge=c&return=`), 'pp-auth', expect.any(String));
    expect(frame.calls.some((c) => c.method === 'createComment')).toBe(false);
    frame.events.onAuthChange(ALICE);
    expect(submit.textContent).toBe('Comment');
    expect(dialog.querySelector('textarea')!.value).toBe('Draft');
  });

  it('replies and resolves from the thread dialog', async () => {
    const el = await mount({ comments: [rawPin(1, 'Root', { url: '/', anchor: { testId: 'checkout' } }, { login: 'alice' })] });
    sr(el).querySelector<HTMLButtonElement>('.pin')!.click();
    const dialog = sr(el).querySelector<HTMLDialogElement>('dialog.thread:not(.composer-dialog)')!;
    const textarea = dialog.querySelector('textarea')!;
    textarea.value = 'Fixed';
    textarea.dispatchEvent(new Event('input'));
    dialog.querySelector('form')!.requestSubmit();
    await flush();
    const reply = frame.calls.find((c) => c.method === 'createComment')!.params as RpcMethods['createComment'][0];
    expect(reply.meta).toMatchObject({ parent: 1, url: '/' });
    expect(dialog.textContent).toContain('Fixed');

    // alice started the thread, so she may resolve it.
    const resolve = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Resolve')!;
    resolve.click();
    await flush();
    const state = frame.calls.filter((c) => c.method === 'createComment').at(-1)!.params as RpcMethods['createComment'][0];
    expect(state.meta).toMatchObject({ parent: 1, state: 'resolved' });
    expect(el.threads[0]!.state).toBe('resolved');
    expect(sr(el).querySelectorAll('.pin')).toHaveLength(0);
  });

  it('hides Resolve from people who can neither own nor maintain the thread', async () => {
    const el = await mount({ viewer: { login: 'bob', avatarUrl: '' }, comments: [rawPin(1, 'Root', { url: '/', anchor: { testId: 'checkout' } }, { login: 'alice' })] });
    sr(el).querySelector<HTMLButtonElement>('.pin')!.click();
    const dialog = sr(el).querySelector<HTMLDialogElement>('dialog.thread:not(.composer-dialog)')!;
    const resolve = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Resolve')!;
    expect(resolve.hidden).toBe(true);
  });

  it('renders a sanitized markdown preview via the frame', async () => {
    const el = await mount();
    el.commentMode = true;
    document.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    const dialog = newDialog(el);
    dialog.querySelector('textarea')!.value = '**bold**';
    Array.from(dialog.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((t) => t.textContent === 'Preview')!.click();
    await flush();
    expect(dialog.querySelector('.preview')!.innerHTML).toBe('<p><strong>bold</strong></p>');
    expect(frame.calls.some((c) => c.method === 'renderMarkdown')).toBe(true);
  });

  it('completes a redirect sign-in from #pp_auth and strips it from the URL', async () => {
    history.replaceState(null, '', '/#pp_auth=SEALED');
    const el = await mount({ viewer: null });
    expect(frame.redeemed).toEqual(['SEALED']);
    expect(window.location.hash).toBe('');
    expect(el.viewer?.login).toBe('alice');
  });
});

describe('metadata from picks', () => {
  it('round-trips through the codec', () => {
    const raw = rawPin(1, 'x', { anchor: { testId: 'a', rect: { x: 0.1, y: 0.2 } } });
    expect(decodeMetadata(raw.body)?.anchor.rect).toEqual({ x: 0.1, y: 0.2 });
  });
});

describe('local comments vs. stale reads', () => {
  beforeEach(() => {
    document.body.innerHTML = PAGE;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 200, 120, 40));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    setAuthFrameFactory(null);
  });

  it('keeps a just-posted reply when an older list response arrives', async () => {
    const el = await mount({ comments: [rawPin(1, 'Root', { url: '/', anchor: { testId: 'checkout' } }, { login: 'alice' })] });
    sr(el).querySelector<HTMLButtonElement>('.pin')!.click();
    const dialog = sr(el).querySelector<HTMLDialogElement>('dialog.thread:not(.composer-dialog)')!;
    dialog.querySelector('textarea')!.value = 'Mine';
    dialog.querySelector('textarea')!.dispatchEvent(new Event('input'));
    dialog.querySelector('form')!.requestSubmit();
    await flush();
    await el.refresh(); // backend still returns only the root
    expect(el.threads[0]!.replies.map((r) => r.text)).toEqual([expect.stringContaining('Mine')]);
  });
});

describe('review threads (M4)', () => {
  beforeEach(() => {
    document.body.innerHTML = PAGE;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 200, 120, 40));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    setAuthFrameFactory(null);
  });

  it('tells the frame a reply belongs to a review thread', async () => {
    const el = await mount({ comments: [rawPin(1, 'On the diff', { url: '/', anchor: { testId: 'checkout' } }, { login: 'alice', kind: 'review' })] });
    sr(el).querySelector<HTMLButtonElement>('.pin')!.click();
    const dialog = sr(el).querySelector<HTMLDialogElement>('dialog.thread:not(.composer-dialog)')!;
    dialog.querySelector('textarea')!.value = 'Done';
    dialog.querySelector('textarea')!.dispatchEvent(new Event('input'));
    dialog.querySelector('form')!.requestSubmit();
    await flush();
    const reply = frame.calls.find((c) => c.method === 'createComment')!.params as RpcMethods['createComment'][0];
    expect(reply.parentKind).toBe('review');
  });

  it('sends the source location of the picked element', async () => {
    document.body.innerHTML = '<main><button data-pp-src="examples/app/src/App.tsx:30:9">Place order</button></main>';
    const el = await mount();
    el.commentMode = true;
    document.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    const dialog = sr(el).querySelector<HTMLDialogElement>('dialog.composer-dialog')!;
    dialog.querySelector('textarea')!.value = 'x';
    dialog.querySelector('textarea')!.dispatchEvent(new Event('input'));
    dialog.querySelector('form')!.requestSubmit();
    await flush();
    const create = frame.calls.find((c) => c.method === 'createComment')!.params as RpcMethods['createComment'][0];
    expect(create.meta.anchor.source).toBe('examples/app/src/App.tsx:30:9');
    expect(create.parentKind).toBeUndefined();
  });
});

describe('screenshots (ADR 11)', () => {
  beforeEach(() => {
    document.body.innerHTML = PAGE;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 200, 120, 40));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    setAuthFrameFactory(null);
    setCaptureLoader(null);
  });

  function pickAndType(el: PreviewPinsElement) {
    el.commentMode = true;
    document.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    const dialog = newDialog(el);
    dialog.querySelector('textarea')!.value = 'Look at this';
    dialog.querySelector('textarea')!.dispatchEvent(new Event('input'));
    return dialog;
  }

  it('hides the checkbox when the worker has no screenshot storage', async () => {
    const el = await mount({ screenshots: false });
    const dialog = pickAndType(el);
    expect(dialog.querySelector<HTMLLabelElement>('label.attach')!.hidden).toBe(true);
  });

  it('captures the picked element, uploads it, and embeds the URL', async () => {
    const capture = vi.fn(() => Promise.resolve(new Blob([new Uint8Array([0x89, 0x50])], { type: 'image/png' })));
    setCaptureLoader(() => Promise.resolve({ captureAround: capture }));
    const el = await mount({ screenshots: true });
    const dialog = pickAndType(el);
    const box = dialog.querySelector<HTMLInputElement>('#pp-attach')!;
    expect(dialog.querySelector<HTMLLabelElement>('label.attach')!.hidden).toBe(false);
    box.checked = true;
    dialog.querySelector('form')!.requestSubmit();
    await flush();
    expect(capture).toHaveBeenCalledWith(document.querySelector('button'), { exclude: el });
    const upload = frame.calls.find((c) => c.method === 'uploadScreenshot')!.params as RpcMethods['uploadScreenshot'][0];
    expect(upload.type).toBe('image/png');
    const create = frame.calls.find((c) => c.method === 'createComment')!.params as RpcMethods['createComment'][0];
    expect(create.screenshotUrl).toBe(`${AUTH}/s/acme/web/${'x'.repeat(22)}.png`);
  });

  it('does not post when the capture fails, and says how to post without it', async () => {
    setCaptureLoader(() => Promise.reject(new Error('module blocked')));
    const el = await mount({ screenshots: true });
    const dialog = pickAndType(el);
    dialog.querySelector<HTMLInputElement>('#pp-attach')!.checked = true;
    dialog.querySelector('form')!.requestSubmit();
    await flush();
    expect(frame.calls.some((c) => c.method === 'createComment')).toBe(false);
    expect(dialog.querySelector('[role="alert"]')!.textContent).toContain('Untick "Attach screenshot"');
    expect(dialog.open).toBe(true);
  });
});

