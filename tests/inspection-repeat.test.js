'use strict';
// E-I06 (audit I-06, catalogue R06) — pure repeat-finding computation + verification state (fictitious fixture).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const IR = require('../services/inspectionRepeat');

const f = (site, id, date, code, status) => ({ site_code: site, inspection_id: id, inspection_date: date, item_code: code, item_text_en: 'Check ' + code, status });

test('window empty / invalid → off (no window invented)', () => {
  for (const v of ['', null, 'x', '0', '1']) assert.equal(IR.parseWindow(v), null, String(v));
  assert.equal(IR.parseWindow('3'), 3); assert.equal(IR.parseWindow('999'), 50);
  assert.deepEqual(IR.computeRepeatFindings([f('HGO', 'a', '2026-10-01', 'NET-01', 'major')], null), { enabled: false, n: null, sites: {} });
});

test('repeat = same site × item bad in ≥2 of the last N inspections; older ones and clean inspections count in the window', () => {
  const rows = [
    f('HGO', 'i4', '2026-10-20', 'NET-01', 'minor'),
    { site_code: 'HGO', inspection_id: 'i3', inspection_date: '2026-10-10', item_code: null, status: null },   // clean inspection
    f('HGO', 'i2', '2026-09-20', 'NET-01', 'critical'), f('HGO', 'i2', '2026-09-20', 'SRV-02', 'major'),
    f('HGO', 'i1', '2026-08-01', 'SRV-02', 'major'),          // outside the last 3 → SRV-02 seen once only
    f('MGO', 'm1', '2026-10-01', 'NET-01', 'major'),          // other site: never mixed
  ];
  const out = IR.computeRepeatFindings(rows, 3);
  assert.deepEqual(out.sites.HGO.inspections, ['i4', 'i3', 'i2']);
  assert.equal(out.sites.HGO.repeats.length, 1);
  const r = out.sites.HGO.repeats[0];
  assert.equal(r.item_code, 'NET-01'); assert.equal(r.hits, 2); assert.equal(r.of, 3); assert.equal(r.worst, 'critical');
  assert.deepEqual(out.sites.MGO.repeats, []);
  assert.equal(IR.computeRepeatFindings(rows, 4).sites.HGO.repeats.length, 2, 'N=4 brings i1 back');
});

test('ok / opp / na never count', () => {
  const rows = [f('HGO', 'a', '2026-10-02', 'X', 'ok'), f('HGO', 'b', '2026-10-01', 'X', 'opp'), f('HGO', 'c', '2026-09-01', 'X', 'na')];
  assert.deepEqual(IR.computeRepeatFindings(rows, 5).sites.HGO.repeats, []);
});

test('verification state: only Closed Critical / High', () => {
  assert.equal(IR.verificationState({ priority: 'High', status: 'Closed' }), 'awaiting_verification');
  assert.equal(IR.verificationState({ priority: 'Critical', status: 'Closed', verified_at: '2026-10-01' }), 'verified');
  assert.equal(IR.verificationState({ priority: 'Medium', status: 'Closed' }), null);
  assert.equal(IR.verificationState({ priority: 'High', status: 'Open' }), null);
});
