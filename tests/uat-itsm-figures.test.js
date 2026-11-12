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

test('F-DATA-07: the calendar reader returns the SLA denominators (closed with an SLA rule, responded) — null without a base, never 0', async () => {
  const site = await siteWithGroup('G4 SLA Base Site', 'G4 SLA Desk');
  const empty = await rdb.getCalendarMonthlyHelpdesk(site, 2026, 6);
  assert.strictEqual(empty.sla_res_den, null, 'no ticket: base not measured');
  assert.strictEqual(empty.sla_reply_den, null);
  const g = 'G4 SLA Desk'; const c = '2026-05-05T08:00:00Z';
  await addReq({ group: g, created: c, pending: 0, overdue: 0, flag: 'false' });                 // in both bases
  await addReq({ group: g, created: c, pending: 0, overdue: 1, flag: 'true' });                  // in both bases
  await addReq({ group: g, created: c, pending: 0, overdue: 0, status: 'Cancelled', flag: '' }); // reply base only
  await addReq({ group: g, created: c, pending: 0, overdue: null, flag: null });                 // reply base only
  await addReq({ group: g, created: c, pending: 1, overdue: 0, responded: null });               // open, unanswered: neither
  const m = await rdb.getCalendarMonthlyHelpdesk(site, 2026, 5);
  assert.strictEqual(m.sla_res_den, 2, 'closed, SLA-bearing, not cancelled');
  assert.strictEqual(m.sla_reply_den, 4, 'responded tickets');
  assert.strictEqual(m.sla_res_pct, 50); assert.strictEqual(m.sla_reply_pct, 75);
  // only open, unanswered tickets → both bases null (the percentages are null too)
  await addReq({ group: g, created: '2026-04-05T08:00:00Z', pending: 1, overdue: 0, responded: null });
  const open = await rdb.getCalendarMonthlyHelpdesk(site, 2026, 4);
  assert.strictEqual(open.sla_res_den, null); assert.strictEqual(open.sla_res_pct, null);
  assert.strictEqual(open.sla_reply_den, null); assert.strictEqual(open.sla_reply_pct, null);
  // end to end through the registry: the tile now carries its base instead of "base not measured"
  const reg = MR.createRegistry();
  const r = await reg.resolve('helpdesk.resolution_sla_pct', { site, window: '2026-05', deps: { rdb }, now: new Date('2026-07-01T00:00:00Z') });
  assert.deepStrictEqual(r.base, { n: 2, label: 'closed tickets with an SLA rule (cancelled excluded)' });
  const r2 = await reg.resolve('helpdesk.first_reply_sla_pct', { site, window: '2026-05', deps: { rdb }, now: new Date('2026-07-01T00:00:00Z') });
  assert.deepStrictEqual(r2.base, { n: 4, label: 'responded tickets' });
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
