# preview-pins

> Working name. Pin review comments to any element on a preview deployment.
> The comments land on the GitHub PR.

Reviewers click an element on a preview URL and leave a comment. The comment
is posted to the pull request. GitHub is the only database. The only server
piece is a small, stateless auth worker.

**Status:** M1 (read-only pins). The widget reads the PR's comments, anchors
numbered pins to elements, and shows threads, outdated pins and resolved
state. Writing comments arrives with sign-in in M2.

The comment storage format is specified in
[docs/metadata-format.md](docs/metadata-format.md).

## Packages

| Package | What it is |
| --- | --- |
| [`packages/core`](packages/core) | Framework-agnostic logic: PR context, `Backend` interface, and later anchoring, metadata and threads |
| [`packages/widget`](packages/widget) | `<preview-pins>` custom element in Shadow DOM. One script tag, under 30 KB gzip |
| [`packages/auth-worker`](packages/auth-worker) | Cloudflare Worker for GitHub App OAuth and the auth iframe. Stores nothing |
| [`packages/source-plugin`](packages/source-plugin) | Vite plugin that tags JSX with `data-pp-src` in preview builds (M4) |
| [`examples/react-vite`](examples/react-vite) | Demo app, deployed per PR to Cloudflare Pages |

## Usage (preview)

```html
<meta name="preview-pins" content="owner=acme;repo=web;pr=42;sha=0123abc...">
<script src="https://unpkg.com/@preview-pins/widget/dist/preview-pins.js" defer></script>
```

Generate the meta tag in CI from your PR number and head SHA. If it's absent,
the widget falls back to the `?pp_owner=&pp_repo=&pp_pr=&pp_sha=` query params,
then to `element.config`. See [ADR 4](docs/adr/0004-widget-shell-and-pr-context.md).

## Development

Requires Node 22.19+ and pnpm 10.

```sh
pnpm install
pnpm build            # libraries and widget
pnpm test             # Vitest, all packages
pnpm lint && pnpm typecheck
pnpm size             # widget bundle budget
pnpm build:example && pnpm e2e   # Playwright against the built demo
pnpm --filter @preview-pins/example-react-vite dev
```

Add a changeset (`pnpm changeset`) to any PR that changes a published
package.

## Decisions

See [`docs/adr/`](docs/adr).

## License

[MIT](LICENSE)
