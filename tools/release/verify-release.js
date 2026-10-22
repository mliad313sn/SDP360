'use strict';
// SDP-DASH-2.0 step 5 (lot 5.6, ADR-003) — verify an extracted release package against its manifest.json.
//
//   node tools/release/verify-release.js <extracted-package-dir>
//
// Exit 0 = every file is exactly what the CI built (none changed, missing or added, node_modules intact).
// Exit 1 = the list of differences. The installer v2 / Manager will run this before applying a package.
const path = require('path');
const { verifyTree } = require('../../services/releaseManifest');

const dir = process.argv[2];
if (!dir) { console.error('usage: node tools/release/verify-release.js <extracted-package-dir>'); process.exit(2); }
const v = verifyTree(path.resolve(dir));
if (v.ok) { console.log(`[verify] OK — sdp-dashboard ${v.version} (${v.commit})`); process.exit(0); }
console.error(`[verify] FAILED — ${v.errors.length} difference(s):\n  ` + v.errors.slice(0, 50).join('\n  '));
process.exit(1);
