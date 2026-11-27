/** JSON safe to embed in a <script type="application/json"> block. */
export function jsonForHtml(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function page(opts: { title: string; body: string; data?: unknown; script?: string | undefined; style?: boolean }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(opts.title)}</title>
${opts.style === false ? '' : '<style>body{font:15px/1.5 system-ui,sans-serif;margin:2rem;color:#1f2328}@media(prefers-color-scheme:dark){body{background:#0d1117;color:#f0f6fc}}</style>'}
</head>
<body>
${opts.body}
${opts.data === undefined ? '' : `<script type="application/json" id="pp-data">${jsonForHtml(opts.data)}</script>`}
${opts.script ? `<script type="module" src="${escapeHtml(opts.script)}"></script>` : ''}
</body>
</html>`;
}
