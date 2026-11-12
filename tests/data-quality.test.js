'use strict';
// E-D07 — data-quality board composition: a missing source is UNKNOWN, never ok; no score invented.
const test = require('node:test');
const assert = require('node:assert');
const DQ = require('../services/dataQuality');
const NOW = Date.parse('2026-11-06T12:00:00Z');

test('nothing readable → every cell UNKNOWN, none ok', () => {
  const r = DQ.compose({ freshness: { 'zoho.requests': 3 }, sites: [{ id: 1, name: 'Hounde' }], now: NOW });
  assert.equal(r.counts.ok, 0);
  assert.equal(r.counts.warn, 0);
  assert.ok(r.counts.UNKNOWN >= 7);
  assert.equal(r.sources[0].freshness.status, 'UNKNOWN');
  assert.equal(r.sites[0].hygiene_completeness.value, null, 'no score invented');
  assert.equal(r.risk_register_unmapped.status, 'UNKNOWN');
});

test('real signals → ok / warn with a fix link', () => {
  const r = DQ.compose({
    now: NOW, freshness: { a: 3, b: 3 },
    syncRows: [{ job: 'a', last_ok: '2026-11-06T11:00:00Z' }, { job: 'b', last_ok: '2026-11-05T00:00:00Z' }],
    drift: { a: { status: 'ok', flags: [], duplicates_pct: 0 }, b: { status: 'drift', flags: ['duplicates_rate'], duplicates_pct: 30 } },
    sites: [{ id: 1, name: 'Hounde' }, { id: 2, name: 'Tanda' }],
    hygieneBySite: [{ site: 'HOUNDE', total: 10, completeness: 90, cost_pct: 20 }],
    siteCodeDiff: [{ site_id: 2, kind: 'shared_code' }],
    unmappedRiskLabels: [{ sdp_label: 'LONDON', ticket_count: 3 }],
  });
  assert.deepEqual(r.sources.map((s) => s.freshness.status), ['ok', 'warn']);
  assert.equal(r.sources[1].duplicates.status, 'warn');
  assert.equal(r.sites[0].hygiene_completeness.status, 'ok');
  assert.equal(r.sites[0].money_coverage.status, 'warn');
  assert.equal(r.sites[1].hygiene_completeness.status, 'UNKNOWN', 'site with no asset label');
  assert.equal(r.sites[1].site_code_disagreements.status, 'warn');
  assert.equal(r.sites[0].site_code_disagreements.status, 'ok');
  assert.equal(r.risk_register_unmapped.value, 1);
  assert.ok(r.sites[0].money_coverage.fix);
});
