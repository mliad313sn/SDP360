'use strict';
// P08 §1 — the committee dossier set is generated from the code and stays current; every executive KPI has a
// filled technical dossier and NO human field (owner, approvals) is filled by the generator.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const DS = require('../tools/kpi/dossiers');

test('docs/kpi/baselines/P08-kpi-dossiers.md is up to date with the registry', () => {
  // P11 F-05: a tree without the evidence folder says so instead of an ENOENT stack
  assert.ok(fs.existsSync(DS.OUT), `dossier file is missing: ${DS.OUT} — regenerate it with node tools/kpi/dossiers.js (not a formula regression)`);
  const cur = fs.readFileSync(DS.OUT, 'utf8').replace(/\r\n/g, '\n').trim();
  assert.equal(cur, DS.build().trim(), 'run: node tools/kpi/dossiers.js');
});

test('every executive KPI has numerator, denominator, aggregation and a worked example', () => {
  const md = DS.build();
  for (const k of DS.executiveKeys()) {
    const sec = md.split('## `' + k + '`')[1]; assert.ok(sec, k);
    const body = sec.split('\n## ')[0];
    for (const f of ['Numerator', 'Denominator', 'Exclusions', 'Aggregation across sites', 'RAG policy and origin', 'Owner role', 'Open disputes', 'Worked example']) {
      const line = body.split('\n').find((l) => l.startsWith('| ' + f)); assert.ok(line && !/\| — \|$/.test(line), `${k}: ${f}`);
    }
  }
});

test('no approval, owner or signature is filled by the generator', () => {
  const md = DS.build();
  assert.ok(!/approved by [A-Z]|(?<!not )certified —|Approved:/i.test(md));
  assert.match(md, /threshold approval: to be decided/);
  assert.match(md, /not\*\* an independent review/);
});
