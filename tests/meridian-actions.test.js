'use strict';
// F1 Task A2 — flattenOpenActions: buildSiteActions() result → the C2 open-actions
// API shape, with a stable "<source>:<action_id|uid>" id and a PII-safe whitelist.
const { test } = require('node:test');
const assert = require('node:assert');
const { flattenOpenActions, actionId, attachProjectLinks } = require('../services/meridianActions');

const sa = { groups: {
  meetings:   { items: [{ source:'meetings', action_id:1234, title:'Fix radio', owner:'Koffi',
                          status:'open', due_date:'2026-08-20', age_days:12, overdue:true,
                          origin_label:'HGO_Maint_PV_2026-05', requester:'SHOULD_NOT_LEAK' }], count:1, oldest_days:12 },
  inspection: { items: [], count:0, oldest_days:null },
  report:     { items: [{ source:'report', action_id:null, uid:'9f3a', title:'Patch server', owner:'Ada',
                          status:'in_progress', due_date:null, age_days:5, overdue:false, origin_label:'W33' }], count:1, oldest_days:5 },
}, totals: { open:2 } };

test('flattens all groups into C2 shape with stable ids', () => {
  const out = flattenOpenActions('HGO', sa, '2026-08-11');
  assert.equal(out.site, 'HGO'); assert.equal(out.as_of, '2026-08-11');
  assert.equal(out.actions.length, 2);
  const m = out.actions.find(a => a.source === 'meetings'); assert.equal(m.id, 'meetings:1234');
  const r = out.actions.find(a => a.source === 'report');   assert.equal(r.id, 'report:9f3a');
});

test('PII-safe: only whitelisted keys survive (no requester leak)', () => {
  const out = flattenOpenActions('HGO', sa, '2026-08-11');
  const m = out.actions.find(a => a.source === 'meetings');
  assert.deepEqual(Object.keys(m).sort(),
    ['age_days','due_date','id','origin_label','overdue','owner','source','status','title'].sort());
  assert.ok(!('requester' in m));
});

test('actionId prefers action_id, falls back to uid', () => {
  assert.equal(actionId({ source:'inspection', action_id:7 }), 'inspection:7');
  assert.equal(actionId({ source:'report', action_id:null, uid:'abc' }), 'report:abc');
});

test('empty / missing groups → empty actions, never throws', () => {
  assert.deepEqual(flattenOpenActions('X', {}, '2026-01-01').actions, []);
  assert.deepEqual(flattenOpenActions('X', { groups:{} }, '2026-01-01').actions, []);
});

test('attachProjectLinks: sets it.project on matching rows, null elsewhere, builds url', () => {
  const s = JSON.parse(JSON.stringify(sa));
  const links = { 'meetings:1234': { project_id:'PR-3', project_name:'WAN upgrade', activity_id:'AC-7' } };
  attachProjectLinks(s, links, 'https://m.example/');   // trailing slash trimmed
  const m = s.groups.meetings.items[0];
  assert.equal(m.project.name, 'WAN upgrade');
  assert.equal(m.project.id, 'PR-3');
  assert.equal(m.project.activity_id, 'AC-7');
  assert.equal(m.project.url, 'https://m.example/projects/PR-3');
  assert.equal(s.groups.report.items[0].project, null);   // unmatched → null, never fabricated
});

test('attachProjectLinks: empty map → all project null; missing base_url → url null', () => {
  const s = JSON.parse(JSON.stringify(sa));
  attachProjectLinks(s, {}, '');
  assert.equal(s.groups.meetings.items[0].project, null);
  const s2 = JSON.parse(JSON.stringify(sa));
  attachProjectLinks(s2, { 'meetings:1234': { project_id:'PR-3', project_name:'X' } }, '');
  assert.equal(s2.groups.meetings.items[0].project.url, null);   // no base_url → no deep-link
  assert.equal(s2.groups.meetings.items[0].project.name, 'X');
});
