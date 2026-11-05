'use strict';
// C-20 (G44 G48 · A06 · R9) — the PURE coverage engine and CSV roster parser.
// No roster data = unknown (never green); inactive / site-less holders never count; offices only in business hours.
const test = require('node:test');
const assert = require('node:assert');
const C = require('../services/dutyCoverage');

const MINE = { id: 1, name: 'Hounde' };
const OFFICE = { id: 2, name: 'Dakar Office' };
const acct = (active = [7, 8, 9], sites = { 7: [1], 8: [1], 9: [2] }) => ({ active: new Set(active), sitesOf: (u) => sites[u] || [] });
const shift = (user, start, end, site = 1, family = 'site-it-support') => ({ site_id: site, family, user_id: user, starts_at: start, ends_at: end });
const run = (shifts, extra = {}) => C.coverage({ sites: [MINE, OFFICE], families: ['site-it-support'], policies: [], shifts, account: acct(), from: '2026-11-02', days: 1, calendar: [], ...extra });
const row = (r, site) => r.rows.find((x) => x.site_id === site);

test('defaults (R9): a mine is 24/7 in two 12 h shifts, an office is business hours on weekdays', () => {
  assert.equal(C.defaultPolicy(MINE).mode, '24x7');
  assert.equal(C.defaultPolicy(OFFICE).mode, 'business_hours');
  const s = C.slots(C.defaultPolicy(MINE), '2026-11-02', 1, new Set());
  assert.deepEqual(s.map((x) => [x.start, x.end]), [['2026-11-02T06:00:00.000Z', '2026-11-02T18:00:00.000Z'], ['2026-11-02T18:00:00.000Z', '2026-11-03T06:00:00.000Z']]);
  const sat = C.slots(C.defaultPolicy(OFFICE), '2026-11-07', 1, new Set());
  assert.equal(sat[0].required, false, 'Saturday is not required for an office');
  const hol = C.slots(C.defaultPolicy(OFFICE), '2026-11-02', 1, new Set(['2026-11-02']));
  assert.equal(hol[0].required, false, 'a listed holiday is not required');
});

test('no roster rows at all → every required slot is unknown, never covered', () => {
  const r = run([]);
  assert.ok(row(r, 1).slots.every((s) => s.status === 'unknown'));
  assert.equal(r.summary.covered, 0); assert.ok(r.summary.unknown >= 2);
});

test('a full eligible shift covers its slot; a hole inside the entered roster is a gap, outside it unknown', () => {
  const r = run([shift(7, '2026-11-02T06:00:00Z', '2026-11-02T18:00:00Z'), shift(8, '2026-11-02T18:00:00Z', '2026-11-02T22:00:00Z')],
    { days: 2 });
  const s = row(r, 1).slots;
  assert.equal(s[0].status, 'covered'); assert.deepEqual(s[0].people, [7]);
  assert.equal(s[1].status, 'unknown', 'night slot ends after the roster extent → unknown');
  const r2 = run([shift(7, '2026-11-02T06:00:00Z', '2026-11-02T18:00:00Z'), shift(8, '2026-11-02T18:00:00Z', '2026-11-02T22:00:00Z'), shift(7, '2026-11-03T06:00:00Z', '2026-11-03T18:00:00Z')]);
  const n = row(r2, 1).slots[1];
  assert.equal(n.status, 'gap'); assert.equal(n.reason, 'partial');
});

test('overlapping rotations add up; min_people is read per site', () => {
  const sh = [shift(7, '2026-11-02T06:00:00Z', '2026-11-02T12:00:00Z'), shift(8, '2026-11-02T11:00:00Z', '2026-11-03T06:00:00Z')];
  const r = run(sh);
  assert.ok(row(r, 1).slots.every((s) => s.status === 'covered'));
  const two = run(sh, { policies: [{ site_id: 1, family: 'site-it-support', mode: '24x7', min_people: 2, shift_start: '06:00', shift_hours: 12, business_start: '08:00', business_end: '17:00', business_days: '12345' }] });
  assert.equal(row(two, 1).policy.source, 'site');
  assert.equal(row(two, 1).slots[0].status, 'gap');
});

test('inactive or site-less holders never count (governance skip-inactive rule, always on here)', () => {
  const sh = [shift(7, '2026-11-02T06:00:00Z', '2026-11-03T06:00:00Z')];
  const inactive = run(sh, { account: acct([8, 9]) });
  assert.equal(row(inactive, 1).slots[0].status, 'gap'); assert.equal(row(inactive, 1).slots[0].reason, 'inactive_holder');
  const moved = run(sh, { account: acct([7], { 7: [2] }) });
  assert.equal(row(moved, 1).slots[0].status, 'gap', 'holder no longer on the site');
  const noSite = run(sh, { account: acct([7], { 7: [] }) });
  assert.equal(row(noSite, 1).slots[0].status, 'gap', 'site-less holder');
  assert.equal(row(run(sh, { account: null }), 1).slots[0].status, 'gap', 'no account state → nobody counts');
});

test('office: weekend slot is not_required; a weekday business slot needs the holder', () => {
  const r = C.coverage({ sites: [OFFICE], families: ['site-it-support'], policies: [], account: acct(), from: '2026-11-06', days: 2, calendar: [],
    shifts: [shift(9, '2026-11-06T08:00:00Z', '2026-11-06T17:00:00Z', 2)] });
  const s = r.rows[0].slots;
  assert.equal(s[0].status, 'covered'); assert.equal(s[1].status, 'not_required');
});

test('validatePolicy rejects bad modes, shift lengths and min_people', () => {
  assert.ok(C.validatePolicy({ mode: 'always' }).error);
  assert.ok(C.validatePolicy({ mode: '24x7', shift_hours: 7 }).error);
  assert.ok(C.validatePolicy({ mode: 'business_hours', min_people: 0 }).error);
  assert.ok(C.validatePolicy({ mode: 'business_hours', business_start: '18:00', business_end: '08:00' }).error);
  assert.equal(C.validatePolicy({ mode: '24x7', shift_hours: 8 }).value.shift_hours, 8);
});

test('CSV: header-driven, BOM and quotes, per-row errors, duplicate lines flagged', () => {
  const csv = '﻿User,Duty Family,Site,Start,End\n' +
    '"jdoe",site-it-support,Hounde,2026-11-02 06:00,2026-11-02 18:00\n' +
    'nobody,site-it-support,Hounde,2026-11-02 06:00,2026-11-02 18:00\n' +
    'jdoe,unknown-family,1,2026-11-02 06:00,2026-11-02 18:00\n' +
    'jdoe,network-oncall,"Hounde",2026-11-02 18:00,2026-11-02 06:00\n' +
    'jdoe,site-it-support,Hounde,2026-11-02T06:00Z,2026-11-02T18:00Z\n';
  const out = C.parseRosterCsv(csv, { sites: [MINE, OFFICE], users: [{ id: 7, username: 'jdoe', email: 'j@x.io' }], families: ['site-it-support', 'network-oncall'] });
  assert.equal(out.rows.length, 1);
  assert.deepEqual(out.rows[0], { line: 2, site_id: 1, family: 'site-it-support', user_id: 7, starts_at: '2026-11-02T06:00:00.000Z', ends_at: '2026-11-02T18:00:00.000Z' });
  assert.deepEqual(out.errors.map((e) => e.line), [3, 4, 5, 6]);
  assert.match(out.errors.find((e) => e.line === 6).error, /duplicate/);
  const missing = C.parseRosterCsv('user,site\njdoe,1\n', { sites: [MINE], users: [], families: [] });
  assert.equal(missing.rows.length, 0); assert.match(missing.errors[0].error, /family/);
});
