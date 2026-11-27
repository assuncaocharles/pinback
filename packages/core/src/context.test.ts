// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from 'vitest';
import { fromMeta, fromQuery, resolveAuthOrigin, resolvePRContext, resolvePRContextFromPage } from './context.js';

const SHA = 'abc1234def5678abc1234def5678abc1234def56';

function setMeta(content: string) {
  document.head.innerHTML = `<meta name="pinback" content="${content}">`;
}

describe('fromMeta', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
  });

  it('parses a full meta tag', () => {
    setMeta(`owner=acme; repo=web; pr=42; sha=${SHA}`);
    expect(fromMeta(document)).toEqual({ owner: 'acme', repo: 'web', prNumber: 42, commitSha: SHA });
  });

  it('returns empty when the tag is missing', () => {
    expect(fromMeta(document)).toEqual({});
  });

  it('drops invalid values', () => {
    setMeta('owner=ac me;repo=web;pr=-3;sha=zzz');
    expect(fromMeta(document)).toEqual({ repo: 'web' });
  });
});

describe('fromQuery', () => {
  it('reads prefixed params', () => {
    expect(fromQuery(`?pp_owner=acme&pp_repo=web&pp_pr=7&pp_sha=${SHA}`)).toEqual({
      owner: 'acme',
      repo: 'web',
      prNumber: 7,
      commitSha: SHA,
    });
  });

  it('rejects a non-integer PR number', () => {
    expect(fromQuery('?pp_pr=1.5')).toEqual({});
  });
});

describe('resolvePRContext', () => {
  it('prefers earlier sources field by field', () => {
    const ctx = resolvePRContext(
      { owner: 'meta-owner' },
      { owner: 'query-owner', repo: 'query-repo', prNumber: 1 },
      { commitSha: SHA, prNumber: 99 },
    );
    expect(ctx).toEqual({ owner: 'meta-owner', repo: 'query-repo', prNumber: 1, commitSha: SHA });
  });

  it('returns null when incomplete', () => {
    expect(resolvePRContext({ owner: 'a', repo: 'b' })).toBeNull();
  });
});

describe('resolvePRContextFromPage', () => {
  it('meta wins over query wins over config', () => {
    setMeta('owner=from-meta');
    const ctx = resolvePRContextFromPage(
      document,
      { search: '?pp_owner=from-query&pp_repo=from-query' },
      { owner: 'cfg', repo: 'cfg', prNumber: 3, commitSha: SHA },
    );
    expect(ctx).toEqual({ owner: 'from-meta', repo: 'from-query', prNumber: 3, commitSha: SHA });
  });
});

describe('resolveAuthOrigin', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
  });

  it('reads auth= from the meta tag, normalised to an origin', () => {
    setMeta('owner=a;repo=b;auth=https://auth.example.dev/frame');
    expect(resolveAuthOrigin(document)).toBe('https://auth.example.dev');
  });

  it('falls back to config', () => {
    expect(resolveAuthOrigin(document, { authOrigin: 'http://localhost:8787' })).toBe('http://localhost:8787');
  });

  it.each(['http://auth.example.dev', 'javascript:alert(1)', 'nope'])('rejects %s', (v) => {
    expect(resolveAuthOrigin(document, { authOrigin: v })).toBeNull();
  });
});
