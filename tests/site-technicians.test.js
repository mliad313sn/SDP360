// tests/site-technicians.test.js
'use strict';
process.env.REPORTS_BACKEND = 'sqlite';
const test = require('node:test');
const assert = require('node:assert');
const { _computeTechStats } = require('../reports-db');

const rows = [
  { technician: 'Amina', pending_status: 0, overdue_status: 0, reopen_count: 0, hours: 4 },
  { technician: 'Amina', pending_status: 0, overdue_status: 1, reopen_count: 1, hours: 8 },
  { technician: 'Amina', pending_status: 1, overdue_status: 0, reopen_count: 0, hours: null },
  // closed but with NO resolved_time/completed_time → hours NULL. Must NOT
  // contribute a phantom 0 to the average (+null === 0 passes Number.isFinite).
  { technician: 'Amina', pending_status: 0, overdue_status: 0, reopen_count: 0, hours: null },
  { technician: 'Bakary', pending_status: 0, overdue_status: 0, reopen_count: 0, hours: 2 },
  { technician: null,    pending_status: 0, overdue_status: 0, reopen_count: 0, hours: 1 },
];

test('aggregates per technician, drops the NULL bucket', () => {
  const r = _computeTechStats(rows);
  assert.strictEqual(r.length, 2);
  const a = r.find(t => t.name === 'Amina');
  assert.strictEqual(a.assigned, 4);
  assert.strictEqual(a.resolved, 3);
  assert.strictEqual(a.current_load, 1);      // pending_status = 1
  assert.strictEqual(a.sla_overdue, 1);
  assert.strictEqual(a.reopened, 1);
  assert.strictEqual(a.avg_resolution_h, 6);  // (4+8)/2 — the NULL-hours closed row is excluded, NOT counted as 0
});

test('sorted by assigned desc', () => {
  assert.strictEqual(_computeTechStats(rows)[0].name, 'Amina');
});

test('no rows → []', () => { assert.deepStrictEqual(_computeTechStats([]), []); });
