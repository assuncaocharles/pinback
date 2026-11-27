/**
 * Styles live inside the shadow root, so host page CSS cannot leak in and
 * ours cannot leak out. `all: initial` on :host also stops inherited
 * properties (font, color, line-height) from bleeding through.
 */
export const styles = /* css */ `
:host {
  all: initial;
  --pp-bg: #ffffff;
  --pp-fg: #1f2328;
  --pp-muted: #59636e;
  --pp-border: #d1d9e0;
  --pp-accent: #0969da;
  --pp-accent-fg: #ffffff;
  --pp-focus: #0969da;
  --pp-radius: 10px;
  --pp-shadow: 0 8px 24px rgba(31, 35, 40, 0.15);
  --pp-duration: 120ms;
  position: fixed;
  inset: auto 16px 16px auto;
  z-index: 2147483000;
  font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: var(--pp-fg);
}
@media (prefers-color-scheme: dark) {
  :host {
    --pp-bg: #151b23;
    --pp-fg: #f0f6fc;
    --pp-muted: #9198a1;
    --pp-border: #3d444d;
    --pp-accent: #4493f8;
    --pp-accent-fg: #0d1117;
    --pp-focus: #4493f8;
    --pp-shadow: 0 8px 24px rgba(1, 4, 9, 0.6);
  }
}
@media (prefers-reduced-motion: reduce) {
  :host { --pp-duration: 0ms; }
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  background: var(--pp-bg);
  border: 1px solid var(--pp-border);
  border-radius: var(--pp-radius);
  box-shadow: var(--pp-shadow);
}
button {
  font: inherit;
  color: inherit;
  background: transparent;
  border: 0;
  border-radius: 6px;
  padding: 6px 10px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: background-color var(--pp-duration) ease;
}
button:hover { background: color-mix(in srgb, var(--pp-fg) 8%, transparent); }
button:focus-visible { outline: 2px solid var(--pp-focus); outline-offset: 2px; }
button[aria-pressed="true"] { background: var(--pp-accent); color: var(--pp-accent-fg); }
.count {
  min-width: 1.5em;
  padding: 0 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--pp-fg) 12%, transparent);
  font-size: 12px;
  text-align: center;
}
.status { color: var(--pp-muted); font-size: 12px; padding: 0 6px; }
.sr-only {
  position: absolute; width: 1px; height: 1px; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap;
}
`;
