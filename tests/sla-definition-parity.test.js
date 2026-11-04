'use strict';

// A-17b — one switchable server SLA definition (services/slaDefinition.js).
// The browser rule (isResOverdue in public/lib/dashboard-shared.js) compares the
// resolved time to the due time and only falls back to the stored Overdue Status
// flag; every server reader uses the stored flag. Mode 'due_vs_resolved' must agree
// with the browser on every row; mode 'flag' (today's server behaviour, the default)
// disagrees exactly on the stale-flag rows — the documented divergence.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sla = require('../services/slaDefinition');
const rdb = require('../reports-db');

const ctx = { window: {}, console };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'lib', 'dashboard-shared.js'), 'utf8')
  + '\n;this.__isResOverdue = isResOverdue;', ctx);
const isResOverdue = ctx.__isResOverdue;

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
// 'YYYY-MM-DDTHH:MM' → Zoho browser string ("05 Aug 2026 10:00 AM") and DB ISO string.
function zoho(s) {
  if (!s) return '';
  const [d, t] = s.split('T'); const [y, m, dd] = d.split('-'); let [h, mi] = t.split(':').map(Number);
  const suf = h >= 12 ? 'PM' : 'AM'; const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${dd} ${MON[Number(m) - 1]} ${y} ${String(h12).padStart(2, '0')}:${String(mi).padStart(2, '0')} ${suf}`;
}
const iso = s => (s ? s + ':00.000Z' : null);

// The 8 seeded rows of the goal. flag = stored Overdue Status (null = no SLA rule).
const ROWS = [
  { id: 'on-time',      status: 'Closed',    pending: 0, due: '2026-08-05T10:00', res: '2026-08-04T10:00', flag: 0 },
  { id: 'late-stale0',  status: 'Closed',    pending: 0, due: '2026-08-05T10:00', res: '2026-08-06T10:00', flag: 0 },
  { id: 'early-stale1', status: 'Closed',    pending: 0, due: '2026-08-05T10:00', res: '2026-08-04T09:00', flag: 1 },
  { id: 'open-overdue', status: 'Open',      pending: 1, due: '2026-08-05T10:00', res: null,               flag: 1 },
  { id: 'cancelled',    status: 'Cancelled', pending: 0, due: '2026-08-05T10:00', res: '2026-08-06T10:00', flag: 0 },
  { id: 'no-due',       status: 'Closed',    pending: 0, due: null,               res: '2026-08-06T10:00', flag: 1 },
  { id: 'null-flag',    status: 'Closed',    pending: 0, due: null,               res: '2026-08-06T10:00', flag: null },
  { id: 'resolved',     status: 'Resolved',  pending: 0, due: '2026-08-05T10:00', res: '2026-08-05T09:00', flag: 0 },
];
const browserRow = r => ({ 'Request Status': r.status, 'DueBy Time': zoho(r.due), 'Resolved Time': zoho(r.res),
  'Overdue Status': r.flag == null ? '' : String(r.flag) });
const dbRow = r => ({ request_id: 'SLA-PAR-' + r.id, request_status: r.status, pending_status: r.pending,
  overdue_status: r.flag, due_by_time: iso(r.due), resolved_time: iso(r.res), completed_time: null });

test('mode due_vs_resolved agrees with the browser isResOverdue on all 8 rows', () => {
  for (const r of ROWS) {
    assert.strictEqual(sla.resOverdueRow(dbRow(r), 'due_vs_resolved'), isResOverdue(browserRow(r)), r.id);
  }
});

test('mode flag (default) disagrees with the browser exactly on the two stale-flag rows', () => {
  const diff = ROWS.filter(r => sla.resOverdueRow(dbRow(r), 'flag') !== isResOverdue(browserRow(r))).map(r => r.id);
  assert.deepStrictEqual(diff.sort(), ['early-stale1', 'late-stale0']);
  // default mode = flag; unknown mode falls back to flag
  for (const r of ROWS) {
    assert.strictEqual(sla.resOverdueRow(dbRow(r)), sla.resOverdueRow(dbRow(r), 'flag'), r.id);
    assert.strictEqual(sla.resOverdueRow(dbRow(r), 'bogus'), sla.resOverdueRow(dbRow(r), 'flag'), r.id);
  }
  // A cancelled ticket that still carries flag 1 is a further documented divergence:
  // mode flag keeps today's count (stored flag), the browser never counts a cancelled ticket.
  const cx = ROWS.find(r => r.id === 'cancelled');
  assert.strictEqual(sla.resOverdueRow(dbRow({ ...cx, flag: 1 }), 'flag'), true);
  assert.strictEqual(sla.resOverdueRow(dbRow({ ...cx, flag: 1 }), 'due_vs_resolved'), false);
  assert.strictEqual(isResOverdue(browserRow({ ...cx, flag: 1 })), false);
  assert.strictEqual(sla.resOverdueSql(), 'overdue_status = 1');
  assert.strictEqual(sla.resOverdueSql('bogus'), 'overdue_status = 1');
  assert.strictEqual(sla.normalizeMode('due_vs_resolved'), 'due_vs_resolved');
  assert.strictEqual(sla.normalizeMode(''), 'flag');
});

test('resOverdueSql counts the same rows as the browser on request_records (PostgreSQL)', async () => {
  for (const r of ROWS) {
    const o = dbRow(r);
    await rdb.db.prepare(`INSERT INTO request_records (request_id, request_status, pending_status, overdue_status,
      due_by_time, resolved_time, completed_time, created_time) VALUES (?,?,?,?,?,?,?,?)`)
      .run(o.request_id, o.request_status, o.pending_status, o.overdue_status, o.due_by_time, o.resolved_time,
        o.completed_time, '2026-08-01T00:00:00.000Z');
  }
  const ids = async mode => (await rdb.db.prepare(`SELECT request_id FROM request_records
      WHERE request_id LIKE 'SLA-PAR-%' AND (${sla.resOverdueSql(mode)}) ORDER BY request_id`).all())
    .map(x => x.request_id.replace('SLA-PAR-', ''));
  const browser = ROWS.filter(r => isResOverdue(browserRow(r))).map(r => r.id).sort();
  assert.deepStrictEqual(await ids('due_vs_resolved'), browser);
  const flagRows = ROWS.filter(r => sla.resOverdueRow(dbRow(r), 'flag')).map(r => r.id).sort();
  assert.deepStrictEqual(await ids('flag'), flagRows);
});
