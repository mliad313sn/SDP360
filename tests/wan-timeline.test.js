'use strict';
// C-13 (G21) — pure WAN visuals helper: outage timeline bars, per-source freshness, mapping coverage.
const { test } = require('node:test');
const assert = require('node:assert');
const WT = require('../public/lib/wanTimeline');

const FROM = Date.parse('2026-08-01T00:00:00Z');
const TO = Date.parse('2026-08-11T00:00:00Z');      // 10-day window → 1 day = 10 %
const NOW = Date.parse('2026-08-06T00:00:00Z');

test('build: one row per site × sub-site × uplink, bars positioned in % of the window', () => {
  const tl = WT.build([
    { site_id: 2, site_name: 'Mana', sub_site: '', uplink: 'wan1', detected_start: '2026-08-02T00:00:00Z', restored_end: '2026-08-03T00:00:00Z', attribution: 'isp' },
    { site_id: 2, site_name: 'Mana', sub_site: '', uplink: 'wan1', detected_start: '2026-08-04T00:00:00Z', restored_end: '2026-08-04T12:00:00Z', attribution: 'site' },
    { site_id: 2, site_name: 'Mana', sub_site: '', uplink: 'wan2', detected_start: '2026-08-05T00:00:00Z', restored_end: '2026-08-05T06:00:00Z', attribution: 'Maintenance' },
  ], { fromMs: FROM, toMs: TO, nowMs: NOW });
  assert.equal(tl.rows.length, 2);
  assert.equal(tl.total, 3);
  const w1 = tl.rows.find(r => r.uplink === 'wan1');
  assert.deepEqual(w1.bars.map(b => [b.left, b.width, b.attribution]), [[10, 10, 'isp'], [30, 5, 'site']]);
  assert.equal(w1.down_s, 86400 + 43200);
  assert.equal(tl.rows.find(r => r.uplink === 'wan2').bars[0].attribution, 'maintenance', 'attribution normalised');
});

test('build: an OPEN outage runs to now, is flagged open, and is never "pending review"', () => {
  const tl = WT.build([{ site_id: 1, sub_site: 'FETEKRO', uplink: 'wan1', detected_start: '2026-08-05T00:00:00Z', restored_end: null, attribution: null }],
    { fromMs: FROM, toMs: TO, nowMs: NOW });
  const b = tl.rows[0].bars[0];
  assert.equal(b.open, true);
  assert.equal(b.pending, false);
  assert.equal(b.end, null);
  assert.equal(b.width, 10, 'clipped at now (1 day)');
  assert.equal(tl.open, 1);
  assert.match(tl.rows[0].label, /#1 \/ FETEKRO · wan1/);
});

test('build: closed outage with no / unknown attribution = pending review (same rule as wanSla.pendingReview)', () => {
  const tl = WT.build([
    { site_id: 1, uplink: 'wan1', detected_start: '2026-08-02T00:00:00Z', restored_end: '2026-08-02T01:00:00Z', attribution: 'unknown' },
    { site_id: 1, uplink: 'wan1', detected_start: '2026-08-03T00:00:00Z', restored_end: '2026-08-03T01:00:00Z', attribution: null },
    { site_id: 1, uplink: 'wan1', detected_start: '2026-08-04T00:00:00Z', restored_end: '2026-08-04T01:00:00Z', attribution: 'isp' },
  ], { fromMs: FROM, toMs: TO, nowMs: NOW });
  assert.deepEqual(tl.rows[0].bars.map(b => b.pending), [true, true, false]);
  assert.equal(tl.rows[0].pending, 2);
});

test('build: outages are clipped to the window; outside / invalid ones are dropped; bad window → empty', () => {
  const tl = WT.build([
    { site_id: 1, uplink: 'wan1', detected_start: '2026-07-31T00:00:00Z', restored_end: '2026-08-02T00:00:00Z', attribution: 'isp' },
    { site_id: 1, uplink: 'wan1', detected_start: '2026-07-01T00:00:00Z', restored_end: '2026-07-02T00:00:00Z', attribution: 'isp' },
    { site_id: 1, uplink: 'wan1', detected_start: 'not a date', restored_end: null },
  ], { fromMs: FROM, toMs: TO, nowMs: NOW });
  assert.equal(tl.total, 1);
  assert.deepEqual([tl.rows[0].bars[0].left, tl.rows[0].bars[0].width], [0, 10]);
  assert.deepEqual(WT.build([], { fromMs: TO, toMs: FROM }).rows, []);
});

test('tableSpec: the accessible table carries the same rows as the bars; empty → NO_DATA', () => {
  const tl = WT.build([{ site_id: 1, site_name: 'Ity', uplink: 'wan2', detected_start: '2026-08-02T00:00:00Z', restored_end: '2026-08-02T06:00:00Z', attribution: 'isp' }],
    { fromMs: FROM, toMs: TO, nowMs: NOW });
  const s = WT.tableSpec(tl);
  assert.deepEqual(s.labels, ['Ity · wan2']);
  assert.deepEqual(s.datasets.map(d => d.data[0]), [1, 6, 0, 0]);
  assert.equal(s.state, 'VALID');
  assert.equal(WT.tableSpec({ rows: [] }).state, 'NO_DATA');
});

test('freshness: a source that never ran says "never" — never a fabricated date', () => {
  const f = WT.freshness([
    { key: 'poll', label: 'Poller', at: '2026-08-05T10:15:30.000Z' },
    { key: 'snap', label: 'Snapshot', at: null },
    { key: 'ing', label: 'Ingester', at: '' },
    { key: 'bad', label: 'Bad', at: 'garbage' },
  ]);
  assert.deepEqual(f.map(x => x.text), ['2026-08-05 10:15 UTC', 'never', 'never', 'unreadable']);
  assert.equal(f[1].at, null);
});

test('coverage: sites mapped to a Meraki network and uplinks mapped to an SLA circuit', () => {
  const c = WT.coverage({
    sites: [{ site_id: 1, name: 'Ity', network: 'Ity Gold Operations' }, { site_id: 2, name: 'Mana', network: '' }, { site_id: 3, name: 'Dakar', network: null }],
    uplinks: [{ site_id: 1, sub_site: '', uplink: 'wan1' }, { site_id: 1, sub_site: '', uplink: 'wan2' }, { site_id: 1, uplink: 'wan2' }, { site_id: 2, uplink: 'wan1' }],
    mappedKeys: ['1||wan1'],
  });
  assert.equal(c.sites_total, 3);
  assert.equal(c.sites_mapped, 1);
  assert.deepEqual(c.sites_unmapped, ['Mana', 'Dakar']);
  assert.equal(c.uplinks_total, 3, 'duplicates folded');
  assert.equal(c.uplinks_mapped, 1);
  assert.deepEqual(c.uplinks_unmapped.map(u => u.site_name + ':' + u.uplink), ['Ity:wan2', 'Mana:wan1']);
  assert.deepEqual(WT.coverage({}), { sites_total: 0, sites_mapped: 0, sites_unmapped: [], uplinks_total: 0, uplinks_mapped: 0, uplinks_unmapped: [] });
});
