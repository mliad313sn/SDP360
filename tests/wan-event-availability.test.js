'use strict';
// The ONE shared event-based availability path (services/wanEventAvailability.js) used by BOTH
// the WAN Health dashboard summary and the site-report auto-fill. Pure (mutates cells in place),
// no I/O. Proves: event-based % from the poller's outage log, per-(site,sub_site,uplink) scoping,
// target-driven RAG, and null (never a fabricated %) on an invalid window.
const { test } = require('node:test');
const assert = require('node:assert');
const { applyEventAvailability, applySiteEventAvailability, eventAvailability, siteEventAvailability } = require('../services/wanEventAvailability');

// ── On-the-fly device-offline: when BOTH uplinks of a device are down at once, that overlap is
// excluded from the denominator IMMEDIATELY (no wait for the nightly 'site' attribution). This
// is what makes a MANA-style both-down (both uplinks identical, e.g. 60.7%) read ~100% again.
const _W_FROM = Date.parse('2026-08-09T00:00:00Z'), _W_TO = Date.parse('2026-08-16T00:00:00Z'); // 7d
const _DAY = ['2026-08-10T00:00:00Z', '2026-08-11T00:00:00Z'];
const _row = (uplink, start, end, attribution) => ({ uplink, detected_start: start, restored_end: end, attribution });
const _byUplink = (os) => (u) => os.filter(o => o.uplink === u.uplink);

test('cross-uplink: BOTH uplinks down the same 24h = device offline → both stay 100% (on the fly, no attribution)', () => {
  const os = [_row('wan1', ..._DAY), _row('wan2', ..._DAY)];
  assert.deepEqual(siteEventAvailability([{ uplink: 'wan1' }, { uplink: 'wan2' }], _byUplink(os), _W_FROM, _W_TO), [100, 100]);
});

test('one uplink down while the other is up = ISP fault → that uplink counts (85.71%), the other 100%', () => {
  const os = [_row('wan1', ..._DAY)];   // only wan1 down
  assert.deepEqual(siteEventAvailability([{ uplink: 'wan1' }, { uplink: 'wan2' }], _byUplink(os), _W_FROM, _W_TO), [85.71, 100]);
});

test('partial overlap: only the both-down window is excluded; each keeps its ISP-only downtime', () => {
  const os = [
    _row('wan1', '2026-08-09T00:00:00Z', '2026-08-11T00:00:00Z'),   // 0–48h
    _row('wan2', '2026-08-10T00:00:00Z', '2026-08-12T00:00:00Z'),   // 24–72h  → overlap 24–48h (24h) excluded
  ];
  // denom = 168h − 24h = 144h; each counts 24h ISP-only → (144−24)/144 = 83.33%
  assert.deepEqual(siteEventAvailability([{ uplink: 'wan1' }, { uplink: 'wan2' }], _byUplink(os), _W_FROM, _W_TO), [83.33, 83.33]);
});

test('a single-uplink device cannot infer device-offline → its down time counts (like Meraki)', () => {
  assert.equal(siteEventAvailability([{ uplink: 'wan1' }], _byUplink([_row('wan1', ..._DAY)]), _W_FROM, _W_TO)[0], 85.71);
});

test('applySiteEventAvailability mutates cells; both-down → 100% event, green', () => {
  const cells = [{ site_id: 1, sub_site: '', uplink: 'wan1' }, { site_id: 1, sub_site: '', uplink: 'wan2' }];
  const os = [{ site_id: 1, sub_site: '', uplink: 'wan1', detected_start: _DAY[0], restored_end: _DAY[1] },
              { site_id: 1, sub_site: '', uplink: 'wan2', detected_start: _DAY[0], restored_end: _DAY[1] }];
  applySiteEventAvailability(cells, os, { target: 98, fromMs: _W_FROM, toMs: _W_TO });
  assert.equal(cells[0].availability_pct, 100); assert.equal(cells[0].status_color, 'green'); assert.equal(cells[0].basis, 'event');
  assert.equal(cells[1].availability_pct, 100);
});

// ── minFromMs: availability is only meaningful over the time actually COLLECTED. Clamp the
// denominator to when monitoring began, so a not-yet-full week/month isn't inflated by counting
// the un-monitored span as up (the user's proportional-to-collection-time point).
test('minFromMs clamps the denominator to the collected time (24h of a 3-day collected window → 66.67%, not 85.71% of a fabricated 7-day one)', () => {
  const cells = [{ site_id: 1, sub_site: '', uplink: 'wan1' }];
  const os = [{ site_id: 1, sub_site: '', uplink: 'wan1', detected_start: '2026-08-14T00:00:00Z', restored_end: '2026-08-15T00:00:00Z' }]; // 24h
  applySiteEventAvailability(cells, os, { target: 98, fromMs: _W_FROM, toMs: _W_TO, minFromMs: Date.parse('2026-08-13T00:00:00Z') });
  assert.equal(cells[0].availability_pct, 66.67);
});

test('minFromMs at/after the window end → null (no coverage, never a fabricated 100%)', () => {
  const cells = [{ site_id: 1, sub_site: '', uplink: 'wan1' }];
  applySiteEventAvailability(cells, [], { target: 98, fromMs: _W_FROM, toMs: _W_TO, minFromMs: _W_TO + 86400000 });
  assert.equal(cells[0].availability_pct, null);
  assert.equal(cells[0].status_color, 'none');
});

// ── Meraki-aligned denominator: availability = uplink up WHILE THE MX IS ONLINE ÷ time MX online.
// Device-offline ('site' = both uplinks down / power) + planned 'maintenance' leave the denominator;
// ISP + not-yet-attributed (null) count against the uplink. Clean 7-day window for exact math.
const W_FROM = Date.parse('2026-08-09T00:00:00Z'), W_TO = Date.parse('2026-08-16T00:00:00Z'); // 604800s
const out = (attribution, start, end) => ({ attribution, detected_start: start, restored_end: end });
const DAY = ['2026-08-10T00:00:00Z', '2026-08-11T00:00:00Z'];      // a 24h slice
const DAY2 = ['2026-08-12T00:00:00Z', '2026-08-13T00:00:00Z'];     // a second, non-overlapping 24h slice

test("Meraki method: a 'site' (device-offline) outage is EXCLUDED from the denominator → uplink stays 100%", () => {
  assert.equal(eventAvailability([out('site', ...DAY)], W_FROM, W_TO), 100,
    'a whole-site/power outage is device downtime, not uplink downtime — it does not drag the uplink %');
});

test("an 'isp' outage counts against the uplink (24h of 7d → 85.71%)", () => {
  assert.equal(eventAvailability([out('isp', ...DAY)], W_FROM, W_TO), 85.71);
});

test("'maintenance' is excluded from the denominator too (planned) → 100%", () => {
  assert.equal(eventAvailability([out('maintenance', ...DAY)], W_FROM, W_TO), 100);
});

test('a not-yet-attributed (null) provisional outage counts as uplink down until the ingester attributes it', () => {
  assert.equal(eventAvailability([out(null, ...DAY)], W_FROM, W_TO), 85.71);
  assert.equal(eventAvailability([out('', ...DAY)], W_FROM, W_TO), 85.71);
});

test('mixed: 24h site (excluded) + 24h isp (counted) → (144h−24h)/144h = 83.33%', () => {
  const rows = [out('site', ...DAY), out('isp', ...DAY2)];
  assert.equal(eventAvailability(rows, W_FROM, W_TO), 83.33);
});

test('the whole window device-offline → null (nothing to attribute to the uplink, never 0/100)', () => {
  assert.equal(eventAvailability([out('site', '2026-08-09T00:00:00Z', '2026-08-16T00:00:00Z')], W_FROM, W_TO), null);
});

test('no attribution field at all behaves like counted (backward compatible with availability24x7)', () => {
  assert.equal(eventAvailability([{ detected_start: DAY[0], restored_end: DAY[1] }], W_FROM, W_TO), 85.71);
  assert.equal(eventAvailability([], W_FROM, W_TO), 100);
  assert.equal(eventAvailability([out('isp', ...DAY)], W_TO, W_FROM), null); // inverted window
});

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
