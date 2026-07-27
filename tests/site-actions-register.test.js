'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildSiteActions } = require('../services/siteActionsRegister');

const asOf = '2026-07-27';

const meetings = [
  { id: 11, description: 'Fix VSAT', owner_it: 'Ousmane', target_date: '2026-07-01',
    status: 'open', created_at: '2026-06-27T00:00:00Z', meeting_reference: 'HGO_Maintenance_2026-06' },
  { id: 12, description: 'Done thing', owner_it: 'X', target_date: '2026-07-20',
    status: 'closed', created_at: '2026-07-20T00:00:00Z', meeting_reference: 'HGO_2026-07' }, // excluded
];
const inspection = [
  { id: 21, description: 'Replace UPS', owner: 'Boubacar', due_date: '2026-07-10',
    status: 'Open', created_at: '2026-07-17T00:00:00Z', inspection_label: 'HGO IT 2026-07-17' },
  { id: 22, description: 'Closed insp', owner: 'Y', due_date: '2026-07-01',
    status: 'Closed', created_at: '2026-07-01T00:00:00Z', inspection_label: 'x' }, // excluded
];
const report = {
  report_id: 500, week_label: 'W29 2026', actions: [
    { id: 1, task: 'Update NAS', owner: 'Ismael', due_date: '2026-07-30', status: 'open' },
    { id: 2, task: 'Monitoring', owner: 'Z', due_date: '2026-07-01', status: 'in_progress' },
    { id: 3, task: 'Closed follow', owner: 'W', due_date: '2026-06-01', status: 'closed' }, // excluded
  ],
};

test('excludes terminal statuses per source', () => {
  const r = buildSiteActions({ meetings, inspection, report, asOf });
  assert.equal(r.groups.meetings.count, 1);
  assert.equal(r.groups.inspection.count, 1);
  assert.equal(r.groups.report.count, 2);
  assert.equal(r.totals.open, 4);
});

test('meetings row normalized with real age + overdue + inline close', () => {
  const r = buildSiteActions({ meetings, inspection, report, asOf });
  const m = r.groups.meetings.items[0];
  assert.equal(m.source, 'meetings');
  assert.equal(m.title, 'Fix VSAT');
  assert.equal(m.owner, 'Ousmane');
  assert.equal(m.due_date, '2026-07-01');
  assert.equal(m.overdue, true);
  assert.equal(m.age_days, 30);
  assert.equal(m.origin_label, 'HGO_Maintenance_2026-06');
  assert.equal(m.action_id, 11);
  assert.deepEqual(m.close, { kind: 'inline' });
});

test('inspection row normalized (age 10, overdue, inline)', () => {
  const r = buildSiteActions({ meetings, inspection, report, asOf });
  const i = r.groups.inspection.items[0];
  assert.equal(i.source, 'inspection');
  assert.equal(i.title, 'Replace UPS');
  assert.equal(i.age_days, 10);
  assert.equal(i.overdue, true);
  assert.equal(i.action_id, 21);
});

test('report rows: age null, deep-link close, overdue by due_date', () => {
  const r = buildSiteActions({ meetings, inspection, report, asOf });
  const items = r.groups.report.items;
  assert.equal(items.length, 2);
  for (const it of items) {
    assert.equal(it.source, 'report');
    assert.equal(it.age_days, null);
    assert.equal(it.action_id, null);
    assert.deepEqual(it.close, { kind: 'link', url: 'reports.html?report=500' });
    assert.equal(it.origin_label, 'W29 2026');
  }
  const nas = items.find((x) => x.title === 'Update NAS');
  const mon = items.find((x) => x.title === 'Monitoring');
  assert.equal(nas.overdue, false); // due 2026-07-30 > asOf
  assert.equal(mon.overdue, true);  // due 2026-07-01 < asOf
});

test('oldest_days per group (report null since no created ts)', () => {
  const r = buildSiteActions({ meetings, inspection, report, asOf });
  assert.equal(r.groups.meetings.oldest_days, 30);
  assert.equal(r.groups.inspection.oldest_days, 10);
  assert.equal(r.groups.report.oldest_days, null);
});

test('merged report rows (source set) are folded out of the report group', () => {
  const r = buildSiteActions({ report: { report_id: 9, week_label: 'W1 2026', actions: [
    { id: 1, task: 'native follow-up', status: 'open' },
    { id: 2, task: 'retyped from a meeting', status: 'open', source: 'meetings', origin_id: 5 },
  ] }, asOf });
  assert.equal(r.groups.report.count, 1, 'merged row folded away (shown under its origin instead)');
  assert.equal(r.groups.report.items[0].title, 'native follow-up');
});

test('empty / missing sources → empty groups, no throw', () => {
  const r = buildSiteActions({ asOf });
  assert.equal(r.groups.meetings.count, 0);
  assert.equal(r.groups.inspection.count, 0);
  assert.equal(r.groups.report.count, 0);
  assert.equal(r.totals.open, 0);
});
