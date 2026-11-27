/**
 * Second-line sanitizer for GitHub's body_html. GitHub already sanitizes it;
 * we sanitize again because the HTML is injected into a page we don't control
 * and a forge bug shouldn't become an XSS on every preview.
 *
 * Allowlist-based: unknown elements are unwrapped (their text is kept),
 * dangerous ones are dropped with their content, and attributes are dropped
 * unless allowlisted with a safe value.
 */

const KEEP = new Set([
  'A', 'ABBR', 'B', 'BLOCKQUOTE', 'BR', 'CODE', 'DD', 'DEL', 'DETAILS', 'DIV', 'DL', 'DT', 'EM',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'I', 'IMG', 'INS', 'KBD', 'LI', 'OL', 'P', 'PRE', 'Q',
  'S', 'SPAN', 'STRONG', 'SUB', 'SUMMARY', 'SUP', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD',
  'TR', 'UL',
]);

const DROP = new Set([
  'SCRIPT', 'STYLE', 'IFRAME', 'FRAME', 'FRAMESET', 'OBJECT', 'EMBED', 'APPLET', 'SVG', 'MATH',
  'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'OPTION', 'TEMPLATE', 'LINK', 'META', 'BASE',
  'NOSCRIPT', 'AUDIO', 'VIDEO', 'SOURCE', 'TRACK', 'CANVAS', 'DIALOG', 'PORTAL',
]);

const ATTRS: Record<string, readonly string[]> = {
  A: ['href', 'title'],
  IMG: ['src', 'alt', 'title', 'width', 'height'],
  TD: ['align'],
  TH: ['align'],
  OL: ['start'],
  DETAILS: ['open'],
};

function safeUrl(value: string, images: boolean): string | null {
  // Images must be absolute https (GitHub proxies them through camo); a
  // relative src would resolve against the preview host.
  if (images && !/^https:\/\//i.test(value.trim())) return null;
  try {
    const url = new URL(value, 'https://github.com/');
    if (url.protocol === 'https:') return url.href;
    if (!images && (url.protocol === 'http:' || url.protocol === 'mailto:')) return url.href;
  } catch {
    // fall through
  }
  return null;
}

export function sanitize(html: string): DocumentFragment {
  // <template> content is inert: no scripts run and no images load while we work.
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  clean(tpl.content);
  return tpl.content;
}

function clean(parent: ParentNode): void {
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) continue;
    if (node.nodeType !== Node.ELEMENT_NODE) {
      node.remove(); // comments, processing instructions
      continue;
    }
    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (DROP.has(tag)) {
      el.remove();
      continue;
    }
    clean(el);
    if (!KEEP.has(tag)) {
      el.replaceWith(...Array.from(el.childNodes));
      continue;
    }
    const allowed = ATTRS[tag] ?? [];
    for (const attr of Array.from(el.attributes)) {
      if (!allowed.includes(attr.name)) el.removeAttribute(attr.name);
    }
    if (tag === 'A') {
      const href = el.getAttribute('href');
      const safe = href ? safeUrl(href, false) : null;
      if (safe) el.setAttribute('href', safe);
      else el.removeAttribute('href');
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer nofollow');
    }
    if (tag === 'IMG') {
      const src = el.getAttribute('src');
      const safe = src ? safeUrl(src, true) : null;
      if (!safe) {
        el.remove();
        continue;
      }
      el.setAttribute('src', safe);
      el.setAttribute('loading', 'lazy');
      el.setAttribute('referrerpolicy', 'no-referrer');
    }
  }
}

/** Removes the "📌 Pinned on … · preview-pins" footer we append to every comment. */
export function stripFooter(fragment: DocumentFragment): DocumentFragment {
  for (const p of Array.from(fragment.querySelectorAll('p'))) {
    const sub = p.querySelector('sub');
    const text = p.textContent;
    if (sub && p.children.length === 1 && /preview-pins\s*$/.test(text.trim())) p.remove();
  }
  return fragment;
}
