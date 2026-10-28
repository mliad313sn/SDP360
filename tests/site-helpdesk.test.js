// tests/site-helpdesk.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { _computeSiteHelpdesk } = require('../reports-db');   // pure inner, see Step 3

// _computeSiteHelpdesk(rows, groups) is the PURE core: given request_records
// rows already filtered to the month, produce the contract block. This keeps
// the SQL thin and the aggregation testable without a DB.
const rows = [
  { pending_status: 0, overdue_status: 0, request_type: 'Incident',       category: 'Network', sub_category: 'WAN',  template: null },
  { pending_status: 0, overdue_status: 1, request_type: 'Incident',       category: 'Network', sub_category: 'WAN',  template: null },
  { pending_status: 1, overdue_status: 1, request_type: 'Incident',       category: 'Network', sub_category: 'WAN',  template: null },
  { pending_status: 1, overdue_status: 0, request_type: 'Service Request',category: 'Access',  sub_category: 'AD',   template: null },
  { pending_status: 0, overdue_status: 0, request_type: 'Major Incident', category: 'Power',   sub_category: 'UPS',  template: 'Major Incident Report' },
];

test('created/resolved/backlog/sla_overdue', () => {
  const r = _computeSiteHelpdesk(rows);
  assert.strictEqual(r.created, 5);
  assert.strictEqual(r.resolved, 3);       // pending_status = 0
  assert.strictEqual(r.backlog, 2);        // pending_status = 1
  assert.strictEqual(r.sla_overdue, 2);    // overdue_status = 1
});

test('major_incidents counts request_type OR template', () => {
  assert.strictEqual(_computeSiteHelpdesk(rows).major_incidents, 1);
});

test('top_categories is by VOLUME, desc, capped at 5', () => {
  const r = _computeSiteHelpdesk(rows);
  assert.deepStrictEqual(r.top_categories[0], { category: 'Network', count: 3 });
  assert.ok(r.top_categories.length <= 5);
});

test('recurring = (category / sub_category) with count >= 3', () => {
  const r = _computeSiteHelpdesk(rows);
  assert.deepStrictEqual(r.recurring, [{ label: 'Network / WAN', count: 3 }]);
});

test('empty rows → all-zero block, never throws', () => {
  const r = _computeSiteHelpdesk([]);
  assert.deepStrictEqual(r, { created: 0, resolved: 0, backlog: 0, sla_overdue: 0, major_incidents: 0, top_categories: [], recurring: [] });
});
