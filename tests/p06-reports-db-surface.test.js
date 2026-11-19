'use strict';
// P06 — characterization of reports-db.js's public surface while code moves out to services/<domain>Store.js:
// the exported names and their kinds (function / async function / object / other) must not change.
// Regenerate deliberately: GOLDEN_UPDATE=1 node --test tests/p06-reports-db-surface.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const GOLDEN = path.join(__dirname, '__golden__', 'p06-reports-db-surface.json');

function kind(v) {
  if (typeof v === 'function') return v.constructor && v.constructor.name === 'AsyncFunction' ? 'async' : 'function';
  if (v === null) return 'null';
  return Array.isArray(v) ? 'array' : typeof v;
}

test('reports-db exports the same names with the same kinds', () => {
  const m = require('../reports-db');
  const got = {};
  for (const k of Object.keys(m).sort()) got[k] = kind(m[k]);
  if (process.env.GOLDEN_UPDATE === '1') { fs.writeFileSync(GOLDEN, JSON.stringify(got, null, 1) + '\n'); return; }
  assert.deepStrictEqual(got, JSON.parse(fs.readFileSync(GOLDEN, 'utf8')));
});
