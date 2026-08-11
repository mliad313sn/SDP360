'use strict';
// F1 Task A2 — flattenOpenActions: buildSiteActions() result → the C2 open-actions
// API shape, with a stable "<source>:<action_id|uid>" id and a PII-safe whitelist.
const { test } = require('node:test');
const assert = require('node:assert');
const { flattenOpenActions, actionId } = require('../services/meridianActions');

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
