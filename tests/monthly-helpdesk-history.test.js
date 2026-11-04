'use strict';

// A-17b — getMonthlyHelpdeskHistory (org-wide monthly history feeding the Exec View and
// executive.html): first-response violations match the same IN set as the other readers,
// a month with nothing to judge returns null (not a fake 0 %), and the resolution SLA
// predicate follows the switchable definition (default 'flag' = today's count).

const { test, before } = require('node:test');
const assert = require('node:assert');
const rdb = require('../reports-db');

const now = new Date();
const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const created = `${ym}-01T12:00:00.000Z`;
let n = 0;
async function add(o) {
  await rdb.db.prepare(`INSERT INTO request_records (request_id, request_status, pending_status, overdue_status,
      due_by_time, resolved_time, responded_time, first_response_overdue, created_time)
      VALUES (?,?,?,?,?,?,?,?,?)`).run('MHH-' + (++n), o.status, o.pending, o.flag, o.due || null,
    o.res || null, o.responded || null, o.fro || null, created);
}

before(async () => {
  // closed late with a stale 0 flag (the documented divergence)
  await add({ status: 'Closed', pending: 0, flag: 0, due: `${ym}-01T10:00:00.000Z`, res: `${ym}-02T10:00:00.000Z` });
  // closed on time
  await add({ status: 'Closed', pending: 0, flag: 0, due: `${ym}-03T10:00:00.000Z`, res: `${ym}-02T10:00:00.000Z` });
  // open, responded: first-response flags '1', 'yes', 'false'
  await add({ status: 'Open', pending: 1, flag: 0, responded: `${ym}-01T13:00:00.000Z`, fro: '1' });
  await add({ status: 'Open', pending: 1, flag: 0, responded: `${ym}-01T13:00:00.000Z`, fro: 'yes' });
  await add({ status: 'Open', pending: 1, flag: 0, responded: `${ym}-01T13:00:00.000Z`, fro: 'false' });
});

test('first_response_overdue "1" and "yes" count as violated (same IN set as the other readers)', async () => {
  const rows = await rdb.getMonthlyHelpdeskHistory(2);
  const cur = rows[rows.length - 1];
  assert.strictEqual(cur['Requests'], 5);
  assert.strictEqual(cur['% of First Responses SLA Violated'], 66.7);
});

test('a month with no closed / responded ticket returns null, not 0', async () => {
  const rows = await rdb.getMonthlyHelpdeskHistory(2);
  const prev = rows[0];
  assert.strictEqual(prev['Requests'], 0);
  assert.strictEqual(prev['% of SLA Violated'], null);
  assert.strictEqual(prev['% of First Responses SLA Violated'], null);
});

test('default call keeps the flag-based count; slaDefinition due_vs_resolved counts the stale-flag row', async () => {
  const def = (await rdb.getMonthlyHelpdeskHistory(2)).pop();
  assert.strictEqual(def['Closed Requests Count'], 2);
  assert.strictEqual(def['% of SLA Violated'], 0, 'flag: the stale 0 flag is trusted (today)');
  const flag = (await rdb.getMonthlyHelpdeskHistory(2, { slaDefinition: 'flag' })).pop();
  assert.strictEqual(flag['% of SLA Violated'], 0);
  const dvr = (await rdb.getMonthlyHelpdeskHistory(2, { slaDefinition: 'due_vs_resolved' })).pop();
  assert.strictEqual(dvr['% of SLA Violated'], 50);
  const bogus = (await rdb.getMonthlyHelpdeskHistory(2, { slaDefinition: 'x; DROP TABLE request_records' })).pop();
  assert.strictEqual(bogus['% of SLA Violated'], 0, 'unknown mode falls back to flag, never interpolated');
});
