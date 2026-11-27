import type { CaptureOptions } from './capture/index.js';

type CaptureModule = { captureAround(target: Element, opts: CaptureOptions): Promise<Blob> };

let assetBase: string | null = null;
let override: (() => Promise<CaptureModule>) | null = null;

/** Called with the widget script's own URL; the capture module sits next to it. */
export function setAssetBase(scriptSrc: string): void {
  assetBase = scriptSrc;
}

/** Test seam. */
export function setCaptureLoader(loader: (() => Promise<CaptureModule>) | null): void {
  override = loader;
}

/** Loads preview-pins-capture.mjs on first use (ADR 11). */
export function loadCapture(explicitUrl?: string): Promise<CaptureModule> {
  if (override) return override();
  const url = explicitUrl ?? (assetBase ? new URL('preview-pins-capture.mjs', assetBase).href : null);
  if (!url) return Promise.reject(new Error('Screenshot module location unknown; set config.captureUrl'));
  return import(/* @vite-ignore */ url) as Promise<CaptureModule>;
}
