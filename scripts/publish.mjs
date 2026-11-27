#!/usr/bin/env node
// Publishes the public workspace packages to npm (see docs/releasing.md).
//
// - Packs each package with pnpm (rewrites workspace:* to real versions),
//   then publishes the tarball with npm, which supports trusted publishing
//   (OIDC) and provenance.
// - Skips versions already on npm, so it is safe to re-run.
// - Auth: NPM_TOKEN if set (bootstrap), otherwise npm trusted publishing.
// - NPM_STAGE=1 runs `npm stage publish` instead: versions wait on npmjs.com
//   until a maintainer approves them with 2FA. Works for packages that don't
//   exist yet, and needs no 2FA-bypass token.
// - DRY_RUN=1 packs and runs `npm publish --dry-run` without publishing.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Dependencies first.
const PACKAGES = ['packages/core', 'packages/widget', 'packages/source-plugin'];
const dryRun = process.env.DRY_RUN === '1';
const stage = process.env.NPM_STAGE === '1' || process.env.NPM_STAGE === 'true';
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

/** True when this version is already waiting for approval (stage mode only). */
function staged(name, version) {
  let list;
  try {
    list = JSON.parse(run('npm', ['stage', 'list', name, '--json']) || '[]');
  } catch {
    return false;
  }
  // Tolerate either an array or an object of entries; match on version.
  const seen = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      if (v.version === version && (!v.name || v.name === name)) seen.push(v);
      Object.values(v).forEach(walk);
    }
  };
  walk(list);
  return seen.length > 0;
}

let count = 0;
for (const dir of PACKAGES) {
  const { name, version, private: isPrivate } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  if (isPrivate) continue;
  if (published(name, version)) {
    console.log(`= ${name}@${version} already on npm`);
    continue;
  }
  if (stage && !dryRun && staged(name, version)) {
    console.log(`= ${name}@${version} already staged, waiting for approval`);
    continue;
  }
  const tarball = run('pnpm', ['pack', '--pack-destination', out], { cwd: dir }).split('\n').pop();
  const args = [...(stage ? ['stage', 'publish'] : ['publish']), tarball, '--access', 'public'];
  if (dryRun) args.push('--dry-run');
  else if (process.env.GITHUB_ACTIONS) args.push('--provenance');
  execFileSync('npm', args, { stdio: 'inherit', env });
  console.log(`${dryRun ? '~' : stage ? '?' : '+'} ${name}@${version}${stage && !dryRun ? ' staged' : ''}`);
  count++;
}

if (count && !dryRun) {
  // Git tags for the changesets action to push and turn into GitHub releases.
  execFileSync('pnpm', ['changeset', 'tag'], { stdio: 'inherit', env });
}
const verb = stage ? 'Staged' : 'Published';
console.log(count ? `${verb} ${count} package(s)${dryRun ? ' (dry run)' : ''}.` : 'Nothing to publish.');
if (count && stage && !dryRun) {
  console.log('Approve them with 2FA at https://www.npmjs.com/settings/~/staged-packages (or `npm stage approve <id>`).');
}
