'use strict';
// P4 / B9 — pure value metrics: median completion, on-time against a decided deadline only, % auto-prefilled.
const test = require('node:test');
const assert = require('node:assert');
const V = require('../services/weeklyReportValue');

const rows = [
  { report_id: 1, site_id: 10, site_name: 'A', end_date: '2026-11-07', first_edit_at: '2026-11-08T08:00:00Z', first_submit_at: '2026-11-08T08:30:00Z' },
  { report_id: 2, site_id: 10, site_name: 'A', end_date: '2026-11-07', first_edit_at: '2026-11-09T08:00:00Z', first_submit_at: '2026-11-10T09:00:00Z' },
  { report_id: 3, site_id: 20, site_name: 'B', end_date: '2026-11-07', first_edit_at: '2026-11-08T08:00:00Z', first_submit_at: null },
  { report_id: 4, site_id: 20, site_name: 'B', end_date: '2026-11-07', first_edit_at: null, first_submit_at: null },
];

test('no deadline policy → on-time unknown for every report (null, not 0 %)', () => {
  const t = V.composeTiming(rows, { dueDays: '', now: Date.parse('2026-11-20T00:00:00Z') });
  assert.ok(t.reports.every((r) => r.on_time === null));
  assert.strictEqual(t.overall.on_time_pct, null);
  assert.strictEqual(t.overall.median_minutes, (30 + 1500) / 2);
});

test('deadline = end + 2 d: early submit on time, late submit late, unsubmitted past due late, not-yet-due unknown', () => {
  const t = V.composeTiming(rows, { dueDays: '2', now: Date.parse('2026-11-20T00:00:00Z') });
  assert.deepStrictEqual(t.reports.map((r) => r.on_time), [true, false, false, false]);
  assert.strictEqual(t.overall.on_time_pct, 25);
  const early = V.composeTiming(rows.slice(2), { dueDays: '2', now: Date.parse('2026-11-08T10:00:00Z') });
  assert.deepStrictEqual(early.reports.map((r) => r.on_time), [null, null]);
  const a = t.by_site.find((s) => s.site_name === 'A');
  assert.strictEqual(a.median_minutes, 765);
});

test('prefill: only measurable rows count; empty = unknown; old rows = not recorded; minutes saved needs a baseline', () => {
  const p = V.composePrefill([
    { site_id: 1, service: 'WAN1', status_value: '99%', value_source: 'meraki' },
    { site_id: 1, service: 'LAN', status_value: '98%', value_source: 'opmanager' },
    { site_id: 1, service: 'WLAN', status_value: '97%', value_source: 'manual' },
    { site_id: 1, service: 'Servers', status_value: '', value_source: null },
    { site_id: 1, service: 'WAN2', status_value: '99%', value_source: null },
    { site_id: 1, service: 'Radio', status_value: '100%', value_source: 'manual' },
  ]);
  assert.deepStrictEqual([p.measurable, p.auto, p.manual, p.unknown, p.not_recorded], [5, 2, 1, 1, 1]);
  assert.strictEqual(p.auto_pct, 40);
  assert.strictEqual(p.minutes_saved, null);
  assert.strictEqual(V.composePrefill([{ service: 'WAN1', status_value: '1%', value_source: 'meraki' }], { minutesPerCell: '3' }).minutes_saved, 3);
  assert.strictEqual(V.composePrefill([]).auto_pct, null, 'nothing measurable → unknown, not 0 %');
});
