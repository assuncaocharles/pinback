/**
 * The machine-readable part of a pin comment, stored in a hidden HTML comment:
 *
 *   <!-- pinback:v1 {"anchor":{...},"viewport":{...},...} -->
 *
 * See docs/metadata-format.md for the full spec.
 */

export const METADATA_VERSION = 1;

export interface TextQuote {
  exact: string;
  prefix: string;
  suffix: string;
}

/** Where inside the anchored element the pin sits, as fractions of its box (0..1). */
export interface RelativePoint {
  x: number;
  y: number;
}

export interface Anchor {
  testId?: string;
  source?: string;
  cssPath?: string;
  textQuote?: TextQuote;
  rect?: RelativePoint;
}

export type ThreadState = 'resolved' | 'open';

export interface PinMetadata {
  anchor: Anchor;
  viewport: { w: number; h: number };
  /** Pathname of the page the pin was created on, e.g. "/checkout". */
  url: string;
  /** Commit the preview was built from when the pin was created. */
  sha: string;
  /** null for a root pin; the root comment's id for replies and state events. */
  parent: number | null;
  /** Present only on state-change replies. See ADR 5. */
  state?: ThreadState;
}

// "preview-pins" is the pre-rename marker; still read so older pins keep working.
const MARKER_RE = /<!-- (?:pinback|preview-pins):v(\d+) ([\s\S]*?) -->/g;

/**
 * JSON.stringify, then escape `<` and `>` as \u003c / \u003e. Both are valid
 * JSON escapes, so the payload parses back unchanged, and it can never
 * contain `-->`, `--!>` or `<!--`, which would end or nest the HTML comment.
 */
export function encodeMetadata(meta: PinMetadata): string {
  const json = JSON.stringify(meta).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  return `<!-- pinback:v${METADATA_VERSION} ${json} -->`;
}

/**
 * Finds and validates the metadata block in a comment body. Uses the last
 * block, since ours is appended after the user's text and the text may quote
 * another comment. Returns null for no block, an unknown version or
 * malformed data. Never throws.
 */
export function decodeMetadata(body: string): PinMetadata | null {
  let last: RegExpExecArray | null = null;
  for (const m of body.matchAll(MARKER_RE)) last = m;
  if (!last) return null;
  if (Number(last[1]) !== METADATA_VERSION) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(last[2] ?? '');
  } catch {
    return null;
  }
  return validate(raw);
}

/** Removes every metadata block, leaving only the human-readable markdown. */
export function stripMetadata(body: string): string {
  return body.replace(MARKER_RE, '').trimEnd();
}

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max = 2000): v is string => typeof v === 'string' && v.length <= max;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function validate(raw: unknown): PinMetadata | null {
  if (!isRec(raw)) return null;
  const { anchor, viewport, url, sha, parent, state } = raw;
  if (!isRec(viewport) || !isNum(viewport.w) || !isNum(viewport.h)) return null;
  if (!isStr(url) || !url.startsWith('/')) return null;
  if (!isStr(sha, 64)) return null;
  if (parent !== null && !(isNum(parent) && Number.isInteger(parent) && parent > 0)) return null;
  if (state !== undefined && state !== 'resolved' && state !== 'open') return null;

  const out: PinMetadata = {
    anchor: validateAnchor(anchor),
    viewport: { w: viewport.w, h: viewport.h },
    url,
    sha,
    parent,
  };
  if (state) out.state = state;
  return out;
}

function validateAnchor(raw: unknown): Anchor {
  const out: Anchor = {};
  if (!isRec(raw)) return out;
  if (isStr(raw.testId, 200)) out.testId = raw.testId;
  if (isStr(raw.source, 500)) out.source = raw.source;
  if (isStr(raw.cssPath, 1000)) out.cssPath = raw.cssPath;
  const q = raw.textQuote;
  if (isRec(q) && isStr(q.exact, 500) && isStr(q.prefix, 200) && isStr(q.suffix, 200)) {
    out.textQuote = { exact: q.exact, prefix: q.prefix, suffix: q.suffix };
  }
  const r = raw.rect;
  if (isRec(r) && isNum(r.x) && isNum(r.y)) {
    out.rect = { x: clamp01(r.x), y: clamp01(r.y) };
  }
  return out;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export interface FormatOptions {
  /** The comment text the reviewer wrote (markdown). */
  text: string;
  meta: PinMetadata;
  /** Absolute preview URL for the "view in preview" link, if known. */
  previewUrl?: string;
  /**
   * For review comments placed on a nearby line: where the element really is,
   * e.g. "src/App.tsx:42".
   */
  elementAt?: string;
}

/**
 * Builds a full comment body: the reviewer's text, a short footer that reads
 * well on GitHub, then the hidden metadata block.
 */
export function formatCommentBody({ text, meta, previewUrl, elementAt }: FormatOptions): string {
  const where = previewUrl ? `[\`${meta.url}\`](${previewUrl})` : `\`${meta.url}\``;
  const at = elementAt ? ` · element at \`${elementAt}\`` : '';
  const footer =
    meta.parent === null
      ? `<sub>📌 Pinned on ${where} at ${meta.sha.slice(0, 7)}${at} · pinback</sub>`
      : meta.state === 'resolved'
        ? `<sub>✅ Resolved via pinback</sub>`
        : meta.state === 'open'
          ? `<sub>↩︎ Reopened via pinback</sub>`
          : `<sub>↩︎ Reply via pinback</sub>`;
  const body = text.trim();
  return `${body ? `${body}\n\n` : ''}${footer}\n\n${encodeMetadata(meta)}`;
}
