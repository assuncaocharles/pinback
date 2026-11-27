import { describe, expect, it } from 'vitest';
import type { RawComment } from './backend.js';
import { rawPin } from './testing.js';
import { buildThreads, normalisePath, threadsForPath } from './threads.js';

const plain: RawComment = { ...rawPin(99, 'x'), body: 'LGTM, just a normal comment' };

describe('buildThreads', () => {
  it('ignores comments without metadata', () => {
    expect(buildThreads([plain])).toEqual([]);
  });

  it('groups replies under roots and numbers roots by creation', () => {
    const threads = buildThreads([
      rawPin(3, 'reply to 1', { parent: 1 }),
      rawPin(2, 'second root'),
      rawPin(1, 'first root'),
      plain,
    ]);
    expect(threads.map((t) => [t.id, t.number])).toEqual([['1', 1], ['2', 2]]);
    expect(threads[0]!.replies.map((r) => r.id)).toEqual(['3']);
    expect(threads[0]!.root.text).toContain('first root');
  });

  it('drops replies to unknown roots', () => {
    expect(buildThreads([rawPin(1, 'root'), rawPin(2, 'orphan', { parent: 500 })])[0]!.replies).toEqual([]);
  });

  it('lets the root author resolve', () => {
    const [t] = buildThreads([rawPin(1, 'root', {}, { login: 'bob' }), rawPin(2, '', { parent: 1, state: 'resolved' }, { login: 'bob' })]);
    expect(t!.state).toBe('resolved');
    expect(t!.stateChangedBy).toBe('bob');
    expect(t!.replies).toEqual([]);
  });

  it('lets maintainers resolve and reopen; the latest event wins', () => {
    const [t] = buildThreads([
      rawPin(1, 'root', {}, { login: 'bob' }),
      rawPin(2, '', { parent: 1, state: 'resolved' }, { login: 'maint', association: 'MEMBER' }),
      rawPin(3, '', { parent: 1, state: 'open' }, { login: 'owner', association: 'OWNER' }),
    ]);
    expect(t!.state).toBe('open');
    expect(t!.stateChangedBy).toBe('owner');
  });

  it('ignores state events from unauthorised users', () => {
    const [t] = buildThreads([
      rawPin(1, 'root', {}, { login: 'bob' }),
      rawPin(2, '', { parent: 1, state: 'resolved' }, { login: 'drive-by', association: 'CONTRIBUTOR' }),
    ]);
    expect(t!.state).toBe('open');
  });

  it('keeps a state event with a note as a reply', () => {
    const [t] = buildThreads([
      rawPin(1, 'root', {}, { login: 'bob' }),
      rawPin(2, 'Fixed in abc123', { parent: 1, state: 'resolved' }, { login: 'bob' }),
    ]);
    expect(t!.state).toBe('resolved');
    expect(t!.replies.map((r) => r.id)).toEqual(['2']);
  });
});

describe('paths', () => {
  it.each([
    ['/checkout/', '/checkout'],
    ['/checkout?x=1#y', '/checkout'],
    ['/', '/'],
    ['', '/'],
  ])('normalises %s', (input, out) => {
    expect(normalisePath(input)).toBe(out);
  });

  it('filters threads by page', () => {
    const threads = buildThreads([rawPin(1, 'a', { url: '/checkout' }), rawPin(2, 'b', { url: '/' })]);
    expect(threadsForPath(threads, '/checkout/').map((t) => t.id)).toEqual(['1']);
  });
});

describe('review threads', () => {
  it('attaches replies typed in GitHub to their review thread', () => {
    const root = rawPin(1, 'On the diff', {}, { kind: 'review' });
    const native: RawComment = { ...rawPin(2, 'x', {}, { login: 'bob', kind: 'review' }), body: 'Fixed in the next commit', inReplyTo: '1' };
    const [t] = buildThreads([root, native]);
    expect(t!.replies.map((r) => [r.id, r.text])).toEqual([['2', 'Fixed in the next commit']]);
  });

  it("lets GitHub's resolved state win for review threads", () => {
    const root = { ...rawPin(1, 'On the diff', {}, { kind: 'review' }), threadResolved: true };
    const reopen = rawPin(2, '', { parent: 1, state: 'open' }, { association: 'OWNER' });
    expect(buildThreads([root, reopen])[0]!.state).toBe('resolved');
    expect(buildThreads([{ ...root, threadResolved: false }])[0]!.state).toBe('open');
  });

  it('keeps the comment kind on pins', () => {
    expect(buildThreads([rawPin(1, 'x', {}, { kind: 'review' })])[0]!.root.kind).toBe('review');
  });
});
