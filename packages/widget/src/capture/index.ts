import { domToCanvas } from 'modern-screenshot';

/**
 * Lazy-loaded capture module (ADR 11): renders the page around a pinned
 * element to an image. Built as its own file (pinback-capture.mjs) so the
 * main widget never pays for it unless a reviewer attaches a screenshot.
 */

export interface CaptureOptions {
  /** Never drawn: the widget's own host element. */
  exclude: Element;
  /** Context around the element, in CSS px. */
  padding?: number;
  /** Output width cap, in px. */
  maxWidth?: number;
}

const MAX_BYTES = 2 * 1024 * 1024;
const MIN_W = 480;
const MIN_H = 260;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(n, Math.max(lo, hi)));

export async function captureAround(target: Element, opts: CaptureOptions): Promise<Blob> {
  const pad = opts.padding ?? 48;
  const maxWidth = opts.maxWidth ?? 1200;
  const r = target.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  // The element plus padding, at least MIN_W x MIN_H so small targets keep
  // their surroundings, centred on the element and kept inside the viewport.
  const w = Math.min(vw, Math.max(r.width + pad * 2, MIN_W));
  const h = Math.min(vh, Math.max(r.height + pad * 2, MIN_H));
  const x = clamp(r.left + r.width / 2 - w / 2, 0, vw - w);
  const y = clamp(r.top + r.height / 2 - h / 2, 0, vh - h);
  const scale = Math.min(window.devicePixelRatio || 1, 2, maxWidth / Math.max(1, w));

  const page = await domToCanvas(document.documentElement, {
    scale,
    width: vw,
    height: document.documentElement.scrollHeight,
    backgroundColor: getComputedStyle(document.body).backgroundColor || '#ffffff',
    filter: (node) => node !== opts.exclude,
  });

  const out = document.createElement('canvas');
  out.width = Math.round(w * scale);
  out.height = Math.round(h * scale);
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.drawImage(page, (x + window.scrollX) * scale, (y + window.scrollY) * scale, w * scale, h * scale, 0, 0, out.width, out.height);

  for (const [type, quality] of [['image/webp', 0.85], ['image/webp', 0.6], ['image/png', undefined]] as const) {
    const blob = await new Promise<Blob | null>((resolve) => { out.toBlob(resolve, type, quality); });
    // Some browsers ignore WebP and hand back PNG; accept whatever fits.
    if (blob && blob.size <= MAX_BYTES) return blob;
  }
  throw new Error('Screenshot is larger than 2 MB');
}
