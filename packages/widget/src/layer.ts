import { ANCHOR_APPROXIMATE, ANCHOR_THRESHOLD, AnchorIndex, matchAnchor, pinPosition, type Thread } from '@preview-pins/core';
import { h } from './dom.js';

interface Pin {
  thread: Thread;
  button: HTMLButtonElement;
  target: Element | null;
  /** Matched, but with low confidence or a near-tie: shown dashed and labelled. */
  approximate: boolean;
}

export interface LayerCallbacks {
  onOpen(thread: Thread, invoker: HTMLElement): void;
  /** Called when the set of anchored/outdated threads changes. */
  onAnchorsChange(): void;
}

const PIN_SIZE = 26;

/**
 * Renders numbered pin markers over the page. Anchors are resolved when
 * threads change and when the page's DOM mutates (SPAs render late and
 * re-render often). Positions update in one rAF per frame at most: read
 * every target's rect first, then write every transform, so we never
 * interleave layout reads and style writes.
 */
export class PinLayer {
  readonly element: HTMLDivElement;
  #pins = new Map<string, Pin>();
  #frame = 0;
  #reanchorQueued = false;
  #observer: MutationObserver | null = null;
  readonly #host: Element;
  readonly #cb: LayerCallbacks;

  constructor(host: Element, cb: LayerCallbacks) {
    this.#host = host;
    this.#cb = cb;
    this.element = h('div', { class: 'layer' });
  }

  connect(): void {
    window.addEventListener('scroll', this.#schedule, { capture: true, passive: true });
    window.addEventListener('resize', this.#schedule, { passive: true });
    this.#observer = new MutationObserver(this.#onMutations);
    this.#observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
  }

  disconnect(): void {
    window.removeEventListener('scroll', this.#schedule, { capture: true });
    window.removeEventListener('resize', this.#schedule);
    this.#observer?.disconnect();
    this.#observer = null;
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }

  /** Threads to show as pins: open threads on the current page. */
  setThreads(threads: readonly Thread[]): void {
    const next = new Set(threads.map((t) => t.id));
    for (const [id, pin] of this.#pins) {
      if (!next.has(id)) {
        pin.button.remove();
        this.#pins.delete(id);
      }
    }
    for (const thread of threads) {
      const existing = this.#pins.get(thread.id);
      if (existing) {
        existing.thread = thread;
        this.#label(existing);
        continue;
      }
      const button = h('button', { type: 'button', class: 'pin', hidden: true }, String(thread.number));
      const pin: Pin = { thread, button, target: null, approximate: false };
      button.addEventListener('click', () => {
        this.#cb.onOpen(pin.thread, button);
      });
      this.#label(pin);
      this.#pins.set(thread.id, pin);
      this.element.append(button);
    }
    this.#reanchor();
  }

  isAnchored(threadId: string): boolean {
    return !!this.#pins.get(threadId)?.target;
  }

  /** Scrolls the thread's element into view and focuses its pin. Returns false if outdated. */
  reveal(threadId: string): HTMLButtonElement | null {
    const pin = this.#pins.get(threadId);
    if (!pin?.target) return null;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    pin.target.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    this.#schedule();
    return pin.button;
  }

  #label(pin: Pin): void {
    const { number, root, replies } = pin.thread;
    const excerpt = root.text.replace(/<sub>[\s\S]*?<\/sub>/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const n = replies.length;
    pin.button.setAttribute(
      'aria-label',
      `Comment ${number} by ${root.author.login}${n ? `, ${n} ${n === 1 ? 'reply' : 'replies'}` : ''}${pin.approximate ? ' (approximate position)' : ''}: ${excerpt}`,
    );
    pin.button.classList.toggle('approx', pin.approximate);
    pin.button.title = pin.approximate ? 'The page changed since this comment; the position may be approximate.' : '';
  }

  #reanchor(): void {
    let changed = false;
    // One page scan shared by every pin in this pass (ADR 9).
    const index = this.#pins.size ? new AnchorIndex(document, this.#host) : null;
    for (const pin of this.#pins.values()) {
      const m = index ? matchAnchor(document, pin.thread.root.meta.anchor, { index }) : null;
      const target = m && m.confidence >= ANCHOR_THRESHOLD ? m.element : null;
      const approximate = !!target && !!m && (m.confidence < ANCHOR_APPROXIMATE || m.ambiguous);
      if (!!target !== !!pin.target) changed = true;
      pin.target = target;
      if (approximate !== pin.approximate) {
        pin.approximate = approximate;
        this.#label(pin);
      }
    }
    this.#schedule();
    if (changed) this.#cb.onAnchorsChange();
  }

  #onMutations = (records: MutationRecord[]): void => {
    // Ignore mutations to our own host element (e.g. attribute changes on <preview-pins>).
    if (records.every((r) => r.target === this.#host)) return;
    if (this.#reanchorQueued) return;
    this.#reanchorQueued = true;
    requestAnimationFrame(() => {
      this.#reanchorQueued = false;
      this.#reanchor();
    });
  };

  #schedule = (): void => {
    if (this.#frame) return;
    this.#frame = requestAnimationFrame(this.#position);
  };

  #position = (): void => {
    this.#frame = 0;
    const pins = [...this.#pins.values()];
    // Read phase.
    const positions = pins.map((pin) =>
      pin.target?.isConnected ? pinPosition(pin.target, pin.thread.root.meta.anchor.rect) : null,
    );
    const needsReanchor = pins.some((pin) => pin.target && !pin.target.isConnected);
    // Write phase. Pins that would land on top of an earlier one fan out to
    // the right so every marker stays visible and clickable.
    const placed: { x: number; y: number }[] = [];
    pins.forEach((pin, i) => {
      const pos = positions[i];
      if (!pos?.visible) {
        pin.button.hidden = true;
        return;
      }
      let { x } = pos;
      const { y } = pos;
      while (placed.some((p) => Math.abs(p.x - x) < PIN_SIZE - 4 && Math.abs(p.y - y) < PIN_SIZE - 4)) x += PIN_SIZE + 2;
      placed.push({ x, y });
      pin.button.hidden = false;
      pin.button.style.transform = `translate(${Math.round(x - PIN_SIZE / 2)}px, ${Math.round(y - PIN_SIZE / 2)}px)`;
    });
    if (needsReanchor) this.#reanchor();
  };
}
