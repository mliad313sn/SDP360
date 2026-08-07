'use strict';
// buildSiteImpact — share math + card auto-selection, pinned to the board deck's
// July shape (Sabodala 44% of misses on 20% workload; Ity the proof site).
const test = require('node:test');
const assert = require('node:assert');
const { buildSiteImpact } = require('../services/deckSiteImpact');

// code, name, tickets, missed, closed, on_time, incidents
const PER_SITE = [
  { code: 'SGO', name: 'Sabodala', tickets: 200, missed: 44, closed: 180, on_time: 100, incidents: 30 },
  { code: 'SMI', name: 'Ity',      tickets: 281, missed: 2,  closed: 280, on_time: 278, incidents: 11 },
  { code: 'HGO', name: 'Houndé',   tickets: 100, missed: 11, closed: 90,  on_time: 80,  incidents: 20 },
  { code: 'MGO', name: 'Mana',     tickets: 419, missed: 43, closed: 400, on_time: 380, incidents: 40 },
];

test('shares: workload / miss / on-time / incident are computed per site', () => {
  const r = buildSiteImpact(PER_SITE);
  const sgo = r.rows.find((x) => x.code === 'SGO');
  assert.equal(sgo.workload_pct, 20);   // 200 / 1000
  assert.equal(sgo.miss_pct, 44);       // 44 / 100
  assert.equal(sgo.incident_pct, 15);   // 30 / 200
  const smi = r.rows.find((x) => x.code === 'SMI');
  assert.equal(smi.ontime_pct, 99.3);   // 278 / 280
  assert.equal(r.fleet_incident_pct, 10.1);   // 101 / 1000
});

test('bars are sorted (miss desc, incident desc) with fleet-avg flag', () => {
  const r = buildSiteImpact(PER_SITE);
  assert.equal(r.missBars[0].code, 'SGO');       // 44% highest miss share
  assert.equal(r.incidentBars[0].code, 'HGO');   // 20% highest incident share
  assert.equal(r.incidentBars[0].above, true);   // above fleet 10.1%
  assert.equal(r.rows.find((x) => x.code === 'SMI').incident_pct < r.fleet_incident_pct, true);
});

test('cards: most-stretched = worst miss share, proof = best on-time at scale', () => {
  const r = buildSiteImpact(PER_SITE, { prizeDeltaPP: 2.4 });
  assert.equal(r.cards.most_stretched.code, 'SGO');
  assert.match(r.cards.most_stretched.caption, /44% of misses on 20% of workload/);
  assert.equal(r.cards.under_dual_pressure.code, 'HGO');
  // proof must be at ≥ median volume (excludes tiny sites) → Ity, the best on-time
  assert.equal(r.cards.proof.code, 'SMI');
  assert.match(r.cards.proof.caption, /281 tickets · 99\.3% on time/);
  assert.equal(r.cards.the_prize.value, '+2.4pp');
});

test('empty / zero-ticket input degrades safely', () => {
  const r = buildSiteImpact([{ code: 'X', tickets: 0 }]);
  assert.deepEqual(r.rows, []);
  assert.equal(r.fleet_incident_pct, 0);
  assert.equal(r.cards.most_stretched, null);
  assert.equal(r.cards.the_prize.value, '—');
});
