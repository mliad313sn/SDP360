'use strict';
// External UAT 2026-10-29 (ITSM seat) — figures that misled a service owner.
const { test } = require('node:test');
const assert = require('node:assert');
const { ragOverride } = require('../services/dashboardData');
const MR = require('../services/metricRegistry');
const KpiRag = require('../services/kpiRag');

test('ITSM-01: a widget-level RAG policy gives the same colour as the registry, whatever the policy scale', () => {
  assert.equal(ragOverride('tracker-executive', 22, '%'), 'RED', 'a 22 % roadmap score is not green');
  assert.equal(ragOverride('tracker-executive', 15, '%'), 'RED');
  for (const [name, p] of Object.entries(KpiRag.POLICIES)) {
    if (p.scale === 'target-ratio') continue;
    for (const v of [0, 15, 22, 55, 69, 70, 85, 90, 99, 100]) {
      assert.equal(ragOverride(name, v, '%'), MR.ragFor({ rag_policy: name, unit: '%' }, v), `${name} @ ${v}`);
    }
  }
  assert.equal(ragOverride('tracker-executive', null, '%'), 'NA');
});

// ── ITSM-02 / 03 / 04 / 05 on a real database ────────────────────────────────────────────
const rdb = require('../reports-db');
let n = 0;
async function addReq(o) {
  await rdb.db.prepare(`INSERT INTO request_records (request_id, request_status, pending_status, overdue_status, responded_time, first_response_overdue, tech_group, created_time, resolved_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('UAT-ITSM-' + (++n), o.status || (o.pending === 0 ? 'Closed' : 'Open'), o.pending, o.overdue === undefined ? 0 : o.overdue,
    o.responded === undefined ? '2026-08-03T09:00:00Z' : o.responded, o.flag === undefined ? 'false' : o.flag, o.group || 'UAT Desk', o.created || '2026-08-03T08:00:00Z', o.resolved || null);
}
async function siteWithGroup(name, group) {
  await rdb.db.prepare('INSERT INTO sites (name, zoho_group) VALUES (?, ?) ON CONFLICT DO NOTHING').run(name, group);
  return Number((await rdb.db.prepare('SELECT id FROM sites WHERE name=?').get(name)).id);
}

test('ITSM-03/04/05: closure null without tickets; cancelled and no-SLA tickets out of the SLA; an empty reply flag is not a breach', async () => {
  const site = await siteWithGroup('UAT ITSM Site', 'UAT Desk');
  assert.equal((await rdb.getCalendarMonthlyHelpdesk(site, 2026, 7)).close_pct, null, 'no ticket in July: not measured');
  await addReq({ pending: 0, overdue: 0, flag: 'false' });                 // met, replied on time
  await addReq({ pending: 0, overdue: 1, flag: 'true' });                  // missed, replied late
  await addReq({ pending: 0, overdue: 0, status: 'Cancelled', flag: '' }); // cancelled: out of the SLA
  await addReq({ pending: 0, overdue: null, flag: null });                 // no SLA rule: out of the SLA
  const m = await rdb.getCalendarMonthlyHelpdesk(site, 2026, 8);
  assert.equal(m.inbound, 4); assert.equal(m.closed, 4);
  assert.equal(m.sla_res_pct, 50, '1 met of 2 SLA-bearing closed tickets');
  assert.equal(m.sla_reply_pct, 75, '3 of 4 replies not flagged late');
});

test('ITSM-02: the window reader feeds overdue and average resolution time; a site without a group is not measured', async () => {
  const site = await siteWithGroup('UAT ITSM Window', 'UAT Window Desk');
  await addReq({ group: 'UAT Window Desk', pending: 0, overdue: 1, created: '2026-09-07T08:00:00Z', resolved: '2026-09-07T12:00:00Z' });
  await addReq({ group: 'UAT Window Desk', pending: 1, overdue: 1, created: '2026-09-08T08:00:00Z' });
  const w = await rdb.getSiteHelpdeskWindow(site, '2026-09-07', '2026-09-13');
  assert.equal(w.sla_overdue, 2); assert.equal(w.avg_resolution_h, 4); assert.equal(w.scoped, true);
  const reg = MR.READERS['helpdesk.window'];
  const r = await reg({ rdb }, { site, win: { from: '2026-09-07', to: '2026-09-13' } });
  assert.equal(r.overdue, 2); assert.equal(r.avg_resolution_h, 4);
  const bare = await siteWithGroup('UAT ITSM No Group', '');
  assert.equal(await reg({ rdb }, { site: bare, win: { from: '2026-09-07', to: '2026-09-13' } }), null);
});

test("ITSM-07: the shared SLA check reads Zoho's 'DueBy Time' column (the due-date comparison was silently skipped)", () => {
  const vm = require('vm'); const ctx = { window: {}, console };
  vm.runInNewContext(require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'lib', 'dashboard-shared.js'), 'utf8') + '\n;this.__f = isResOverdue;', ctx);
  const late = { 'Request Status': 'Closed', 'DueBy Time': '05 Aug 2026 10:00 AM', 'Resolved Time': '06 Aug 2026 10:00 AM', 'Overdue Status': '0' };
  assert.equal(ctx.__f(late), true, 'resolved after its due time = missed, whatever the stale flag says');
  assert.equal(ctx.__f({ ...late, 'Resolved Time': '04 Aug 2026 10:00 AM', 'Overdue Status': '1' }), false);
  assert.equal(ctx.__f({ ...late, 'Request Status': 'Cancelled' }), false);
});
