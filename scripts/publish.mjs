#!/usr/bin/env node
// Publishes the public workspace packages to npm (see docs/releasing.md).
//
// - Packs each package with pnpm (rewrites workspace:* to real versions),
//   then publishes the tarball with npm, which supports trusted publishing
//   (OIDC) and provenance.
// - Skips versions already on npm, so it is safe to re-run.
// - Auth: NPM_TOKEN if set (bootstrap), otherwise npm trusted publishing.
// - DRY_RUN=1 packs and runs `npm publish --dry-run` without publishing.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Dependencies first.
const PACKAGES = ['packages/core', 'packages/widget', 'packages/source-plugin'];
const dryRun = process.env.DRY_RUN === '1';
const out = mkdtempSync(join(tmpdir(), 'pinback-publish-'));

const env = { ...process.env };
if (process.env.NPM_TOKEN) {
  const rc = join(out, '.npmrc');
  writeFileSync(rc, `//registry.npmjs.org/:_authToken=${process.env.NPM_TOKEN}\n`);
  env.NPM_CONFIG_USERCONFIG = rc;
}

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], env, ...opts }).toString().trim();

function published(name, version) {
  try {
    return run('npm', ['view', `${name}@${version}`, 'version']) === version;
  } catch {
    return false; // E404: never published
  }
}

let count = 0;
for (const dir of PACKAGES) {
  const { name, version, private: isPrivate } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  if (isPrivate) continue;
  if (published(name, version)) {
    console.log(`= ${name}@${version} already on npm`);
    continue;
  }
  const tarball = run('pnpm', ['pack', '--pack-destination', out], { cwd: dir }).split('\n').pop();
  const args = ['publish', tarball, '--access', 'public'];
  if (dryRun) args.push('--dry-run');
  else if (process.env.GITHUB_ACTIONS) args.push('--provenance');
  execFileSync('npm', args, { stdio: 'inherit', env });
  console.log(`${dryRun ? '~' : '+'} ${name}@${version}`);
  count++;
}

if (count && !dryRun) {
  // Git tags for the changesets action to push and turn into GitHub releases.
  execFileSync('pnpm', ['changeset', 'tag'], { stdio: 'inherit', env });
}
console.log(count ? `Published ${count} package(s)${dryRun ? ' (dry run)' : ''}.` : 'Nothing to publish.');
