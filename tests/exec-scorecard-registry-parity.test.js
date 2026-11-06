'use strict';
// E-A06 (audit A-06) — Executive Scorecard (browser maths) ↔ metric registry (server readers) parity.
// One fixture month is written to request_records (what the registry reads) AND expressed as the Zoho
// rows the Scorecard reads in the browser. Each KPI is compared: equal, or the difference is a NAMED,
// asserted divergence with its doctrine reference. An empty month stays null on both sides.
// No formula is changed here. Removing the client formulas stays behind `ui_exec_nav` + a PO decision.
//
// Browser side: public/lib/dashboard-shared.js loaded in a vm (isClosed, resolutionSla, periodSlaRates),
// plus the three Scorecard formulas that live inline in public/executive.html (closure %, reopen %,
// avg resolution days) — copied below and pinned to their source text so a change there fails here.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const rdb = require('../reports-db');
const MR = require('../services/metricRegistry');

const ctx = { window: {}, console };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'lib', 'dashboard-shared.js'), 'utf8')
  + '\n;this.__s = { isClosed, resolutionSla, periodSlaRates, parseZohoDT };', ctx);
const B = ctx.__s;
const EXEC = fs.readFileSync(path.join(__dirname, '..', 'public', 'executive.html'), 'utf8');

// ── the inline executive.html formulas, verbatim in substance ────────────────────────────────────
const closurePct = (periodRows) => { const c = periodRows.filter(B.isClosed); return periodRows.length > 0 ? Math.round(c.length / periodRows.length * 100) : null; };
const reopenPct = (periodRows) => { const c = periodRows.filter(B.isClosed); const r = c.filter((x) => parseInt(x['Reopen Count'] || 0) > 0); return c.length > 0 ? Math.round(r.length / c.length * 1000) / 10 : null; };
const avgResolveDays = (closedRows) => { let s = 0, n = 0; for (const r of closedRows) { const ct = B.parseZohoDT(r['Created Time']); const res = B.parseZohoDT(r['Resolved Time'] || r['Completed Time']); if (ct && res) { const df = Math.floor((res - ct) / 86400000); if (df >= 0 && df < 365) { s += df; n++; } } } return n ? Math.round(s / n) : null; };

test('the copied Scorecard formulas still match executive.html (pin)', () => {
  assert.ok(EXEC.includes('var closurePct = periodRows.length > 0 ? Math.round(_closurePeriodClosed.length / periodRows.length * 100) : null;'), 'closure % formula changed in executive.html — update this parity test');
  assert.ok(EXEC.includes("var reopenedPeriod = closedPeriod.filter(function(r){return parseInt(r['Reopen Count']||0)>0;});"), 'reopen % numerator changed');
  assert.ok(EXEC.includes('var reopenPct = closedPeriod.length>0?Math.round(reopenedPeriod.length/closedPeriod.length*1000)/10:null;'), 'reopen % formula changed');
  assert.ok(EXEC.includes('var df=Math.floor((res-ct)/86400000);if(df>=0&&df<365){rdS+=df;rdN++;}'), 'avg resolution per-ticket rule changed');
  assert.ok(EXEC.includes('avgResolveDays: rdN ? Math.round(rdS/rdN) : null'), 'avg resolution rounding changed');
});

// ── fixture: one neutral description → DB row + browser row ──────────────────────────────────────
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const zoho = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}, ${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:00`; };
let n = 0;
async function siteWithGroup(name, group) {
  await rdb.db.prepare('INSERT INTO sites (name, zoho_group) VALUES (?, ?) ON CONFLICT DO NOTHING').run(name, group);
  return Number((await rdb.db.prepare('SELECT id FROM sites WHERE name=?').get(name)).id);
}
async function load(group, tickets) {
  const browser = [];
  for (const t of tickets) {
    const id = 'PARITY-' + (++n);
    const status = t.status || (t.pending === 0 ? 'Closed' : 'Open');
    await rdb.db.prepare(`INSERT INTO request_records (request_id, request_status, pending_status, overdue_status, responded_time, first_response_overdue, tech_group, created_time, resolved_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, status, t.pending, t.overdue === undefined ? 0 : t.overdue, t.responded || null, t.flag == null ? null : t.flag, group, t.created, t.resolved || null);
    browser.push({ 'Request ID': id, 'Request Status': status, 'Request Pending Status': t.pending === 0 ? 'No' : 'Yes',
      'Overdue Status': t.overdue == null ? '' : String(t.overdue), 'Responded Time': zoho(t.responded), 'First Response Overdue Status': t.flag == null ? '' : t.flag,
      'Created Time': zoho(t.created), 'Resolved Time': zoho(t.resolved), 'Reopen Count': String(t.reopen || 0), 'Group': group });
  }
  return browser;
}
const reg = (key, site, window) => MR.current().resolve(key, { site, window, deps: { rdb } });

// August 2026 — every edge the doctrine names: met, missed, cancelled, no SLA rule, open, reopened.
const AUG = [
  { pending: 0, overdue: 0, flag: 'false', created: '2026-08-03T08:00:00Z', responded: '2026-08-03T08:20:00Z', resolved: '2026-08-04T10:00:00Z' },
  { pending: 0, overdue: 1, flag: 'true', created: '2026-08-05T08:00:00Z', responded: '2026-08-05T12:00:00Z', resolved: '2026-08-08T09:00:00Z' },
  { pending: 0, overdue: 0, status: 'Cancelled', flag: '', created: '2026-08-06T08:00:00Z', responded: '2026-08-06T08:30:00Z', resolved: '2026-08-06T09:00:00Z' },
  { pending: 0, overdue: null, flag: null, created: '2026-08-07T08:00:00Z', responded: '2026-08-07T09:00:00Z', resolved: '2026-08-07T15:00:00Z' },
  { pending: 1, overdue: 1, flag: null, created: '2026-08-10T08:00:00Z' },
  { pending: 0, overdue: 0, flag: 'false', reopen: 1, created: '2026-08-11T08:00:00Z', responded: '2026-08-11T08:10:00Z', resolved: '2026-08-13T08:00:00Z' },
];

test('Aug 2026 fixture: equal where the doctrine agrees, named divergences elsewhere', async () => {
  const site = await siteWithGroup('Parity Site', 'Parity Desk');
  const rows = await load('Parity Desk', AUG);

  // Closure % — EQUAL: closed / inbound, both rounded to an integer.
  const c = await reg('helpdesk.closure_pct', site, '2026-08');
  assert.equal(closurePct(rows), 83); assert.equal(c.value, 83);

  // First-reply SLA % — EQUAL: (responded AND not flagged) / responded; an empty flag is not a breach.
  const fr = await reg('helpdesk.first_reply_sla_pct', site, '2026-08');
  const brFr = B.periodSlaRates(rows).fr_violated_pct;
  assert.equal(fr.value, 80); assert.equal(Math.round(100 - brFr), 80);

  // Resolution SLA % — KNOWN DIVERGENCE D-RES (CLAUDE.md "KPI denominator doctrine" + UAT ITSM-05,
  // reports-db._getCalendarMonthlyHelpdeskPg): the registry drops CANCELLED tickets and tickets with NO SLA rule
  // (overdue_status NULL) from the denominator and rounds to an integer; the Scorecard tile
  // (dashboard-shared.resolutionSla, C-30) keeps both in the closed denominator, counts them as met, and
  // rounds to one decimal. Same ticket set, three answers:
  const s = await reg('helpdesk.resolution_sla_pct', site, '2026-08');
  assert.equal(s.value, 67, 'registry: 2 met of 3 SLA-bearing closed tickets');
  assert.equal(B.resolutionSla(rows, { definition: 'flag' }).ok_pct, 80, 'Scorecard (flag rule): 4 of 5 closed');
  assert.equal(B.resolutionSla(rows, { definition: 'flag', excludeCancelled: true }).ok_pct, 75, 'Scorecard with the C-31 policy block still keeps the no-SLA ticket');
  assert.equal(B.resolutionSla(rows).ok_pct, 80, 'Scorecard default rule (due_vs_resolved, no Due By here → flag fallback)');

  // Reopen % — NO REGISTRY COUNTERPART (D-REOPEN): request_records carries no reopen count; only the
  // browser computes it (reopened-of-closed / closed, doctrine denominator).
  assert.equal(reopenPct(rows), 20);
  assert.ok(!MR.current().list({}).some((m) => /reopen/i.test(m.key)), 'if a reopen metric is added, pin its parity here');

  // Average resolution — KNOWN DIVERGENCE D-AVG: the registry metric is hours over tickets CREATED in the
  // window (mean of exact durations, helpdesk.window); the Scorecard shows integer DAYS (mean of per-ticket
  // floor, AP-aligned) over closed tickets. Not convertible into each other:
  const w = await MR.READERS['helpdesk.window']({ rdb }, { site, win: { from: '2026-08-01', to: '2026-08-31' } });
  assert.equal(avgResolveDays(rows.filter(B.isClosed)), 1, 'Scorecard: floor days 1,3,0,0,2 → mean 1.2 → 1');
  assert.equal(w.avg_resolution_h, 31, 'registry: exact durations 26,73,1,7,48 h → mean 31 h');
  // They happen to agree after unit conversion on this fixture (31 h ≈ 1.3 d → 1); a ticket resolved in
  // 47 h counts 1 day on the Scorecard and 47 h in the registry, so they are NOT the same measure.
  assert.equal(avgResolveDays([{ 'Request Status': 'Closed', 'Created Time': '1 Aug, 2026 08:00:00', 'Resolved Time': '3 Aug, 2026 07:00:00' }]), 1);
});

test('clean month (no cancelled, every ticket SLA-bearing): resolution SLA agrees once rounded', async () => {
  const site = await siteWithGroup('Parity Clean', 'Parity Clean Desk');
  const rows = await load('Parity Clean Desk', [
    { pending: 0, overdue: 0, flag: 'false', created: '2026-09-02T08:00:00Z', responded: '2026-09-02T08:05:00Z', resolved: '2026-09-02T12:00:00Z' },
    { pending: 0, overdue: 1, flag: 'false', created: '2026-09-03T08:00:00Z', responded: '2026-09-03T08:05:00Z', resolved: '2026-09-05T12:00:00Z' },
    { pending: 0, overdue: 0, flag: 'true', created: '2026-09-04T08:00:00Z', responded: '2026-09-04T11:00:00Z', resolved: '2026-09-04T18:00:00Z' },
    { pending: 1, overdue: 0, flag: null, created: '2026-09-08T08:00:00Z' },
  ]);
  const s = await reg('helpdesk.resolution_sla_pct', site, '2026-09');
  assert.equal(s.value, 67);
  assert.equal(Math.round(B.resolutionSla(rows, { definition: 'flag' }).ok_pct), 67);
  assert.equal((await reg('helpdesk.closure_pct', site, '2026-09')).value, closurePct(rows));
  assert.equal((await reg('helpdesk.first_reply_sla_pct', site, '2026-09')).value, Math.round(100 - B.periodSlaRates(rows).fr_violated_pct));
});

test('empty month: null on both sides for every KPI — never 0', async () => {
  const site = await siteWithGroup('Parity Empty', 'Parity Empty Desk');
  for (const k of ['helpdesk.closure_pct', 'helpdesk.resolution_sla_pct', 'helpdesk.first_reply_sla_pct']) {
    const r = await reg(k, site, '2026-03');
    assert.equal(r.value, null, k); assert.equal(r.rag, 'NA', k);
  }
  assert.equal(closurePct([]), null);
  assert.equal(reopenPct([]), null);
  assert.equal(avgResolveDays([]), null);
  assert.equal(B.resolutionSla([]).ok_pct, null);
  assert.equal(B.periodSlaRates([]).fr_violated_pct, null);
  const w = await MR.READERS['helpdesk.window']({ rdb }, { site, win: { from: '2026-03-01', to: '2026-03-31' } });
  assert.equal(w.avg_resolution_h, null);
});
