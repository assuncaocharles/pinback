import { setAssetBase } from './capture-loader.js';
import { PinbackElement, TAG_NAME } from './element.js';

export { PinbackElement, TAG_NAME, type PinbackConfig } from './element.js';

export function define(): void {
  if (!customElements.get(TAG_NAME)) customElements.define(TAG_NAME, PinbackElement);
}

/**
 * Drop-in behaviour: loading the script registers the element and mounts one
 * instance if the page didn't place its own. Opt out with
 * `<script data-no-auto-mount ...>`.
 */
function autoMount(): void {
  define();
  const script = document.currentScript;
  if (script instanceof HTMLScriptElement && script.src) setAssetBase(script.src);
  if (script?.hasAttribute('data-no-auto-mount')) return;
  const mount = () => {
    if (!document.querySelector(TAG_NAME)) document.body.append(document.createElement(TAG_NAME));
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
}

if (typeof window !== 'undefined' && typeof customElements !== 'undefined') autoMount();
