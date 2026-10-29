'use strict';
// G21 — every test, code file and document an evidence file cites exists, and the matrix is regenerated.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const T = require('../tools/agent/traceability');

test('no evidence file cites a file that does not exist', () => {
  const missing = T.build().flatMap((g) => g.missing.map((m) => `${g.id}: ${m}`));
  assert.deepStrictEqual(missing, []);
});

test('TRACEABILITY.md is up to date', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'agent-execution', 'TRACEABILITY.md'), 'utf8').replace(/\r\n/g, '\n');
  assert.strictEqual(doc, T.markdown(T.build()), 'run node tools/agent/traceability.js');
});

test('field / deployed / accepted are copied from the tracker, never derived', () => {
  for (const g of T.build()) for (const k of ['field', 'deployed', 'accepted']) assert.ok(['UNKNOWN', 'NO', 'YES', ''].includes(g[k]) || /BLOCKED|PENDING/.test(g[k]), `${g.id} ${k}=${g[k]}`);
});
