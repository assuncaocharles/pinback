import type { PRContext } from './types.js';

export type PartialPRContext = Partial<PRContext>;

const META_NAME = 'preview-pins';

/** Accepts only GitHub-safe owner/repo names, to keep garbage out of API URLs. */
const NAME_RE = /^[A-Za-z0-9_.-]{1,100}$/;
const SHA_RE = /^[0-9a-f]{7,40}$/i;

function clean(input: Record<string, unknown>): PartialPRContext {
  const out: PartialPRContext = {};
  const { owner, repo, prNumber, commitSha } = input;
  if (typeof owner === 'string' && NAME_RE.test(owner)) out.owner = owner;
  if (typeof repo === 'string' && NAME_RE.test(repo)) out.repo = repo;
  const n = typeof prNumber === 'string' ? Number(prNumber) : prNumber;
  if (typeof n === 'number' && Number.isInteger(n) && n > 0) out.prNumber = n;
  if (typeof commitSha === 'string' && SHA_RE.test(commitSha)) out.commitSha = commitSha;
  return out;
}

/**
 * Reads `<meta name="preview-pins" content="owner=..;repo=..;pr=..;sha=..">`.
 * The key=value;... form is easy to emit from shell in CI.
 */
export function fromMeta(doc: Document): PartialPRContext {
  const content = doc.querySelector(`meta[name="${META_NAME}"]`)?.getAttribute('content');
  if (!content) return {};
  const kv = Object.fromEntries(
    content
      .split(';')
      .map((part) => part.split('=').map((s) => s.trim()))
      .filter((pair): pair is [string, string] => pair.length === 2 && pair[0] !== ''),
  );
  return clean({ owner: kv.owner, repo: kv.repo, prNumber: kv.pr, commitSha: kv.sha });
}

/** Reads `?pp_owner=&pp_repo=&pp_pr=&pp_sha=`. Prefixed to avoid clashing with app params. */
export function fromQuery(search: string): PartialPRContext {
  const p = new URLSearchParams(search);
  return clean({
    owner: p.get('pp_owner') ?? undefined,
    repo: p.get('pp_repo') ?? undefined,
    prNumber: p.get('pp_pr') ?? undefined,
    commitSha: p.get('pp_sha') ?? undefined,
  });
}

/**
 * Merges sources field by field, earlier sources win:
 * meta tag, then query params, then the element's config object.
 * Returns null if any field is still missing.
 */
export function resolvePRContext(...sources: PartialPRContext[]): PRContext | null {
  const merged: PartialPRContext = {};
  for (const key of ['owner', 'repo', 'prNumber', 'commitSha'] as const) {
    const hit = sources.find((s) => s[key] !== undefined);
    if (hit) Object.assign(merged, { [key]: hit[key] });
  }
  const { owner, repo, prNumber, commitSha } = merged;
  if (owner && repo && prNumber && commitSha) return { owner, repo, prNumber, commitSha };
  return null;
}

export function resolvePRContextFromPage(
  doc: Document,
  location: Pick<Location, 'search'>,
  config: Record<string, unknown> = {},
): PRContext | null {
  return resolvePRContext(fromMeta(doc), fromQuery(location.search), clean(config));
}
