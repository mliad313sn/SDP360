'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { deriveSiteStatus } = require('../services/execSummary');

// input: array of { site, open_incidents, has_active_mi, overdue_open }
test('deriveSiteStatus: active MI → major (highest)', () => {
  const out = deriveSiteStatus([{ site: 'LAFIGUE', open_incidents: 3, has_active_mi: true, overdue_open: 1 }]);
  assert.equal(out[0].status, 'major');
});
test('deriveSiteStatus: overdue open, no MI → degraded', () => {
  const out = deriveSiteStatus([{ site: 'SABODALA', open_incidents: 2, has_active_mi: false, overdue_open: 1 }]);
  assert.equal(out[0].status, 'degraded');
});
test('deriveSiteStatus: clean → operational and EXCLUDED (exception-only)', () => {
  const out = deriveSiteStatus([{ site: 'MANA', open_incidents: 1, has_active_mi: false, overdue_open: 0 }]);
  assert.equal(out.length, 0);
});
test('deriveSiteStatus: major before degraded, cap 4', () => {
  const rows = [
    { site: 'A', open_incidents: 1, has_active_mi: false, overdue_open: 1 }, // degraded
    { site: 'B', open_incidents: 1, has_active_mi: true,  overdue_open: 0 }, // major
    { site: 'C', open_incidents: 1, has_active_mi: false, overdue_open: 2 }, // degraded
    { site: 'D', open_incidents: 1, has_active_mi: false, overdue_open: 1 }, // degraded
    { site: 'E', open_incidents: 1, has_active_mi: false, overdue_open: 1 }, // degraded (5th → dropped)
  ];
  const out = deriveSiteStatus(rows);
  assert.equal(out.length, 4);
  assert.equal(out[0].status, 'major');       // B first
});
