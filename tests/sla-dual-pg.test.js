'use strict';
// A7 — the server readers carry the SAME dual rate + open & breached counts as the Helpdesk page (slaDual.js),
// on a hand-computed fixture in a real PostgreSQL: getCalendarMonthlyHelpdesk (site report, weekly/monthly decks,
// metric registry) and getMonthlyHelpdeskHistory (Exec View, executive scorecard monthly summary).
const { test } = require('node:test');
const assert = require('node:assert');
const rdb = require('../reports-db');

let n = 0;
async function addReq(o) {
  await rdb.db.prepare(`INSERT INTO request_records (request_id, request_status, pending_status, overdue_status, responded_time,
      first_response_overdue, tech_group, created_time, due_by_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('A7-' + (++n), o.status || (o.pending === 0 ? 'Closed' : 'Open'), o.pending,
    o.overdue === undefined ? 0 : o.overdue, o.responded === undefined ? null : o.responded, o.flag === undefined ? 'false' : o.flag,
    o.group || 'A7 Desk', o.created || '2026-08-03T08:00:00.000Z', o.due || null);
}
async function siteWithGroup(name, group) {
  await rdb.db.prepare('INSERT INTO sites (name, zoho_group) VALUES (?, ?) ON CONFLICT DO NOTHING').run(name, group);
  return Number((await rdb.db.prepare('SELECT id FROM sites WHERE name=?').get(name)).id);
}
const R = '2026-08-03T09:00:00.000Z';

test('getCalendarMonthlyHelpdesk: closed-only 67 %, incl. open past target 33 %, 3 open & breached (August 2026, as of 1 Sep 00:00Z)', async () => {
  const site = await siteWithGroup('A7 Site', 'A7 Desk');
  await addReq({ pending: 0, overdue: 0, responded: R, flag: 'false' });                      // ok · fr ok
  await addReq({ pending: 0, overdue: 0, responded: R, flag: 'true' });                       // ok · fr late
  await addReq({ pending: 0, overdue: 1, responded: R, flag: 'false' });                      // late
  await addReq({ pending: 1, overdue: 1, flag: 'true' });                                     // BREACHED (flag) · FR BREACHED
  await addReq({ pending: 1, overdue: 0, due: '2026-08-30T10:00:00.000Z' });                  // BREACHED (due < asOf)
  await addReq({ pending: 1, overdue: 0, due: '2026-09-01T00:00:00.000Z' });                  // due exactly at asOf → not
  await addReq({ pending: 1, overdue: 0, status: 'On Hold', due: '2026-08-10T10:00:00.000Z' }); // paused → not
  await addReq({ pending: 1, overdue: 1, status: 'On Hold' });                                // on hold but flagged → BREACHED
  await addReq({ pending: 1, overdue: 1, status: 'Cancelled', flag: 'true' });               // cancelled → never
  await addReq({ pending: 1, overdue: null, flag: null });                                   // no SLA rule → never
  await addReq({ pending: 1, overdue: 0, due: '2026-09-15T10:00:00.000Z' });                  // due after asOf → not
  await addReq({ pending: 1, overdue: 1, status: 'Closed' });                                // stale pending flag, closed status → not open
  const m = await rdb.getCalendarMonthlyHelpdesk(site, 2026, 8);
  assert.strictEqual(m.sla_res_den, 3);
  assert.strictEqual(m.sla_res_pct, 67, 'closed only: 2 of 3');
  assert.strictEqual(m.sla_res_open_breached, 3);
  assert.strictEqual(m.sla_res_den_incl_open, 6);
  assert.strictEqual(m.sla_res_pct_incl_open, 33, 'incl. open past target: 2 of 6');
  assert.strictEqual(m.sla_reply_den, 3);
  assert.strictEqual(m.sla_reply_pct, 67);
  assert.strictEqual(m.sla_reply_open_breached, 1);
  assert.strictEqual(m.sla_reply_den_incl_open, 4);
  assert.strictEqual(m.sla_reply_pct_incl_open, 50);
  assert.strictEqual(m.sla_as_of, '2026-09-01T00:00:00.000Z');
  assert.strictEqual(m.sla_definition, 'closed_only', 'the headline field sla_res_pct keeps its labelled definition');
});

test('getCalendarMonthlyHelpdesk: no ticket → every SLA figure null (never 0); no closed but open breached → incl. open measured', async () => {
  const site = await siteWithGroup('A7 Empty', 'A7 Empty Desk');
  const e = await rdb.getCalendarMonthlyHelpdesk(site, 2026, 8);
  for (const k of ['sla_res_pct_incl_open', 'sla_reply_pct_incl_open', 'sla_res_open_breached', 'sla_reply_open_breached']) assert.strictEqual(e[k], null, k);
  await addReq({ group: 'A7 Empty Desk', pending: 1, overdue: 1 });
  const m = await rdb.getCalendarMonthlyHelpdesk(site, 2026, 8);
  assert.strictEqual(m.sla_res_pct, null, 'nothing closed: closed-only not measured');
  assert.strictEqual(m.sla_res_open_breached, 1);
  assert.strictEqual(m.sla_res_pct_incl_open, 0, '1 judged, 1 failed');
});

test('getMonthlyHelpdeskHistory carries the incl-open violation % and the open & breached count per month', async () => {
  const hist = await rdb.getMonthlyHelpdeskHistory(4, { now: new Date('2026-09-15T00:00:00Z') });
  const aug = hist.find((r) => r['Created Time'] === 'Aug 2026');
  assert.ok(aug, 'August row');
  assert.ok('% of SLA Violated (incl. open past target)' in aug);
  assert.ok(aug['Open Breached (resolution)'] >= 3);
  assert.ok(aug['% of SLA Violated (incl. open past target)'] > aug['% of SLA Violated']);
});
