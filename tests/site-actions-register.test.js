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

test('report follow-up age derives from first_logged (its earliest report week)', () => {
  const rep = { report_id: 500, week_label: 'W29 2026', actions: [
    { id: 9, uid: 'u9', task: 'Old radio', owner: 'K', due_date: '2026-09-30',
      status: 'in_progress', first_logged: '2026-06-01' },   // logged 56 days before asOf
    { id: 10, uid: 'u10', task: 'No week', owner: 'K', status: 'open' }, // no first_logged → age null
  ]};
  const r = buildSiteActions({ report: rep, asOf });          // asOf = 2026-07-27
  const it = r.groups.report.items.find(x => x.title === 'Old radio');
  assert.equal(it.age_days, 56, '2026-06-01 → 2026-07-27 = 56 days');
  const nw = r.groups.report.items.find(x => x.title === 'No week');
  assert.equal(nw.age_days, null, 'no first_logged → age null (never faked)');
  assert.equal(r.groups.report.oldest_days, 56, 'group oldest reflects report ages now');
});

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

test('report terminal statuses closed AND cancelled are excluded', () => {
  const r = buildSiteActions({ report: { report_id: 3, week_label: 'W2', actions: [
    { task: 'open one', status: 'open' },
    { task: 'cancelled one', status: 'cancelled' },
    { task: 'closed one', status: 'closed' },
  ] }, asOf });
  assert.deepEqual(r.groups.report.items.map((x) => x.title), ['open one']);
});

test('merged report rows (source set) are folded out of the report group', () => {
  const r = buildSiteActions({ report: { report_id: 9, week_label: 'W1 2026', actions: [
    { id: 1, task: 'native follow-up', status: 'open' },
    { id: 2, task: 'retyped from a meeting', status: 'open', source: 'meetings', origin_id: 5 },
  ] }, asOf });
  assert.equal(r.groups.report.count, 1, 'merged row folded away (shown under its origin instead)');
  assert.equal(r.groups.report.items[0].title, 'native follow-up');
});

test('report rows carry their OWN report_id/week_label (cross-week aggregation)', () => {
  const r = buildSiteActions({ report: { actions: [
    { task: 'x', status: 'open', uid: 'u1', report_id: 77, week_label: 'W5 2026' },
  ] }, asOf });
  const it = r.groups.report.items[0];
  assert.equal(it.close.url, 'reports.html?report=77');
  assert.equal(it.origin_label, 'W5 2026');
});

test('empty / missing sources → empty groups, no throw', () => {
  const r = buildSiteActions({ asOf });
  assert.equal(r.groups.meetings.count, 0);
  assert.equal(r.groups.inspection.count, 0);
  assert.equal(r.groups.report.count, 0);
  assert.equal(r.totals.open, 0);
});

// 2026-10-05 — Business Incubation actions get their OWN group in the hub (they used to be
// mixed into Meetings). Recognised by the session's intake_source, or its _INC_ reference.
test('incubation actions form their own group, out of Meetings', () => {
  const m = [
    { id: 31, description: 'PV action', status: 'open', target_date: '2026-08-01', created_at: '2026-07-01T00:00:00Z',
      meeting_reference: 'SGO_Mining_PV_2026-07', intake_source: 'dept_meeting' },
    { id: 32, description: 'Incubation action', status: 'in_progress', target_date: '2026-08-01', created_at: '2026-07-10T00:00:00Z',
      meeting_reference: 'SGO_Mining_INC_2026-07', intake_source: 'business_incubation' },
    { id: 33, description: 'Imported incubation, no intake column', status: 'open', created_at: '2026-07-12T00:00:00Z',
      meeting_reference: 'SGO_Geology_INC_2026-07' },
    { id: 34, description: 'Closed incubation', status: 'resolved', meeting_reference: 'SGO_X_INC_2026-07', intake_source: 'business_incubation' },
  ];
  const r = buildSiteActions({ meetings: m, asOf });
  assert.deepEqual(r.groups.meetings.items.map(i => i.action_id), [31]);
  assert.deepEqual(r.groups.incubation.items.map(i => i.action_id), [32, 33]);
  assert.equal(r.groups.incubation.items[0].source, 'incubation');
  assert.equal(r.groups.incubation.oldest_days, 17);
  assert.equal(r.totals.open, 3, 'incubation counts in the total');
});

test('no incubation action → an empty incubation group, never missing', () => {
  const r = buildSiteActions({ meetings, inspection, report, asOf });
  assert.deepEqual(r.groups.incubation, { items: [], count: 0, oldest_days: null });
});

test('the hub page renders an incubation block that posts to the meetings action route', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../public/site-actions.html'), 'utf8');
  assert.match(src, /key: 'incubation', title: 'Business Incubation'[^}]*api: '\/api\/meetings\/actions\/'/);
});

// 2026-10-05 — open issues (meetings + incubation) in the hub, with how many OPEN actions
// treat each one, so « sans action seulement » and « + Action » can work without duplicates.
test('issues group: open only, severity then overdue order, open-action count, not in totals.open', () => {
  const issues = [
    { id: 1, title: 'Low one', severity: 'LOW', status: 'open', target_date: '2026-07-01', created_at: '2026-06-01T00:00:00Z', meeting_reference: 'SGO_A_PV_2026-06', meeting_id: 9 },
    { id: 2, title: 'High one', severity: 'HIGH', status: 'in_progress', target_date: '2026-09-01', created_at: '2026-07-01T00:00:00Z', meeting_reference: 'SGO_A_INC_2026-07', meeting_id: 8, champion: 'Awa', escalate: 1 },
    { id: 3, title: 'Done', severity: 'HIGH', status: 'resolved' },
  ];
  const meetingsRows = [
    { id: 50, description: 'treats 2', status: 'open', linked_issue_id: 2, meeting_reference: 'SGO_A_INC_2026-07' },
    { id: 51, description: 'closed, treats 1', status: 'resolved', linked_issue_id: 1 },
  ];
  const r = buildSiteActions({ issues, meetings: meetingsRows, asOf });
  const it = r.groups.issues.items;
  assert.deepEqual(it.map(i => i.issue_id), [2, 1], 'HIGH first; resolved left out');
  assert.equal(it[0].source, 'issue');
  assert.equal(it[0].open_actions, 1);
  assert.equal(it[1].open_actions, 0, 'a closed action does not treat the issue');
  assert.equal(it[0].severity, 'HIGH'); assert.equal(it[0].owner, 'Awa'); assert.equal(it[0].escalated, true);
  assert.equal(it[0].incubation, true); assert.equal(it[0].meeting_id, 8);
  assert.equal(it[1].overdue, true);
  assert.equal(r.totals.open, 1, 'issues are not actions — totals.open unchanged');
  assert.equal(r.totals.issues, 2);
  // the action carries its linked issue so the page can offer to close it
  const act = r.groups.incubation.items[0];
  assert.equal(act.linked_issue_id, 2);
});

test('hub page: issues block, « sans action » filter, + Action modal, close-issue prompt', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../public/site-actions.html'), 'utf8');
  assert.match(src, /id="saNoAction"/, '« sans action seulement » checkbox');
  assert.match(src, /'\/api\/meetings\/issues\/' \+ encodeURIComponent\(\w+\) \+ '\/actions'/, '+ Action posts to the issue route');
  assert.match(src, /'\/api\/meetings\/issues\/' \+ encodeURIComponent\(\w+\) \+ '\/update'/, 'issue status/resolve posts to /update');
  assert.match(src, /Also mark the issue/, 'proposes resolving the linked issue');
  assert.match(src, /linked_issue_id/, 'uses the action→issue link');
  // every inline script still compiles
  const scripts = [...src.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(s => s.trim());
  for (const s of scripts) new Function(s);
});
