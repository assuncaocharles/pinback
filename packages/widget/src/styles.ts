/**
 * Styles live inside the shadow root, so host page CSS cannot leak in and
 * ours cannot leak out. `all: initial` on :host also stops inherited
 * properties (font, color, line-height) from bleeding through.
 *
 * The host covers the viewport with pointer-events: none; only the toolbar,
 * panel and pins take pointer events.
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
  --pp-warn-bg: #fff8c5;
  --pp-warn-fg: #7d4e00;
  --pp-focus: #0969da;
  --pp-radius: 10px;
  --pp-shadow: 0 8px 24px rgba(31, 35, 40, 0.15);
  --pp-duration: 120ms;
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  pointer-events: none;
  font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
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
    --pp-warn-bg: #3b2e00;
    --pp-warn-fg: #f2cc60;
    --pp-focus: #4493f8;
    --pp-shadow: 0 8px 24px rgba(1, 4, 9, 0.6);
  }
}
@media (prefers-reduced-motion: reduce) {
  :host { --pp-duration: 0ms; }
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
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
button:hover:not(:disabled) { background: color-mix(in srgb, var(--pp-fg) 8%, transparent); }
button:disabled { opacity: .55; cursor: not-allowed; }
:focus-visible { outline: 2px solid var(--pp-focus); outline-offset: 2px; }
a { color: var(--pp-accent); }
.muted { color: var(--pp-muted); font-size: 12px; }
.sr-only {
  position: absolute; width: 1px; height: 1px; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap;
}

/* Dock: toolbar + list panel, bottom right. */
.dock {
  position: absolute;
  right: 16px;
  bottom: 16px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  max-width: calc(100vw - 32px);
}
.toolbar, .panel {
  pointer-events: auto;
  background: var(--pp-bg);
  border: 1px solid var(--pp-border);
  border-radius: var(--pp-radius);
  box-shadow: var(--pp-shadow);
}
.toolbar { display: flex; align-items: center; gap: 4px; padding: 4px; }
button[aria-pressed="true"], button[aria-expanded="true"] { background: var(--pp-accent); color: var(--pp-accent-fg); }
.count {
  min-width: 1.5em;
  padding: 0 6px;
  border-radius: 999px;
  background: color-mix(in srgb, currentColor 14%, transparent);
  font-size: 12px;
  text-align: center;
}
.status { color: var(--pp-muted); font-size: 12px; padding: 0 6px; }
.status.error { color: var(--pp-warn-fg); }

.panel { width: 340px; max-width: 100%; max-height: min(60vh, 480px); overflow: auto; padding: 8px; }
.panel h3 { margin: 8px 8px 4px; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--pp-muted); }
.panel .hint { margin: 0 8px 4px; font-size: 12px; color: var(--pp-muted); }
.panel ul { list-style: none; margin: 0; padding: 0; }
.panel .empty { margin: 12px 8px; color: var(--pp-muted); }
.item { width: 100%; text-align: left; align-items: flex-start; padding: 8px; }
.item .text { display: flex; flex-direction: column; min-width: 0; }
.item .excerpt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.num, .pin {
  flex: none;
  display: inline-grid;
  place-items: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border-radius: 50% 50% 50% 4px;
  background: var(--pp-accent);
  color: var(--pp-accent-fg);
  font-size: 12px;
  font-weight: 600;
}

/* Pins */
.layer { position: absolute; inset: 0; overflow: hidden; }
.pin {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: auto;
  box-shadow: 0 0 0 2px var(--pp-bg), var(--pp-shadow);
  will-change: transform;
}
.pin:hover { background: var(--pp-accent); filter: brightness(1.1); }
.pin.approx { background: var(--pp-bg); color: var(--pp-accent); outline: 2px dashed var(--pp-accent); outline-offset: -2px; }

/* Thread dialog */
dialog.thread {
  /* The host is pointer-events: none so the page stays clickable; dialogs must opt back in. */
  pointer-events: auto;
  position: fixed;
  margin: 0;
  inset: auto;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: min(380px, calc(100vw - 32px));
  max-height: min(70vh, 560px);
  overflow: auto;
  padding: 0;
  color: var(--pp-fg);
  background: var(--pp-bg);
  border: 1px solid var(--pp-border);
  border-radius: var(--pp-radius);
  box-shadow: var(--pp-shadow);
  font: inherit;
}
@media (max-width: 559px) {
  dialog.thread { left: 16px; right: 16px; top: auto; bottom: 16px; width: auto; transform: none; }
}
dialog.thread::backdrop { background: rgba(0, 0, 0, 0.12); }
dialog.thread header { display: flex; align-items: center; justify-content: space-between; padding: 8px 8px 0 16px; }
dialog.thread h2 { margin: 0; font-size: 15px; }
dialog.thread h2:focus { outline: none; }
.icon { font-size: 20px; line-height: 1; padding: 4px 10px; }
.badges { display: flex; gap: 6px; flex-wrap: wrap; padding: 4px 16px 0; }
.badges:empty { display: none; }
.badge { font-size: 12px; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--pp-border); }
.badge.warn { background: var(--pp-warn-bg); color: var(--pp-warn-fg); border-color: transparent; }
.comments { list-style: none; margin: 0; padding: 8px 16px; }
.comments li + li { border-top: 1px solid var(--pp-border); }
.comments li { padding: 8px 0; }
.comments .meta { display: flex; align-items: center; gap: 6px; font-size: 13px; }
.comments time { color: var(--pp-muted); font-size: 12px; }
.avatar { border-radius: 50%; }
.body { overflow-wrap: anywhere; }
.body > :first-child { margin-top: 4px; }
.body > :last-child { margin-bottom: 0; }
.body img { max-width: 100%; height: auto; }
.body pre { overflow: auto; padding: 8px; border-radius: 6px; background: color-mix(in srgb, var(--pp-fg) 6%, transparent); }
.body code { font-size: 12px; }
.body blockquote { margin: 0; padding-left: 10px; border-left: 3px solid var(--pp-border); color: var(--pp-muted); }
dialog.thread footer {
  display: flex; justify-content: space-between; align-items: center; gap: 8px;
  padding: 8px 16px 12px; border-top: 1px solid var(--pp-border); font-size: 13px;
}

/* Auth frame: present but invisible. */
.auth-frame { position: absolute; width: 0; height: 0; border: 0; visibility: hidden; }

/* Comment-mode outline */
.outline {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
  border: 2px solid var(--pp-accent);
  border-radius: 4px;
  background: color-mix(in srgb, var(--pp-accent) 10%, transparent);
  transition: transform var(--pp-duration) ease, width var(--pp-duration) ease, height var(--pp-duration) ease;
}

/* Buttons */
button.primary { background: var(--pp-accent); color: var(--pp-accent-fg); font-weight: 600; }
button.primary:hover:not(:disabled) { background: var(--pp-accent); filter: brightness(1.08); }
button.secondary { border: 1px solid var(--pp-border); }
button.link { padding: 2px 4px; color: var(--pp-accent); text-decoration: underline; }

/* Composer */
.reply { padding: 8px 16px 4px; border-top: 1px solid var(--pp-border); }
.composer-dialog .reply { border-top: 0; }
.target { margin: 0 0 8px; }
.composer { display: flex; flex-direction: column; gap: 6px; margin: 0; }
.tabs { display: flex; gap: 2px; }
.tabs [role="tab"] { padding: 4px 10px; font-size: 13px; }
.tabs [role="tab"][aria-selected="true"] { background: color-mix(in srgb, var(--pp-fg) 10%, transparent); font-weight: 600; }
textarea {
  display: block;
  width: 100%;
  min-height: 84px;
  resize: vertical;
  font: inherit;
  color: inherit;
  background: var(--pp-bg);
  border: 1px solid var(--pp-border);
  border-radius: 6px;
  padding: 8px;
}
textarea:focus-visible { outline: 2px solid var(--pp-focus); outline-offset: 0; border-color: transparent; }
.preview { min-height: 84px; padding: 8px; border: 1px dashed var(--pp-border); border-radius: 6px; }
.composer .muted { margin: 0; }
.error { margin: 0; color: var(--pp-warn-fg); font-size: 13px; }
.error:empty { display: none; }
.actions { display: flex; justify-content: flex-end; gap: 8px; }

/* Account row in the list panel */
.account {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  margin-top: 8px; padding: 8px 8px 2px; border-top: 1px solid var(--pp-border);
}
`;
