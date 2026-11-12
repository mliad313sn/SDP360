'use strict';
// A7 — "Stop flattering the SLA": the open & breached count and the dual compliance rate (closed only vs incl. open
// past target) on a HAND-COMPUTED fixture, through the shared rule (public/lib/slaDual.js) and the Helpdesk-page adapter
// (dashboard-shared dualSlaRates). Boundary: a ticket due exactly at the as-of instant is not breached; on hold = SLA
// paused (only the stored flag counts); cancelled and no-SLA-rule tickets are never judged; no base = null, never 0.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SlaDual = require('../public/lib/slaDual');

function load() {
  const ctx = { window: {}, console };
  const lib = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'lib', f), 'utf8');
  vm.runInNewContext(lib('slaDual.js') + '\n' + lib('dashboard-shared.js') + '\n;this.__f = dualSlaRates;', ctx);
  return ctx;
}
const closed = (o = {}) => ({ 'Request Status': 'Closed', 'Request Pending Status': 'No', 'Overdue Status': '0', ...o });
const open = (o = {}) => ({ 'Request Status': 'Open', 'Request Pending Status': 'Yes', 'Overdue Status': '0', ...o });
const AS_OF = new Date(2026, 8, 1, 0, 0, 0).getTime();   // August 2026 → exclusive end 1 Sep 00:00 (local)

const FIXTURE = [
  closed({ 'Responded Time': '01 Aug 2026 09:00:00 AM', 'First Response Overdue Status': 'false' }),   // ok · fr ok
  closed({ 'Responded Time': '02 Aug 2026 09:00:00 AM', 'First Response Overdue Status': 'true' }),    // ok · fr late
  closed({ 'Overdue Status': '1', 'Responded Time': '03 Aug 2026 09:00:00 AM', 'First Response Overdue Status': 'false' }), // late
  open({ 'Overdue Status': '1', 'First Response Overdue Status': 'true' }),                    // BREACHED (flag) · FR BREACHED
  open({ 'Due By Time': '30 Aug 2026 10:00:00 AM', 'First Response Overdue Status': 'false' }), // BREACHED (due < asOf)
  open({ 'Due By Time': '01 Sep 2026 00:00:00' }),                                           // due exactly at asOf → not
  open({ 'Request Status': 'On Hold', 'Due By Time': '10 Aug 2026 10:00:00 AM' }),            // on hold, no flag → not (paused)
  open({ 'Request Status': 'On Hold', 'Overdue Status': '1' }),                                // on hold BUT flag → BREACHED
  open({ 'Request Status': 'Cancelled', 'Overdue Status': '1', 'First Response Overdue Status': 'true' }), // cancelled → never
  open({ 'Overdue Status': '' }),                                                              // no SLA rule → never
  open({ 'Due By Time': '15 Sep 2026 10:00:00 AM' }),                                         // due after asOf → not
];

test('hand-computed fixture: resolution closed-only 66.7 %, incl. open 33.3 %, 3 open & breached', () => {
  const r = load().__f(FIXTURE, { asOfMs: AS_OF, definition: 'flag' });
  // closed: 3 tickets, 1 late → 2/3
  assert.deepEqual({ ...r.resolution.closed_only }, { definition: 'closed_only', den: 3, violated: 1, ok_pct: 66.7, violated_pct: 33.3 });
  // + 3 open & breached counted as failures → 2/6
  assert.equal(r.resolution.open_breached, 3);
  assert.deepEqual({ ...r.resolution.incl_open }, { definition: 'incl_open', den: 6, violated: 4, ok_pct: 33.3, violated_pct: 66.7 });
});

test('hand-computed fixture: first response closed-only (responded) 66.7 %, incl. open 50 %, 1 open & breached', () => {
  const r = load().__f(FIXTURE, { asOfMs: AS_OF, definition: 'flag' });
  assert.equal(r.first_response.closed_only.den, 3);
  assert.equal(r.first_response.closed_only.ok_pct, 66.7);
  assert.equal(r.first_response.open_breached, 1);
  assert.equal(r.first_response.incl_open.den, 4);
  assert.equal(r.first_response.incl_open.ok_pct, 50);
});

test('boundary: due exactly at as-of is not breached; one millisecond later it is', () => {
  const due = new Date(2026, 8, 1).getTime();
  assert.equal(SlaDual.openResBreached({ closed: false, status: 'Open', dueMs: due }, due), false);
  assert.equal(SlaDual.openResBreached({ closed: false, status: 'Open', dueMs: due }, due + 1), true);
});

test('on hold pauses the due-time comparison; the flag still counts; closed / cancelled never open-breached', () => {
  assert.equal(SlaDual.openResBreached({ closed: false, status: 'On Hold', dueMs: 1 }, 10), false);
  assert.equal(SlaDual.openResBreached({ closed: false, status: 'Onhold', resFlag: 'true' }, 10), true);
  assert.equal(SlaDual.openResBreached({ closed: true, status: 'Closed', resFlag: '1' }, 10), false);
  assert.equal(SlaDual.openResBreached({ closed: false, status: 'Canceled', resFlag: '1' }, 10), false);
  assert.equal(SlaDual.openFrBreached({ closed: false, status: 'Open', responded: true, frFlag: 'true' }), false);
});

test('no base → null, never 0; unknown open count → incl-open null', () => {
  const r = load().__f([], { asOfMs: AS_OF });
  assert.equal(r.resolution.closed_only.ok_pct, null);
  assert.equal(r.resolution.incl_open.ok_pct, null);
  assert.equal(r.resolution.open_breached, 0);
  const d = SlaDual.dual({ den: 10, violated: 1, openBreached: null });
  assert.equal(d.closed_only.ok_pct, 90);
  assert.equal(d.incl_open.ok_pct, null);
  assert.equal(d.open_breached, null);
  // nothing closed but 2 open breached → 0 % incl. open is a real measurement (2 judged, 2 failed)
  const e = SlaDual.dual({ den: 0, violated: 0, openBreached: 2 });
  assert.equal(e.closed_only.ok_pct, null);
  assert.equal(e.incl_open.ok_pct, 0);
});

test('headline definition normalises to closed_only (today) and labels name the definition in both languages', () => {
  assert.equal(SlaDual.normalizeHeadline(undefined), 'closed_only');
  assert.equal(SlaDual.normalizeHeadline('nonsense'), 'closed_only');
  assert.equal(SlaDual.normalizeHeadline('incl_open'), 'incl_open');
  assert.match(SlaDual.label('closed_only', 'fr'), /clôturés uniquement/);
  assert.match(SlaDual.label('incl_open', 'en'), /open/);
});

test('page without slaDual.js: incl-open half is unknown (null), closed-only unchanged', () => {
  const ctx = { window: {}, console };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'lib', 'dashboard-shared.js'), 'utf8') + '\n;this.__f = dualSlaRates;', ctx);
  const r = ctx.__f(FIXTURE, { asOfMs: AS_OF, definition: 'flag' });
  assert.equal(r.resolution.closed_only.ok_pct, 66.7);
  assert.equal(r.resolution.incl_open.ok_pct, null);
  assert.equal(r.resolution.open_breached, null);
});

test('Exec View: sla_compliance carries both rates + open & breached; sla_headline_definition picks the big number', async () => {
  const ES = require('../services/execSummary');
  const row = (vio, inc, ob) => ({ 'Closed Requests Count': 10, '% of SLA Violated': vio, '% of SLA Violated (incl. open past target)': inc, 'Open Breached (resolution)': ob });
  const rdb = { async getMonthlyHelpdeskHistory() { return [row(20, 40, 3), row(10, 30, 4), row(0, 0, 0)]; },
    async getRequestMetrics() { return {}; }, async getSurveyKpisDB() { return { rows1: [], rows2: [] }; },
    async getChangeMetrics() { return {}; }, async getChangesWindow() { return {}; } };
  const now = new Date('2026-09-15T00:00:00Z');
  const a = (await ES.mapHelpdeskKpis(rdb, now, {})).sla_compliance;
  assert.equal(a.definition, 'closed_only');
  assert.equal(a.value_pct, 90); assert.equal(a.value_pct_closed_only, 90); assert.equal(a.value_pct_incl_open, 70);
  assert.equal(a.open_breached, 4); assert.equal(a.delta_pp, 10);
  const b = (await ES.mapHelpdeskKpis(rdb, now, { sla_headline_definition: 'incl_open' })).sla_compliance;
  assert.equal(b.definition, 'incl_open'); assert.equal(b.value_pct, 70); assert.equal(b.delta_pp, 10);
  const pub = ES.buildExecSummary({ helpdesk: { sla_compliance: b }, siteRows: [] }).kpis.sla_compliance;
  assert.deepEqual(Object.keys(pub).sort(), ['definition', 'delta_pp', 'open_breached', 'value_pct', 'value_pct_closed_only', 'value_pct_incl_open']);
});
