import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { previewPinsSource } from '@preview-pins/source-plugin';

const require = createRequire(import.meta.url);

/**
 * Demonstrates the intended drop-in setup: one <script> tag for the widget
 * plus a <meta name="preview-pins"> tag built from CI env vars.
 * Outside CI there is no PR, so those fields are omitted and the widget
 * falls back to query params (?pp_owner=&pp_repo=&pp_pr=&pp_sha=).
 * PREVIEW_PINS_AUTH_ORIGIN adds `auth=` so reviewers can sign in and comment.
 */
function previewPinsDemo(): Plugin {
  const widgetPath = require.resolve('@preview-pins/widget/preview-pins.js');
  const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? '').split('/');
  const pr = process.env.PREVIEW_PINS_PR;
  const sha = process.env.PREVIEW_PINS_SHA;
  // PR fields only as a complete set: GitHub Actions always sets
  // GITHUB_REPOSITORY, and a half context would override query params.
  const complete = owner && repo && pr && sha;
  const fields: Record<string, string | undefined> = {
    ...(complete ? { owner, repo, pr, sha } : {}),
    // The auth worker origin enables sign-in and writing.
    auth: process.env.PREVIEW_PINS_AUTH_ORIGIN,
  };
  const pairs = Object.entries(fields).filter(([, v]) => v);
  const meta = pairs.length ? pairs.map(([k, v]) => `${k}=${v ?? ''}`).join(';') : null;

  return {
    name: 'preview-pins-demo',
    configureServer(server) {
      server.middlewares.use('/preview-pins.js', (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(readFileSync(widgetPath));
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'preview-pins.js', source: readFileSync(widgetPath) });
    },
    transformIndexHtml() {
      return [
        ...(meta ? [{ tag: 'meta', attrs: { name: 'preview-pins', content: meta }, injectTo: 'head' as const }] : []),
        { tag: 'script', attrs: { src: '/preview-pins.js', defer: true }, injectTo: 'body' as const },
      ];
    },
  };
}

export default defineConfig({
  plugins: [previewPinsSource(), react(), previewPinsDemo()],
});
