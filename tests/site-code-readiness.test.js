'use strict';
// P08 §6 — the readiness verdict of the site-code registry difference report (FICTITIOUS diff rows).
const test = require('node:test');
const assert = require('node:assert/strict');
const SR = require('../tools/sites/site-code-readiness');
const OB = require('../services/siteOnboarding');

test('a disagreement or a shared code blocks; the verdict never switches anything', () => {
  const diff = [
    { module: 'tracker', site_id: 1, site: 'FX North', hard_coded: 'FXN', registry: 'FXX', kind: 'different' },
    { module: 'meetings', site_id: 2, site: 'FX South', hard_coded: 'FXS', registry: null, kind: 'missing_in_registry' },
  ];
  const r = SR.readiness(diff, OB.fillPlan(diff));
  assert.match(r.verdict, /^NOT READY — differences/);
  assert.equal(r.blocking.length, 1);
  assert.equal(r.fillable.length, 1);
  const md = SR.markdown(r, { mode: '0' });
  assert.match(md, /switch is NOT changed/); assert.match(md, /\| tracker \| FX North \| FXN \| FXX \| different/);
});

test('only fillable gaps → READY AFTER FILL; nothing at all → READY FOR SHADOW', () => {
  const gaps = [{ module: 'inspection', site_id: 3, site: 'FX East', hard_coded: 'FXE', registry: null, kind: 'missing_in_registry' }];
  assert.match(SR.readiness(gaps, OB.fillPlan(gaps)).verdict, /^READY AFTER FILL/);
  assert.equal(SR.readiness([], OB.fillPlan([])).verdict, 'READY FOR SHADOW');
  const noCode = [{ module: 'tracker', site_id: 4, site: 'FX West', hard_coded: null, registry: null, kind: 'missing_in_registry' }];
  assert.match(SR.readiness(noCode, OB.fillPlan(noCode)).verdict, /without a hard-coded code/);
});

test('the CLI reads the PostgreSQL schema (read-only) and prints the report', async () => {
  const log = console.log; let out = ''; console.log = (s) => { out += s; };
  try { assert.equal(await SR.main([]), 0); } finally { console.log = log; }
  assert.match(out, /site_codes_from_registry — readiness/);
});
