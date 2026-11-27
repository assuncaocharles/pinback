import { normaliseText } from '@preview-pins/core';
import { h } from './dom.js';

export interface PickerCallbacks {
  onPick(element: Element, point: { x: number; y: number } | undefined): void;
  announce(message: string): void;
}

const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'HEAD', 'META', 'LINK']);

export function describeTarget(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute('role');
  const text = normaliseText(el.getAttribute('aria-label') ?? el.textContent).slice(0, 40);
  return `${role ?? tag}${text ? ` “${text}”` : ''}`;
}

/**
 * Comment mode's element picker.
 *
 * Pointer: hovering outlines the element under the cursor; clicking picks it.
 * Page handlers never see the click (captured and stopped at the document).
 *
 * Keyboard: arrow keys walk the DOM (Down = first child, Up = parent,
 * Left/Right = siblings) starting from <main>; Enter picks. Tabbing to a
 * focusable page element highlights it too. Escape is handled by the element.
 */
export class Picker {
  readonly outline: HTMLDivElement;
  #active = false;
  #current: Element | null = null;
  #byKeyboard = false;
  #frame = 0;
  #cursorStyle: HTMLStyleElement | null = null;
  readonly #host: Element;
  readonly #cb: PickerCallbacks;

  constructor(host: Element, cb: PickerCallbacks) {
    this.#host = host;
    this.#cb = cb;
    this.outline = h('div', { class: 'outline', hidden: true });
  }

  get active(): boolean {
    return this.#active;
  }

  enable(): void {
    if (this.#active) return;
    this.#active = true;
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'pointerup', 'click'] as const) {
      document.addEventListener(type, this.#swallow, true);
    }
    document.addEventListener('pointermove', this.#onMove, { capture: true, passive: true });
    document.addEventListener('focusin', this.#onFocus, true);
    document.addEventListener('keydown', this.#onKey, true);
    window.addEventListener('scroll', this.#schedule, { capture: true, passive: true });
    window.addEventListener('resize', this.#schedule, { passive: true });
    this.#cursorStyle = document.createElement('style');
    this.#cursorStyle.setAttribute('data-preview-pins', '');
    this.#cursorStyle.textContent = '*{cursor:crosshair!important}';
    document.head.append(this.#cursorStyle);
    this.#cb.announce('Comment mode on. Click an element, or use arrow keys to choose one and press Enter. Escape cancels.');
  }

  disable(): void {
    if (!this.#active) return;
    this.#active = false;
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'pointerup', 'click'] as const) {
      document.removeEventListener(type, this.#swallow, true);
    }
    document.removeEventListener('pointermove', this.#onMove, { capture: true });
    document.removeEventListener('focusin', this.#onFocus, true);
    document.removeEventListener('keydown', this.#onKey, true);
    window.removeEventListener('scroll', this.#schedule, { capture: true });
    window.removeEventListener('resize', this.#schedule);
    this.#cursorStyle?.remove();
    this.#cursorStyle = null;
    this.#set(null);
    this.#byKeyboard = false;
  }

  #isOurs(event: Event): boolean {
    return event.composedPath().includes(this.#host);
  }

  #pageTarget(event: Event): Element | null {
    const t = event.composedPath()[0];
    return t instanceof Element && !this.#isOurs(event) ? t : null;
  }

  #swallow = (event: Event): void => {
    if (this.#isOurs(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type !== 'click') return;
    const target = this.#pageTarget(event);
    if (!target) return;
    const m = event as MouseEvent;
    this.#cb.onPick(target, { x: m.clientX, y: m.clientY });
  };

  #onMove = (event: PointerEvent): void => {
    this.#byKeyboard = false;
    this.#set(this.#pageTarget(event));
  };

  #onFocus = (event: FocusEvent): void => {
    const t = this.#pageTarget(event);
    if (t && t !== document.body) this.#set(t, true);
  };

  #onKey = (event: KeyboardEvent): void => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    // Let people type in our dialogs and in page text fields.
    const origin = event.composedPath()[0];
    if (origin instanceof HTMLElement && (origin.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(origin.tagName))) return;
    const inWidget = this.#isOurs(event);
    if (inWidget && !this.#byKeyboard && event.key === 'Enter') return; // toggle button etc.

    let next: Element | null | undefined;
    switch (event.key) {
      case 'ArrowDown':
        next = this.#current ? firstChild(this.#current, this.#host) : start(this.#host);
        break;
      case 'ArrowUp':
        next = this.#current ? parent(this.#current) : start(this.#host);
        break;
      case 'ArrowRight':
        next = this.#current ? sibling(this.#current, 1, this.#host) : start(this.#host);
        break;
      case 'ArrowLeft':
        next = this.#current ? sibling(this.#current, -1, this.#host) : start(this.#host);
        break;
      case 'Enter':
        if (!this.#current) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        this.#cb.onPick(this.#current, undefined);
        return;
      default:
        return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (next) {
      this.#byKeyboard = true;
      this.#set(next, true);
      next.scrollIntoView({ block: 'nearest' });
    }
  };

  #set(el: Element | null, announce = false): void {
    if (el === this.#current) return;
    this.#current = el;
    if (announce && el) this.#cb.announce(describeTarget(el));
    this.#schedule();
  }

  #schedule = (): void => {
    if (this.#frame) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      const el = this.#current;
      if (!el?.isConnected) {
        this.outline.hidden = true;
        return;
      }
      const r = el.getBoundingClientRect();
      Object.assign(this.outline.style, {
        transform: `translate(${Math.round(r.left)}px, ${Math.round(r.top)}px)`,
        width: `${Math.round(r.width)}px`,
        height: `${Math.round(r.height)}px`,
      });
      this.outline.hidden = false;
    });
  };
}

function usable(el: Element | null | undefined, host: Element): boolean {
  return !!el && el !== host && !SKIP.has(el.tagName);
}

function start(host: Element): Element | null {
  const main = document.querySelector('main');
  if (main && usable(main, host)) return main;
  return Array.from(document.body.children).find((c) => usable(c, host)) ?? null;
}

function firstChild(el: Element, host: Element): Element | null {
  return Array.from(el.children).find((c) => usable(c, host)) ?? null;
}

function parent(el: Element): Element | null {
  const p = el.parentElement;
  return p && p !== document.body && p !== document.documentElement ? p : null;
}

function sibling(el: Element, dir: 1 | -1, host: Element): Element | null {
  let s = dir === 1 ? el.nextElementSibling : el.previousElementSibling;
  while (s && !usable(s, host)) s = dir === 1 ? s.nextElementSibling : s.previousElementSibling;
  return s;
}
