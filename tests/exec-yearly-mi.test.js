'use strict';
// TDD for services/execYearly.js aggregateYearlyMI — the pure year-to-date
// major-incident aggregator behind the exec deck's "Major Incidents — Year to
// Date" companion slide (slide 9b). Classifies P1/P2 exactly like the monthly
// _majorIncidents path (udf Priority/priority/Severity → Enterprise=Critical
// fallback), sums downtime (actual outage window beats the typed number), counts
// resolved, and buckets by month. Pure over plain rows → no DB needed.
const test = require('node:test');
const assert = require('node:assert');
const { aggregateYearlyMI } = require('../services/execYearly');

const rows = [
  // Jan — P1 (critical via udf), resolved, actual window 2h
  { site: 'HOUNDE', request_status: 'Closed', created_time: '2026-01-10T08:00:00', resolved_time: '2026-01-10T11:00:00',
    udf_json: JSON.stringify({ 'Priority': 'Critical', 'UDF:Incident Actual Start Time': '10 Jan, 2026 08:00:00', 'UDF:Incident Actual Resolution Time': '10 Jan, 2026 10:00:00' }) },
  // Mar — P2 (high), resolved, typed downtime 3h
  { site: 'MANA', request_status: 'Resolved', created_time: '2026-03-05T09:00:00', resolved_time: '2026-03-05T14:00:00',
    udf_json: JSON.stringify({ 'Priority': 'High', 'UDF:Total Downtime (Hours):': '3' }) },
  // Mar — Enterprise impact, no explicit priority → Critical (P1), still open
  { site: 'MANA', request_status: 'Open', created_time: '2026-03-20T09:00:00', resolved_time: null,
    udf_json: JSON.stringify({}), impact: 'Enterprise' },
  // Jul — a DIFFERENT site (Sabodala), P2
  { site: 'Sabodala', request_status: 'Closed', created_time: '2026-07-02T09:00:00', resolved_time: '2026-07-02T10:00:00',
    udf_json: JSON.stringify({ 'Severity': 'High' }) },
];

test('fleet-wide YTD aggregate', () => {
  const a = aggregateYearlyMI(rows, {});
  assert.equal(a.mi_total, 4);
  assert.equal(a.mi_critical, 2, 'two P1 (explicit Critical + Enterprise fallback)');
  assert.equal(a.mi_high, 2, 'two P2 (High + Severity High)');
  assert.equal(a.mi_resolved, 3, 'three resolved (row 3 is Open)');
  // downtime: 2h (actual window) + 3h (typed) = 5
  assert.equal(a.mi_downtime_h, 5);
});

test('by_month buckets in order', () => {
  const a = aggregateYearlyMI(rows, {});
  assert.deepEqual(a.by_month, [{ m: 1, count: 1 }, { m: 3, count: 2 }, { m: 7, count: 1 }]);
});

test('site filter (accent/case-insensitive) narrows the population', () => {
  const a = aggregateYearlyMI(rows, { site: 'Houndé' });   // diacritic vs HOUNDE
  assert.equal(a.mi_total, 1);
  assert.equal(a.mi_critical, 1);
  assert.deepEqual(a.by_month, [{ m: 1, count: 1 }]);
});

test('"all" site = fleet-wide', () => {
  assert.equal(aggregateYearlyMI(rows, { site: 'all' }).mi_total, 4);
});

test('empty rows → zeroed, never throws', () => {
  const a = aggregateYearlyMI([], {});
  assert.equal(a.mi_total, 0);
  assert.equal(a.mi_downtime_h, 0);
  assert.deepEqual(a.by_month, []);
});

test('malformed udf_json does not throw', () => {
  const a = aggregateYearlyMI([{ site: 'X', created_time: '2026-02-01T00:00:00', udf_json: '{not json' }], {});
  assert.equal(a.mi_total, 1);
  assert.equal(a.mi_high, 1, 'defaults to High/P2 when udf unreadable and not Enterprise');
});
