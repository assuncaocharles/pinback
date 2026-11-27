# Releasing

Packages are versioned with [Changesets](https://github.com/changesets/changesets)
and published to npm under `@assuncaocharles`:

| Package | npm |
| --- | --- |
| Widget | `@assuncaocharles/pinback` |
| Core | `@assuncaocharles/pinback-core` |
| Vite source plugin | `@assuncaocharles/pinback-source-plugin` |

## Day to day

1. In a PR that changes a published package, run `pnpm changeset`, pick the
   bump, and describe the change.
2. When it merges, the **Release** workflow opens or updates a **Version
   Packages** PR with the version bumps and changelogs.
3. Merging that PR publishes the new versions, with provenance, and tags
   them.

`pnpm release:dry-run` packs everything and runs `npm publish --dry-run`
locally.

## One-time setup

- Repository variable **`NPM_PUBLISH=true`** turns publishing on. Without it,
  the workflow only maintains the Version Packages PR.
- **Settings → Actions → General → "Allow GitHub Actions to create and
  approve pull requests"** must be on for the Version Packages PR.

### Trusted publishing (no token)

The workflow publishes with npm trusted publishing (OIDC), so no npm token
is stored in GitHub. npm only offers trusted-publisher settings for packages
that already exist, so the first release is bootstrapped once:

1. Create a **granular** npm token with read and write access to the
   `@assuncaocharles` scope, with a short expiry (e.g. 1 day). Save it as the
   repository secret `NPM_TOKEN`.
2. Merge the first Version Packages PR. The packages are published with the
   token.
3. On npmjs.com, open each of the three packages → **Settings → Trusted
   publisher** → GitHub Actions: repository `assuncaocharles/pinback`,
   workflow `release.yml`.
4. Delete the token on npm and remove the `NPM_TOKEN` secret. Later releases
   use trusted publishing only.

If the npm UI lets you add a trusted publisher before a package exists, skip
the token entirely.

## How publishing works

`scripts/publish.mjs`:

- packs each public package with `pnpm pack`, which rewrites `workspace:*`;
- publishes the tarball with `npm publish --provenance --access public`;
- skips versions already on npm, so re-runs are safe;
- then creates git tags (`changeset tag`), which the workflow pushes and
  turns into GitHub releases.
