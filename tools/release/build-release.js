'use strict';
// SDP-DASH-2.0 step 5 (lot 5.6, ADR-003) — build a release package: the COMPLETE application tree at the
// current commit, production node_modules, and manifest.json (every file with its SHA-256).
//
//   node tools/release/build-release.js [--version 2.5.0] [--out dist/release] [--no-deps]
//
// Run by .github/workflows/release.yml on windows-latest (the better-sqlite3 binding must match prod:
// Windows x64, Node 24). --no-deps skips `npm ci` (local dry run). Nothing here touches production:
// applying a package is the Manager's job (installer v2, waits on DEC-1 / DEC-2).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { buildManifest, verifyTree, MANIFEST } = require('../../services/releaseManifest');

const ROOT = path.join(__dirname, '..', '..');

// Tracked paths that never belong in a release (dev-only). Same spirit as make-deploy-zip.ps1.
const EXCLUDE = [
  /^\.github\//, /^\.claude\//, /^docs\//, /^tests\//, /^iis\//, /^prod-snapshot\//,
  /^tools\/deploy\//, /^tools\/installer-build\//, /^tools\/installer\/tests\//,
  /^tools\/exec-pptx\/(fixtures|refs)\//, /^tools\/exec-pptx\/INTEGRATION_/,
  /^_deploy\.cmd$/, /^_apply_on_prod\.cmd$/, /^sdp-deploy_.*\.zip$/, /\.jsx$/,
];
const isShipped = (p) => !EXCLUDE.some(re => re.test(p));

function args(argv) {
  const a = { out: path.join(ROOT, 'dist', 'release'), deps: true, version: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') a.out = path.resolve(argv[++i]);
    else if (argv[i] === '--version') a.version = argv[++i];
    else if (argv[i] === '--no-deps') a.deps = false;
  }
  return a;
}

function git(...a) { return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim(); }

function resolveVersion(explicit) {
  const tag = explicit || process.env.RELEASE_VERSION || '';
  const v = tag.replace(/^v/, '');
  if (v) {
    if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(v)) throw new Error(`version "${tag}" is not SemVer (expected v2.5.0)`);
    return v;
  }
  return require('../../package.json').version + '-dev';
}

function main(argv) {
  const a = args(argv);
  const version = resolveVersion(a.version);
  const commit = git('rev-parse', '--short', 'HEAD');
  const stage = path.join(a.out, `sdp-dashboard-${version}`);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });

  const files = git('ls-files', '-z').split('\0').filter(Boolean).filter(isShipped);
  for (const f of files) {
    const src = path.join(ROOT, f);
    if (!fs.existsSync(src)) continue;          // deleted in the working tree
    const dst = path.join(stage, f);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  console.log(`[release] ${files.length} tracked files staged → ${stage}`);

  if (a.deps) {
    execFileSync('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: stage, stdio: 'inherit', shell: process.platform === 'win32' });
    // The native binding must load from the package, exactly as prod will load it.
    execFileSync(process.execPath, ['-e', "require('./node_modules/better-sqlite3')(':memory:').prepare('select 1').get()"], { cwd: stage, stdio: 'inherit' });
  }

  const manifest = buildManifest(stage, {
    name: 'sdp-dashboard', version, commit, built_at: new Date().toISOString(),
    node_major: Number(process.versions.node.split('.')[0]),
  });
  fs.writeFileSync(path.join(stage, MANIFEST), JSON.stringify(manifest, null, 2) + '\n');
  const v = verifyTree(stage);
  if (!v.ok) throw new Error('package does not verify:\n  ' + v.errors.join('\n  '));
  console.log(`[release] sdp-dashboard ${version} (${commit}) — ${manifest.files.length} files, ` +
    `${manifest.node_modules ? manifest.node_modules.count : 0} dependency files, ${manifest.migrations.length} migrations — verified`);
  return stage;
}

module.exports = { EXCLUDE, isShipped, resolveVersion, main };
if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (e) { console.error('[release] ' + e.message); process.exit(1); }
}
