'use strict';
// V1b-D Task 1 — pure WAN dashboard shaping over wan_link_snapshots rows.
const { test } = require('node:test');
const assert = require('node:assert');
const { latestPerSite, trendSeries } = require('../services/wanDashboard');

const R = (site_id, uplink, period_start, avail, extra = {}) => ({
  site_id, uplink, period_type: 'week', period_start, period_end: period_start,
  availability_pct: avail, status_color: avail >= 98 ? 'green' : 'orange',
  loss_pct_avg: 0.5, latency_ms_avg: 25, jitter_ms_avg: 2, data_through: period_start, ...extra,
});

test('latestPerSite: keeps the max period_start per (site, uplink), grouped by site', () => {
  const rows = [
    R(1, 'wan1', '2026-08-02', 97),
    R(1, 'wan1', '2026-08-09', 99),   // newer wan1 for site 1
    R(1, 'wan2', '2026-08-09', 96),
    R(2, 'wan1', '2026-08-09', 100),
  ];
  const out = latestPerSite(rows);
  assert.equal(out.length, 2);                       // 2 sites
  assert.deepEqual(out.map(s => s.site_id), [1, 2]); // ordered by site_id
  const s1 = out.find(s => s.site_id === 1);
  const wan1 = s1.uplinks.find(u => u.uplink === 'wan1');
  assert.equal(wan1.availability_pct, 99);           // the newer one
  assert.equal(wan1.period_start, '2026-08-09');
  assert.equal(s1.uplinks.length, 2);                // wan1 + wan2
});

test('trendSeries: per uplink, ordered by period_start', () => {
  const rows = [
    R(1, 'wan1', '2026-08-09', 99),
    R(1, 'wan1', '2026-08-02', 97),
    R(1, 'wan2', '2026-08-09', 96),
  ];
  const series = trendSeries(rows);
  const byU = Object.fromEntries(series.map(s => [s.uplink, s]));
  assert.deepEqual(byU.wan1.points.map(p => p.period_start), ['2026-08-02', '2026-08-09']);
  assert.equal(byU.wan1.points[1].availability_pct, 99);
  assert.equal(byU.wan2.points.length, 1);
});

test('empty inputs → empty outputs', () => {
  assert.deepEqual(latestPerSite([]), []);
  assert.deepEqual(trendSeries([]), []);
  assert.deepEqual(latestPerSite(null), []);
});

// V1b-E T7 — Exploration sub-sites: one uplink label appears once per sub_site.
test('latestPerSite carries sub_site on each uplink cell', () => {
  const out = latestPerSite([
    { site_id: 9, sub_site: 'FETEKRO', uplink: 'wan1', period_start: '2026-08-09', availability_pct: 80 },
    { site_id: 9, sub_site: 'TANDA',   uplink: 'wan1', period_start: '2026-08-09', availability_pct: 90 },
  ]);
  const site = out.find(s => s.site_id === 9);
  assert.ok(site.uplinks.find(u => u.sub_site === 'FETEKRO'));
  assert.ok(site.uplinks.find(u => u.sub_site === 'TANDA'));
});
test('trendSeries separates the same uplink by sub_site', () => {
  const s = trendSeries([
    { sub_site: 'FETEKRO', uplink: 'wan1', period_start: '2026-08-09', availability_pct: 80 },
    { sub_site: 'TANDA',   uplink: 'wan1', period_start: '2026-08-09', availability_pct: 90 },
  ]);
  assert.equal(s.length, 2, 'one series per (sub_site, uplink)');
});
