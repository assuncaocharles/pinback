import type { FrameConfig } from '../types.js';
import { FrameServer } from './frame-server.js';

const config = JSON.parse(document.getElementById('pp-data')?.textContent ?? '{}') as FrameConfig;

if (window.parent === window) {
  document.body.textContent = 'This page is the preview-pins auth frame. It only works when embedded by the widget.';
} else {
  const server = new FrameServer({
    config,
    storage: window.localStorage,
    fetch: window.fetch.bind(window),
    workerOrigin: window.location.origin,
    parent: window.parent,
    post: (message, targetOrigin) => {
      window.parent.postMessage(message, targetOrigin);
    },
  });
  window.addEventListener('message', server.handle);
  window.addEventListener('storage', server.onStorage);
}
