import type { Anchor, RelativePoint, TextQuote } from './metadata.js';

/**
 * M1 anchoring: generate selectors for an element, and resolve them with a
 * simple ordered strategy. M3 replaces resolution with confidence scoring
 * and adds the refactor fixture suite.
 */

const MAX_DEPTH = 12;
const QUOTE_MAX = 64;
const CONTEXT_MAX = 32;

export const normaliseText = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

/** Ids that look hand-written, not generated (React useId, CSS-in-JS hashes, UUIDs). */
function isStableId(id: string): boolean {
  return /^[A-Za-z][\w-]{0,63}$/.test(id) && !/\d{3,}|[:]|^r\d|^[a-f0-9]{8,}$/i.test(id);
}

export function cssPath(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  for (let depth = 0; node && depth < MAX_DEPTH; depth++) {
    const tag = node.tagName.toLowerCase();
    if (tag === 'body' || tag === 'html') {
      parts.unshift(tag);
      break;
    }
    if (node.id && isStableId(node.id)) {
      parts.unshift(`#${CSS.escape(node.id)}`);
      break;
    }
    const parent: Element | null = node.parentElement;
    let step = tag;
    if (parent) {
      const current: Element = node;
      const same = Array.from(parent.children).filter((c) => c.tagName === current.tagName);
      if (same.length > 1) step += `:nth-of-type(${same.indexOf(current) + 1})`;
    }
    parts.unshift(step);
    node = parent;
  }
  return parts.join(' > ');
}

function textQuote(el: Element): TextQuote | undefined {
  const exact = normaliseText(el.textContent).slice(0, QUOTE_MAX);
  if (!exact) return undefined;
  const parentText = normaliseText(el.parentElement?.textContent);
  const at = parentText.indexOf(exact);
  return {
    exact,
    prefix: at > 0 ? parentText.slice(Math.max(0, at - CONTEXT_MAX), at).trim() : '',
    suffix: at >= 0 ? parentText.slice(at + exact.length, at + exact.length + CONTEXT_MAX).trim() : '',
  };
}

/** Builds every selector we can for `el`. `point` is the click in client coordinates. */
export function describeElement(el: Element, point?: { x: number; y: number }): Anchor {
  const anchor: Anchor = { cssPath: cssPath(el) };
  const testIdEl = el.closest('[data-testid]');
  const testId = testIdEl?.getAttribute('data-testid');
  if (testId) anchor.testId = testId;
  const source = el.closest('[data-pp-src]')?.getAttribute('data-pp-src');
  if (source) anchor.source = source;
  const quote = textQuote(el);
  if (quote) anchor.textQuote = quote;
  if (point) {
    const r = el.getBoundingClientRect();
    anchor.rect = {
      x: r.width ? clamp01((point.x - r.left) / r.width) : 0.5,
      y: r.height ? clamp01((point.y - r.top) / r.height) : 0.5,
    };
  }
  return anchor;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export interface ResolveOptions {
  /** Elements under this root are never anchor targets (the widget itself). */
  ignore?: Element | null;
}

/**
 * Finds the element an anchor points at, or null (the pin is outdated).
 * Order for M1: cssPath (checked against testId/text when present),
 * then testId, then text quote.
 */
export function resolveAnchor(root: ParentNode, anchor: Anchor, opts: ResolveOptions = {}): Element | null {
  const ignore = opts.ignore;
  // Neither inside the widget nor an ancestor of it (an ancestor's text would include ours).
  const ok = (el: Element | null): el is Element =>
    !!el && !(ignore && (ignore.contains(el) || el.contains(ignore)));

  if (anchor.cssPath) {
    const el = safeQuery(root, anchor.cssPath);
    if (ok(el) && consistent(el, anchor)) return el;
  }
  if (anchor.testId) {
    const el = safeQuery(root, `[data-testid="${CSS.escape(anchor.testId)}"]`);
    if (ok(el)) {
      // The testId may belong to an ancestor of the clicked element; prefer
      // the descendant whose text matches, if any.
      return (anchor.textQuote && findByText(el, anchor.textQuote, ok)) ?? el;
    }
  }
  if (anchor.textQuote) {
    const el = findByText(root, anchor.textQuote, ok);
    if (el) return el;
  }
  return null;
}

function consistent(el: Element, anchor: Anchor): boolean {
  if (anchor.testId && el.closest('[data-testid]')?.getAttribute('data-testid') !== anchor.testId) return false;
  if (anchor.textQuote && normaliseText(el.textContent).slice(0, QUOTE_MAX) !== anchor.textQuote.exact) return false;
  return true;
}

function safeQuery(root: ParentNode, selector: string): Element | null {
  try {
    return root.querySelector(selector);
  } catch {
    return null;
  }
}

/** Deepest element whose normalised text equals the quote, preferring matching context. */
function findByText(root: ParentNode, quote: TextQuote, ok: (el: Element | null) => el is Element): Element | null {
  let best: Element | null = null;
  let bestScore = -1;
  for (const el of root.querySelectorAll('*')) {
    if (!ok(el)) continue;
    if (normaliseText(el.textContent).slice(0, QUOTE_MAX) !== quote.exact) continue;
    const parentText = normaliseText(el.parentElement?.textContent);
    let score = 1;
    if (quote.prefix && parentText.includes(quote.prefix + ' ' + quote.exact)) score++;
    if (quote.suffix && parentText.includes(quote.exact + ' ' + quote.suffix)) score++;
    // querySelectorAll is document order, so later equal-score hits are
    // descendants: >= keeps the deepest element.
    if (score >= bestScore) {
      best = el;
      bestScore = score;
    }
  }
  return best;
}

/** Client coordinates for a pin on `el`, honouring the stored relative point. */
export function pinPosition(el: Element, rect: RelativePoint | undefined): { x: number; y: number; visible: boolean } {
  const r = el.getBoundingClientRect();
  const visible = r.width > 0 || r.height > 0;
  const rx = rect?.x ?? 1;
  const ry = rect?.y ?? 0;
  return { x: r.left + r.width * rx, y: r.top + r.height * ry, visible };
}
