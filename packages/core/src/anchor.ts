import type { Anchor, RelativePoint, TextQuote } from './metadata.js';

/**
 * Anchoring: generate several selectors for an element, then re-find it
 * after a redeploy by scoring candidates against all of them (ADR 9).
 *
 * Inspired by the W3C Web Annotation selectors: no single selector survives
 * every refactor, but together they usually point at one element clearly.
 */

const MAX_DEPTH = 12;
const QUOTE_MAX = 64;
const CONTEXT_MAX = 32;
/** Elements with more text than this can't be a quote match (they're containers). */
const TEXT_SCAN_MAX = QUOTE_MAX * 3;

/** Minimum confidence to place a pin. Below it the pin is outdated. */
export const ANCHOR_THRESHOLD = 0.5;
/** Below this (but above the threshold) the pin is shown as approximate. */
export const ANCHOR_APPROXIMATE = 0.7;

export const normaliseText = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();
const quoteText = (el: Element) => normaliseText(el.textContent).slice(0, QUOTE_MAX);

// ---------------------------------------------------------------------------
// Generation

/** Ids that look hand-written, not generated (React useId, CSS-in-JS hashes, UUIDs). */
export function isStableId(id: string): boolean {
  return /^[A-Za-z][\w-]{0,63}$/.test(id) && !/\d{3,}|[:]|^r\d|^[a-f0-9]{8,}$/i.test(id);
}

/**
 * Classes that look hand-written. Rejects CSS-in-JS and CSS-module hashes:
 * css-1x9fz2, sc-bdVaJa, jsx-123, Button_root__a1B2c, _3xYz9, emotion-0.
 */
export function isStableClass(cls: string): boolean {
  if (!/^[a-z][a-z0-9-]*(?:__[a-z0-9-]+)?(?:--[a-z0-9-]+)?$/i.test(cls)) return false;
  if (/^(css|sc|jsx|emotion|styled|chakra|mui|tw)-/i.test(cls)) return false;
  if (/\d{2,}/.test(cls)) return false;
  // Mixed-case runs with digits read as hashes (e.g. "aB3dE").
  if (/[a-z][A-Z]|[A-Z]{2,}[a-z]/.test(cls) && /\d/.test(cls)) return false;
  return cls.length <= 40;
}

function step(node: Element): string {
  const tag = node.tagName.toLowerCase();
  const parent = node.parentElement;
  if (!parent) return tag;
  const siblings = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
  if (siblings.length === 1) return tag;
  // Prefer a stable class that singles the node out among same-tag siblings.
  for (const cls of Array.from(node.classList).filter(isStableClass)) {
    if (siblings.filter((s) => s.classList.contains(cls)).length === 1) return `${tag}.${CSS.escape(cls)}`;
  }
  return `${tag}:nth-of-type(${siblings.indexOf(node) + 1})`;
}

/** Short CSS path from the nearest stable id (or body), avoiding generated class names. */
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
    parts.unshift(step(node));
    node = node.parentElement;
  }
  return parts.join(' > ');
}

/**
 * Text around an element: from the nearest ancestor whose text is longer than
 * the element's own. Skipping same-text wrappers keeps context stable when a
 * refactor adds or removes a wrapping <div>.
 */
function contextText(el: Element): string {
  const own = normaliseText(el.textContent);
  for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
    const t = normaliseText(p.textContent);
    if (t.length > own.length) return t;
  }
  return '';
}

function textQuote(el: Element): TextQuote | undefined {
  const exact = quoteText(el);
  if (!exact) return undefined;
  const ctx = contextText(el);
  const at = ctx.indexOf(exact);
  return {
    exact,
    prefix: at > 0 ? ctx.slice(Math.max(0, at - CONTEXT_MAX), at).trim() : '',
    suffix: at >= 0 ? ctx.slice(at + exact.length, at + exact.length + CONTEXT_MAX).trim() : '',
  };
}

/** Builds every selector we can for `el`. `point` is the click in client coordinates. */
export function describeElement(el: Element, point?: { x: number; y: number }): Anchor {
  const anchor: Anchor = { cssPath: cssPath(el) };
  const testId = el.closest('[data-testid]')?.getAttribute('data-testid');
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

// ---------------------------------------------------------------------------
// Resolution

/** Signal weights: how much each selector is trusted (ADR 9). */
export const WEIGHTS = {
  source: 3,
  testId: 3,
  text: 2,
  context: 1.5,
  cssPath: 1,
  tag: 0.5,
} as const;

/** A selector the page no longer contains at all counts this much in the denominator. */
const MISSING_SIGNAL_FACTOR = 0.3;
/** Text similarity below this contradicts the stored quote. */
const CONTRADICTION = 0.3;
/** Two unrelated candidates closer than this are ambiguous. */
const AMBIGUITY_MARGIN = 0.05;

export interface AnchorMatch {
  element: Element;
  /** 0..1. */
  confidence: number;
  /** A different, unrelated element scored nearly as well. */
  ambiguous: boolean;
  /** Per-signal scores (0..1), for debugging and tests. */
  signals: Partial<Record<keyof typeof WEIGHTS, number>>;
}

export interface ResolveOptions {
  /** Elements under this root, or containing it, are never anchor targets (the widget itself). */
  ignore?: Element | null;
  /** Reuse an index across many anchors in one pass. */
  index?: AnchorIndex;
}

interface IndexedElement {
  el: Element;
  text: string;
}

/**
 * One scan of the page shared by every anchor resolved in the same pass:
 * candidate texts and attribute lookups. Build it once per re-anchor.
 */
export class AnchorIndex {
  readonly texts: IndexedElement[] = [];
  readonly #root: ParentNode;
  #pageText: string | null = null;
  readonly #ignore: Element | null;

  constructor(root: ParentNode, ignore: Element | null = null) {
    this.#root = root;
    this.#ignore = ignore;
    for (const el of root.querySelectorAll('body *')) {
      if (!this.allowed(el)) continue;
      const len = el.textContent.length;
      if (len === 0 || len > TEXT_SCAN_MAX * 2) continue;
      const text = quoteText(el);
      if (text) this.texts.push({ el, text });
    }
  }

  /** Whitespace-normalised text of the whole page (computed lazily). */
  get pageText(): string {
    if (this.#pageText === null) {
      // nodeType, not instanceof: documents can come from another realm.
      const root = this.#root as unknown as Node;
      const node = root.nodeType === Node.DOCUMENT_NODE ? (root as Document).body : root;
      this.#pageText = normaliseText(node.textContent);
    }
    return this.#pageText;
  }

  allowed(el: Element): boolean {
    const ig = this.#ignore;
    return !(ig && (ig === el || ig.contains(el) || el.contains(ig)));
  }

  query(selector: string): Element[] {
    try {
      return Array.from(this.#root.querySelectorAll(selector)).filter((e) => this.allowed(e));
    } catch {
      return [];
    }
  }

  queryOne(selector: string): Element | null {
    try {
      const el = this.#root.querySelector(selector);
      return el && this.allowed(el) ? el : null;
    } catch {
      return null;
    }
  }
}

/** Dice coefficient over character bigrams: 1 for equal strings, ~0 for unrelated ones. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x.length < 2 || y.length < 2) return x === y ? 1 : 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < x.length - 1; i++) {
    const g = x.slice(i, i + 2);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  let hits = 0;
  for (let i = 0; i < y.length - 1; i++) {
    const g = y.slice(i, i + 2);
    const n = grams.get(g) ?? 0;
    if (n > 0) {
      grams.set(g, n - 1);
      hits++;
    }
  }
  return (2 * hits) / (x.length - 1 + (y.length - 1));
}

function parseSource(s: string): { file: string; line: string } | null {
  const m = /^(.*):(\d+):(\d+)$/.exec(s);
  return m?.[1] && m[2] ? { file: m[1], line: m[2] } : null;
}

function lastTag(path: string | undefined): string | null {
  const last = path?.split('>').pop()?.trim();
  const m = last ? /^([a-z][a-z0-9-]*)/i.exec(last) : null;
  return m?.[1]?.toLowerCase() ?? null;
}

const depth = (el: Element) => {
  let d = 0;
  for (let p = el.parentElement; p; p = p.parentElement) d++;
  return d;
};

/** Scores one candidate against every selector in the anchor. */
function score(el: Element, anchor: Anchor, ctx: ScoreContext): AnchorMatch {
  const signals: AnchorMatch['signals'] = {};
  let num = 0;
  let den = 0;
  const add = (key: keyof typeof WEIGHTS, value: number, missing = false) => {
    const w = WEIGHTS[key] * (missing ? MISSING_SIGNAL_FACTOR : 1);
    signals[key] = value;
    num += w * value;
    den += w;
  };

  if (anchor.source) {
    const own = el.closest('[data-pp-src]')?.getAttribute('data-pp-src') ?? null;
    let v = 0;
    if (own === anchor.source) v = 1;
    else if (own) {
      const a = parseSource(anchor.source);
      const b = parseSource(own);
      if (a && b && a.file === b.file) v = a.line === b.line ? 1 : 0.3;
    }
    add('source', v, !ctx.sourceExists);
  }

  if (anchor.testId) {
    // The stored testId is the *nearest* one, possibly an ancestor's, so the
    // bearer and its descendants all match; text and tag pick between them.
    const nearest = el.closest('[data-testid]')?.getAttribute('data-testid') === anchor.testId;
    add('testId', nearest ? 1 : 0, !ctx.testIdExists);
  }

  const quote = anchor.textQuote;
  if (quote) {
    const text = quoteText(el);
    add('text', text ? similarity(text, quote.exact) : 0);
    if (quote.prefix || quote.suffix) {
      const around = contextText(el);
      const parts = [quote.prefix, quote.suffix].filter(Boolean);
      add('context', parts.filter((p) => around.includes(p)).length / parts.length, !ctx.contextExists);
    }
  }

  if (anchor.cssPath) add('cssPath', ctx.cssTarget === el ? 1 : 0, !ctx.cssTarget);
  if (ctx.tag) add('tag', el.tagName.toLowerCase() === ctx.tag ? 1 : 0);

  let confidence = den ? num / den : 0;
  // Text that flatly contradicts the original, with nothing identity-like
  // (testId, source) vouching for the element, means a different element now
  // sits where ours was. Keep such a pin outdated rather than move it there.
  const identity = signals.testId === 1 || signals.source === 1;
  if (signals.text !== undefined && signals.text < CONTRADICTION && !identity) {
    confidence = Math.min(confidence, ANCHOR_THRESHOLD - 0.05);
  }
  return { element: el, confidence, ambiguous: false, signals };
}

interface ScoreContext {
  sourceExists: boolean;
  testIdExists: boolean;
  /** Whether the stored prefix/suffix still appear anywhere on the page. */
  contextExists: boolean;
  cssTarget: Element | null;
  tag: string | null;
}

/**
 * Best candidate for an anchor with its confidence, or null if the page has
 * no candidate at all. Doesn't apply the threshold: see resolveAnchor.
 */
export function matchAnchor(root: ParentNode, anchor: Anchor, opts: ResolveOptions = {}): AnchorMatch | null {
  const index = opts.index ?? new AnchorIndex(root, opts.ignore ?? null);
  const candidates = new Set<Element>();

  const bySource = anchor.source ? index.query(`[data-pp-src="${CSS.escape(anchor.source)}"]`) : [];
  const byTestId = anchor.testId ? index.query(`[data-testid="${CSS.escape(anchor.testId)}"]`) : [];
  const cssTarget = anchor.cssPath ? index.queryOne(anchor.cssPath) : null;

  for (const el of bySource) candidates.add(el);
  for (const el of byTestId) {
    candidates.add(el);
    // The testId may be on an ancestor of the pinned element.
    for (const d of el.querySelectorAll('*')) if (index.allowed(d)) candidates.add(d);
  }
  if (cssTarget) candidates.add(cssTarget);
  if (anchor.source && !bySource.length) {
    // Same file, shifted line: still a useful candidate pool.
    const file = parseSource(anchor.source)?.file;
    if (file) for (const el of index.query(`[data-pp-src^="${CSS.escape(file)}:"]`)) candidates.add(el);
  }
  const quote = anchor.textQuote?.exact;
  if (quote) {
    for (const { el, text } of index.texts) {
      if (text === quote || (text.length <= TEXT_SCAN_MAX && similarity(text, quote) >= 0.5)) candidates.add(el);
    }
  }
  if (!candidates.size) return null;

  const pageText = index.pageText;
  const tq = anchor.textQuote;
  const ctx: ScoreContext = {
    sourceExists: bySource.length > 0,
    testIdExists: byTestId.length > 0,
    contextExists: !!tq && [tq.prefix, tq.suffix].some((p) => p && pageText.includes(p)),
    cssTarget,
    tag: lastTag(anchor.cssPath),
  };

  const scored = Array.from(candidates, (el) => score(el, anchor, ctx));
  // Highest confidence first; on ties prefer the deeper element (the
  // button, not the wrapper with the same text).
  scored.sort((a, b) => b.confidence - a.confidence || depth(b.element) - depth(a.element));
  const best = scored[0];
  if (!best) return null;
  const rival = scored.find(
    (s) => s !== best && !s.element.contains(best.element) && !best.element.contains(s.element),
  );
  if (rival && best.confidence - rival.confidence < AMBIGUITY_MARGIN) best.ambiguous = true;
  return best;
}

/** The element an anchor points at, or null when nothing passes the threshold (outdated). */
export function resolveAnchor(root: ParentNode, anchor: Anchor, opts: ResolveOptions = {}): Element | null {
  const m = matchAnchor(root, anchor, opts);
  return m && m.confidence >= ANCHOR_THRESHOLD ? m.element : null;
}

/** Client coordinates for a pin on `el`, honouring the stored relative point. */
export function pinPosition(el: Element, rect: RelativePoint | undefined): { x: number; y: number; visible: boolean } {
  const r = el.getBoundingClientRect();
  const visible = r.width > 0 || r.height > 0;
  const rx = rect?.x ?? 1;
  const ry = rect?.y ?? 0;
  return { x: r.left + r.width * rx, y: r.top + r.height * ry, visible };
}
