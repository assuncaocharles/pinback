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
that already exist, so the first release is bootstrapped once with
[staged publishing](https://docs.npmjs.com/staged-publishing). Staging needs
no 2FA, so an ordinary granular token works; a 2FA-bypass token is not
needed (npm is retiring their publish rights, around January 2027).

1. Create a **granular** npm token with read and write access to packages,
   with a short expiry (e.g. 1 day). Save it as the repository secret
   `NPM_TOKEN`.
2. Set the repository variable **`NPM_STAGE=true`**, then merge the Version
   Packages PR (or re-run the latest Release run). Each package is staged;
   npm creates a `0.0.0-stage` placeholder for new packages.
3. On npmjs.com, open **Staged Packages** and approve the three versions
   (one 2FA challenge for a batch). They are now live.
4. Open each package → **Settings → Trusted publisher** → GitHub Actions:
   repository `assuncaocharles/pinback`, workflow `release.yml`. Under
   allowed actions, also allow `npm publish` if releases should go live
   without approval.
5. Delete the token on npm and remove the `NPM_TOKEN` secret. If you allowed
   direct publishing, remove `NPM_STAGE` too; otherwise keep it and approve
   each release on npmjs.com.

## How publishing works

`scripts/publish.mjs`:

- packs each public package with `pnpm pack`, which rewrites `workspace:*`;
- publishes the tarball with `npm publish --provenance --access public`
  (`npm stage publish` when `NPM_STAGE` is set);
- skips versions already on npm, so re-runs are safe;
- then creates git tags (`changeset tag`), which the workflow pushes and
  turns into GitHub releases.
