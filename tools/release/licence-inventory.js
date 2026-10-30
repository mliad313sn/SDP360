#!/usr/bin/env node
'use strict';
// EX-09 — third-party licence inventory, generated from what is really shipped (never typed by hand):
//   - production npm packages: package-lock.json (dev dependencies excluded — they are not shipped)
//   - components Setup.exe bundles and browser libraries loaded from a CDN: BUNDLED below (one line each)
// `node tools/release/licence-inventory.js [--csv out.csv]` prints the inventory; exit 1 when a production
// package carries a licence outside ACCEPTED (a copyleft or unknown licence needs a legal look first).
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
// Permissive licences accepted for internal use without review. Anything else is listed for legal review.
const ACCEPTED = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'MIT-0', 'CC0-1.0', 'Unlicense', 'BlueOak-1.0.0', 'Python-2.0',
  '(MIT AND Zlib)', '(MIT OR GPL-3.0-or-later)', '(MIT OR Apache-2.0)']);
// Shipped with Setup.exe (tools/installer-v2/build.ps1) or loaded by pages from a CDN. Licence terms as
// published by each vendor; "review" = redistribution terms must be confirmed by Legal before any
// distribution OUTSIDE Endeavour Mining (internal installation is the use they were obtained for).
const BUNDLED = [
  { name: 'Node.js runtime (win-x64)', version: '22.x', licence: 'MIT (+ bundled third-party notices)', how: 'embedded in Setup.exe', review: 'no' },
  { name: 'PostgreSQL 17 (EnterpriseDB Windows installer)', version: '17.x', licence: 'PostgreSQL Licence (server); EDB installer terms', how: 'embedded in Setup.exe', review: 'yes — EDB installer redistribution terms' },
  { name: 'IIS URL Rewrite 2.1', version: '2.1', licence: 'Microsoft Software License Terms', how: 'embedded in Setup.exe', review: 'yes — Microsoft redistribution terms' },
  { name: 'IIS Application Request Routing 3.0', version: '3.0', licence: 'Microsoft Software License Terms', how: 'embedded in Setup.exe', review: 'yes — Microsoft redistribution terms' },
  { name: 'Inno Setup (installer engine)', version: '6.x', licence: 'Inno Setup License (free, modified BSD-style)', how: 'build tool; its runtime is inside Setup.exe', review: 'no' },
  { name: '.NET Framework 4.6.2 (service host, Manager)', version: '4.6.2', licence: 'part of Windows', how: 'not shipped — present on Windows', review: 'no' },
  { name: 'Chart.js', version: '4.4.x', licence: 'MIT', how: 'CDN (jsdelivr / cdnjs)', review: 'no' },
  { name: 'chartjs-plugin-datalabels', version: '2.2.0', licence: 'MIT', how: 'CDN', review: 'no' },
  { name: 'React / ReactDOM', version: '18.3.1', licence: 'MIT', how: 'CDN', review: 'no' },
  { name: '@babel/standalone', version: '7.29.0', licence: 'MIT', how: 'CDN (legacy pages only)', review: 'no' },
  { name: 'Libre Franklin (Google Fonts)', version: '—', licence: 'SIL Open Font License 1.1', how: 'Google Fonts', review: 'no' },
];

function npmPackages() {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const out = [];
  for (const [p, v] of Object.entries(lock.packages || {})) {
    if (!p.startsWith('node_modules/') || v.dev) continue;
    out.push({ name: p.replace(/^.*node_modules\//, ''), version: v.version || '', licence: v.license || 'UNKNOWN' });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
function inventory() {
  const npm = npmPackages();
  return { npm, bundled: BUNDLED, needs_review: npm.filter((p) => !ACCEPTED.has(p.licence)) };
}
if (require.main === module) {
  const inv = inventory();
  const counts = {}; for (const p of inv.npm) counts[p.licence] = (counts[p.licence] || 0) + 1;
  console.log(`${inv.npm.length} production npm packages:`, JSON.stringify(counts));
  console.log('bundled / CDN components:'); for (const b of inv.bundled) console.log(`  ${b.name} ${b.version} — ${b.licence} (${b.how})${b.review === 'no' ? '' : ' — LEGAL REVIEW: ' + b.review}`);
  const csvOut = (() => { const i = process.argv.indexOf('--csv'); return i > 0 ? process.argv[i + 1] : null; })();
  if (csvOut) {
    const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
    const lines = ['kind,name,version,licence,how,legal_review', ...inv.npm.map((p) => ['npm', p.name, p.version, p.licence, 'node_modules (shipped)', ACCEPTED.has(p.licence) ? 'no' : 'yes'].map(q).join(',')),
      ...inv.bundled.map((b) => ['bundled', b.name, b.version, b.licence, b.how, b.review].map(q).join(','))];
    fs.writeFileSync(csvOut, lines.join('\n') + '\n');
  }
  if (inv.needs_review.length) { console.log('production packages with a licence outside the accepted list:'); for (const p of inv.needs_review) console.log(`  ${p.name}@${p.version} ${p.licence}`); process.exit(1); }
}
module.exports = { inventory, ACCEPTED, BUNDLED };
