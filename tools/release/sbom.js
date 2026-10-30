#!/usr/bin/env node
'use strict';
// G03 — Software Bill of Materials (CycloneDX 1.5 JSON) generated from what is shipped: production packages
// of package-lock.json (with their lockfile integrity hash and licence) plus the components Setup.exe embeds
// or pages load from a CDN (tools/release/licence-inventory.js BUNDLED). Deterministic: no timestamp unless
// --timestamp is given, so the file only changes when the shipped set changes.
// Usage: node tools/release/sbom.js [--out dist/sbom.cdx.json] [--timestamp]
const fs = require('fs');
const path = require('path');
const { BUNDLED } = require('./licence-inventory');

const ROOT = path.resolve(__dirname, '..', '..');
const arg = (f) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : null; };

// "sha512-<base64>" → CycloneDX hash { alg: 'SHA-512', content: <hex> }
function hashOf(integrity) {
  const m = /^(sha512|sha384|sha256|sha1)-(.+)$/.exec(String(integrity || ''));
  if (!m) return [];
  const alg = { sha512: 'SHA-512', sha384: 'SHA-384', sha256: 'SHA-256', sha1: 'SHA-1' }[m[1]];
  return [{ alg, content: Buffer.from(m[2], 'base64').toString('hex') }];
}
const purl = (name, version) => 'pkg:npm/' + name.replace(/^@/, '%40') + '@' + encodeURIComponent(version);

function build({ timestamp = false } = {}) {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const components = [];
  for (const [p, v] of Object.entries(lock.packages || {})) {
    if (!p.startsWith('node_modules/') || v.dev) continue;
    const name = p.replace(/^.*node_modules\//, '');
    const c = { type: 'library', 'bom-ref': purl(name, v.version || ''), name, version: v.version || '', purl: purl(name, v.version || '') };
    if (v.license) c.licenses = [{ expression: v.license }];
    const h = hashOf(v.integrity); if (h.length) c.hashes = h;
    if (v.resolved && !/registry\.npmjs\.org/.test(v.resolved)) c.externalReferences = [{ type: 'distribution', url: v.resolved }];
    components.push(c);
  }
  for (const b of BUNDLED) components.push({ type: /runtime|PostgreSQL|IIS|\.NET/.test(b.name) ? 'platform' : 'library', 'bom-ref': 'bundled:' + b.name, name: b.name, version: b.version, licenses: [{ license: { name: b.licence } }], properties: [{ name: 'sdp360:delivery', value: b.how }, { name: 'sdp360:legal_review', value: b.review }] });
  components.sort((a, b) => a['bom-ref'].localeCompare(b['bom-ref']));
  const bom = { bomFormat: 'CycloneDX', specVersion: '1.5', version: 1,
    metadata: { component: { type: 'application', 'bom-ref': 'pkg:npm/' + pkg.name + '@' + pkg.version, name: pkg.name, version: pkg.version }, tools: [{ name: 'tools/release/sbom.js' }] },
    components };
  if (timestamp) bom.metadata.timestamp = new Date().toISOString();
  return bom;
}

if (require.main === module) {
  const bom = build({ timestamp: process.argv.includes('--timestamp') });
  const out = arg('--out');
  const text = JSON.stringify(bom, null, 1) + '\n';
  if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, text); console.log(`sbom: ${bom.components.length} components → ${out}`); }
  else process.stdout.write(text);
}
module.exports = { build, hashOf, purl };
