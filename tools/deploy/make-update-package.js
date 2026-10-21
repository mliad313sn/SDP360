#!/usr/bin/env node
'use strict';
// Step 5 — build the versioned update package CI ships (and the installer/manager apply):
//
//   node tools/deploy/make-update-package.js [--out dist/] [--version X] [--commit SHA]
//
// Contents: every tracked RUNTIME file (git ls-files minus the dev-only prefixes below) at
// its repo-relative path under files/, plus manifest.json (sha256 + size per file, SemVer
// version, commit, build date). The zip is FULL, never a delta: the "frozen lot" register
// and the marker-diff packager of v1 are retired — an installation is reconciled against a
// manifest, not against a memory of what was shipped. Install state (.env, data/, logs/,
// node_modules/) is never in a package (services/updatePackage.PROTECTED).
//
// Signing (E1): when the env var SIGNING_MANIFEST_KEY holds the Ed25519 private key (PKCS8 PEM,
// a CI secret — never a file in the repo, never printed), manifest.json carries an Ed25519
// signature the Manager verifies against tools/manifest-public.pem before applying. Without
// the key the manifest is built UNSIGNED and the log says so loudly; the Manager will then
// refuse the package unless the operator passes --allow-unsigned. Authenticode on Setup.exe
// is a separate step in release.yml (certificate secrets).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const JSZip = require('jszip');
const pkgSvc = require('../../services/updatePackage');

const ROOT = path.resolve(__dirname, '..', '..');

// Dev-only paths: never on a server.
const EXCLUDE_PREFIXES = [
  'docs/', 'tests/', 'iis/', '.github/', 'tools/deploy/', 'tools/installer-build/', 'tools/installer-v2/',
  'tools/docs/', 'tools/build/', 'tools/exec-pptx/fixtures/', 'tools/exec-pptx/refs/', 'prod-snapshot/',
  'public/dashboard-preview/', 'public/design-system/', 'tools/installer/tests/', 'tools/dev/',
];
const EXCLUDE_FILES = new Set([
  '.gitignore', '.gitattributes', '.editorconfig', 'CLAUDE.md', 'CHANGELOG.md', 'README.md', 'DOTENV.example',
  'package-lock.json', 'nodemon.json', '_deploy.cmd', 'Dockerfile', 'docker-compose.yml',
  '_audit_tracker_dualwrite.js', 'tools/exec-pptx/_mk_qa_fixture.py', 'tools/md_to_docx_cr.py',
]);
// Prebuilt front-end bundles (esbuild output). They are committed, but a package built from a
// working tree must also carry a fresh local build — and refuse to build without one.
const BUNDLES = ['public/activity-tracker/dist/app.js'];

function listRuntimeFiles(root = ROOT) {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString('utf8').split('\0').filter(Boolean);
  return out.filter(p => {
    if (EXCLUDE_FILES.has(p)) return false;
    if (EXCLUDE_PREFIXES.some(x => p.startsWith(x))) return false;
    if (pkgSvc.isProtected(p)) return false;
    if (/\.(md)$/i.test(p) && !p.startsWith('public/')) return false;   // design docs anywhere else
    return true;
  }).sort();
}

async function buildPackage({ outDir, version, commit, root = ROOT, log = console.log, signingKey = process.env.SIGNING_MANIFEST_KEY }) {
  const names = new Set(listRuntimeFiles(root));
  for (const b of BUNDLES) {
    if (!fs.existsSync(path.join(root, b))) throw new Error(`missing front-end bundle ${b} — run "npm run build" first`);
    names.add(b);
  }
  const files = [...names].sort().map(p => ({ path: p, data: fs.readFileSync(path.join(root, p)) }));
  // package-lock IS needed to `npm ci --omit=dev` on the server — ship it explicitly.
  files.push({ path: 'package-lock.json', data: fs.readFileSync(path.join(root, 'package-lock.json')) });
  let manifest = pkgSvc.buildManifest(files, { version, commit });
  let signed = false;
  if (signingKey && String(signingKey).trim()) {
    manifest = pkgSvc.signManifest(manifest, String(signingKey).trim());   // key is used, never logged
    signed = true;
  }
  const zip = new JSZip();
  for (const f of files) zip.file('files/' + f.path, f.data);
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  fs.mkdirSync(outDir, { recursive: true });
  const name = `sdp-dashboard-${version}.zip`;
  const out = path.join(outDir, name);
  fs.writeFileSync(out, buf);
  fs.writeFileSync(path.join(outDir, name + '.sha256'), pkgSvc.sha256(buf) + '  ' + name + '\n');
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  log(`[package] ${name}: ${files.length} files, ${(buf.length / 1048576).toFixed(1)} MB, commit ${commit || '?'}`);
  log(signed ? `[package] manifest signed (ed25519, key ${manifest.signature.key_id})` : '[package] manifest NOT signed — SIGNING_MANIFEST_KEY is not set; the Manager will refuse this package without --allow-unsigned');
  return { out, manifest, count: files.length, bytes: buf.length, signed };
}

function argValue(flag, def) { const i = process.argv.indexOf(flag); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def; }

if (require.main === module) {
  const version = argValue('--version', require(path.join(ROOT, 'package.json')).version);
  let commit = argValue('--commit', null);
  if (!commit) { try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim(); } catch (_) { commit = null; } }
  buildPackage({ outDir: path.resolve(argValue('--out', 'dist')), version, commit })
    .catch(e => { console.error('[package] FAILED:', e.message); process.exit(1); });
}

module.exports = { listRuntimeFiles, buildPackage, EXCLUDE_PREFIXES };
