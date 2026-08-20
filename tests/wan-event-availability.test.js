'use strict';
// The ONE shared event-based availability path (services/wanEventAvailability.js) used by BOTH
// the WAN Health dashboard summary and the site-report auto-fill. Pure (mutates cells in place),
// no I/O. Proves: event-based % from the poller's outage log, per-(site,sub_site,uplink) scoping,
// target-driven RAG, and null (never a fabricated %) on an invalid window.
const { test } = require('node:test');
const assert = require('node:assert');
const { applyEventAvailability } = require('../services/wanEventAvailability');

// A weekly cell: 2026-08-09 00:00:00Z → 2026-08-15 23:59:59Z (~7 days).
const cell = (over) => ({ site_id: 1, sub_site: '', uplink: 'wan1', period_start: '2026-08-09', period_end: '2026-08-15', ...over });

test('no outages → 100%, green at target 98, basis event', () => {
  const c = cell();
  applyEventAvailability([c], [], { target: 98 });
  assert.equal(c.availability_pct, 100);
  assert.equal(c.status_color, 'green');
  assert.equal(c.basis, 'event');
});

test('one 24h outage over a 7d window → 85.71%, red (< 88.2), from the poller log', () => {
  const c = cell();
  const o = { site_id: 1, sub_site: '', uplink: 'wan1', detected_start: '2026-08-10T00:00:00Z', restored_end: '2026-08-11T00:00:00Z' };
  applyEventAvailability([c], [o], { target: 98 });
  assert.equal(c.availability_pct, 85.71);
  assert.equal(c.status_color, 'red');
});

test('outages are scoped by (site_id, sub_site, uplink) — a foreign outage does not leak', () => {
  const c = cell();                                   // site 1, sub '', wan1
  const other = [
    { site_id: 2, sub_site: '', uplink: 'wan1', detected_start: '2026-08-10T00:00:00Z', restored_end: '2026-08-11T00:00:00Z' },   // other site
    { site_id: 1, sub_site: 'FETEKRO', uplink: 'wan1', detected_start: '2026-08-10T00:00:00Z', restored_end: '2026-08-11T00:00:00Z' }, // other sub-site
    { site_id: 1, sub_site: '', uplink: 'wan2', detected_start: '2026-08-10T00:00:00Z', restored_end: '2026-08-11T00:00:00Z' },   // other uplink
  ];
  applyEventAvailability([c], other, { target: 98 });
  assert.equal(c.availability_pct, 100, 'none of the foreign outages count against this cell');
});

test('a sub-site cell only counts its own sub-site outage', () => {
  const c = cell({ sub_site: 'FETEKRO' });
  const o = { site_id: 1, sub_site: 'FETEKRO', uplink: 'wan1', detected_start: '2026-08-10T00:00:00Z', restored_end: '2026-08-11T00:00:00Z' };
  applyEventAvailability([c], [o], { target: 98 });
  assert.equal(c.availability_pct, 85.71);
});

test('an open outage (restored_end null) clamps to the window end', () => {
  const c = cell();
  const o = { site_id: 1, sub_site: '', uplink: 'wan1', detected_start: '2026-08-15T00:00:00Z', restored_end: null }; // ~24h to window end
  applyEventAvailability([c], [o], { target: 98 });
  assert.ok(c.availability_pct < 100 && c.availability_pct > 85, 'open outage counts to the window end');
});

test('invalid window (no period → to <= from) → availability null, status none (never a fabricated %)', () => {
  const c = cell({ period_start: '', period_end: '' });
  applyEventAvailability([c], [], { target: 98 });
  assert.equal(c.availability_pct, null);
  assert.equal(c.status_color, 'none');
  assert.equal(c.basis, 'event');
});

test('target drives the RAG band (inclusive >=)', () => {
  // 3% down of the ~7d window → ~97% available.
  const down = { site_id: 1, sub_site: '', uplink: 'wan1', detected_start: '2026-08-09T00:00:00Z', restored_end: '2026-08-09T05:02:24Z' };
  const cGreen = cell(); applyEventAvailability([cGreen], [down], { target: 97 });
  assert.equal(cGreen.status_color, 'green', 'exactly at target → green');
  const cOrange = cell(); applyEventAvailability([cOrange], [down], { target: 99 });
  assert.equal(cOrange.status_color, 'orange', 'below 99 but >= 89.1 → orange');
});

test('defaults target to 98 when omitted', () => {
  const c = cell();
  applyEventAvailability([c], []);
  assert.equal(c.status_color, 'green'); // 100 >= 98
});
