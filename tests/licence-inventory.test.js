'use strict';
// EX-09 — every shipped npm package has an accepted licence (a copyleft or unknown one stops CI for a
// legal look), and the committed inventory CSV matches what package-lock.json ships.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { inventory } = require('../tools/release/licence-inventory');

test('no shipped package with a licence outside the accepted list', () => {
  assert.deepStrictEqual(inventory().needs_review.map((p) => `${p.name} ${p.licence}`), []);
});

test('the committed LICENCE-INVENTORY.csv lists every shipped package', () => {
  const csv = fs.readFileSync(path.join(__dirname, '..', 'docs', 'sdp360', 'completion', 'LICENCE-INVENTORY.csv'), 'utf8');
  const missing = inventory().npm.filter((p) => !csv.includes(`"npm","${p.name}","${p.version}"`)).map((p) => p.name + '@' + p.version);
  assert.deepStrictEqual(missing, [], 'regenerate: node tools/release/licence-inventory.js --csv docs/sdp360/completion/LICENCE-INVENTORY.csv');
});

test('components bundled in Setup.exe whose redistribution terms need Legal are flagged', () => {
  const flagged = inventory().bundled.filter((b) => b.review !== 'no').map((b) => b.name);
  assert.ok(flagged.some((n) => /PostgreSQL/.test(n)) && flagged.some((n) => /URL Rewrite/.test(n)) && flagged.some((n) => /Request Routing/.test(n)));
});
