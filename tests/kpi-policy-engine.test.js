'use strict';
// C-31 — KPI Policy Builder engine (pure): validation of the building blocks, evaluation, diff, and the
// EQUIVALENCE PROOF — the helpdesk resolution-SLA rules in force today (dashboard-shared resolutionSla under both
// helpdesk_sla_definition values, the server's slaDefinition rule, the calendar-month reader's rule) are
// expressible as policies and give the SAME figure as today's code on one fixture.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const E = require('../services/kpiPolicyEngine');
const SlaDef = require('../services/slaDefinition');

const ROOT = path.join(__dirname, '..');
function loadShared() {
  const ctx = { window: {}, console };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public/lib/siteAliases.js'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'public/lib/dashboard-shared.js'), 'utf8'), ctx);
  return ctx;
}
const base = () => JSON.parse(JSON.stringify(E.IMPORTED_DEFINITIONS['helpdesk.resolution_sla_pct'][1].definition));

// ── A browser-shape fixture covering every branch the rules disagree on ──────────────────────────────────────
let n = 0;
function z(o) {
  return { 'Request Display ID': String(++n), Site: o.site || 'HOUNDE', Group: 'G', 'Request Type': o.type || 'Incident', Priority: o.prio || 'Medium',
    'Request Status': o.status, 'Request Pending Status': o.pending == null ? '' : o.pending, 'Overdue Status': o.flag == null ? '' : o.flag,
    'Due By Time': o.due || '', 'Resolved Time': o.res || '', 'Completed Time': o.comp || '', 'Created Time': o.created || '03 Aug 2026 09:00 AM' };
}
const FIX = [
  z({ status: 'Closed', pending: 'No', flag: '0', due: '05 Aug 2026 10:00 AM', res: '04 Aug 2026 10:00 AM' }),          // met both
  z({ status: 'Closed', pending: 'No', flag: '0', due: '05 Aug 2026 10:00 AM', res: '06 Aug 2026 10:00 AM' }),          // stale flag: late by dates
  z({ status: 'Resolved', pending: 'No', flag: '1', due: '05 Aug 2026 10:00 AM', res: '04 Aug 2026 09:00 PM' }),        // stale flag: on time by dates
  z({ status: 'Closed', pending: 'No', flag: '1' }),                                                                     // no dates → flag fallback
  z({ status: 'Cancelled', pending: 'No', flag: '1' }),                                                                  // cancelled with flag set
  z({ status: 'Cancelled', pending: '', flag: '0' }),                                                                    // cancelled via closed-status fallback
  z({ status: 'Closed', pending: '', flag: 'yes', due: '05 Aug 2026 12:00 PM', comp: '05 Aug 2026 12:30 PM' }),         // completed time, PM/12h
  z({ status: 'Open', pending: 'Yes', flag: '1' }),                                                                      // open: out of denominator
  z({ status: 'On Hold', pending: 'Yes', flag: '0' }),
  z({ status: 'Closed', pending: 'No', flag: 'true', due: '01 Aug 2026 12:00 AM', res: '31 Jul 2026 11:59 PM' }),       // AM 12 → 00
  z({ status: 'Closed', pending: 'No', flag: '' }),                                                                      // no SLA rule (flag empty)
];
for (let i = 0; i < 9; i++) FIX.push(z({ status: 'Closed', pending: 'No', flag: i % 3 ? '0' : '1', site: 'MANA', due: '10 Aug 2026 10:00 AM', res: (i % 2 ? '09' : '11') + ' Aug 2026 10:00 AM' }));
const CANON = FIX.map(E.fromZohoTicket);

test('equivalence proof: both helpdesk_sla_definition values reproduce dashboard-shared resolutionSla (tile / ranking / trend) exactly', () => {
  const S = loadShared();
  const [flagPol, dvrPol] = E.IMPORTED_DEFINITIONS['helpdesk.resolution_sla_pct'];
  for (const [pol, def] of [[flagPol, 'flag'], [dvrPol, 'due_vs_resolved']]) {
    const today = S.resolutionSla(FIX, { definition: def });
    const got = E.evaluate(pol.definition, CANON);
    assert.equal(got.value, today.ok_pct, def + ': same %');
    assert.equal(got.n, today.closed, def + ': same denominator (cancelled closed tickets in)');
    assert.equal(got.n - got.numerator_n, today.violated, def + ': same missed count');
    // per site, as the ranking does
    for (const site of ['HOUNDE', 'MANA']) {
      const rows = FIX.filter((r) => r.Site === site);
      assert.equal(E.evaluate(pol.definition, rows.map(E.fromZohoTicket)).value, S.resolutionSla(rows, { definition: def }).ok_pct, def + ' ' + site);
    }
    assert.deepEqual(E.toResolutionSlaOpts(pol.definition), { definition: def, excludeCancelled: false, minN: 10, rounding: 1 });
  }
  // the two rules really differ on this fixture (otherwise the proof proves nothing)
  assert.notEqual(S.resolutionSla(FIX, { definition: 'flag' }).ok_pct, S.resolutionSla(FIX, { definition: 'due_vs_resolved' }).ok_pct);
});

test('equivalence proof: the server rule (services/slaDefinition, pending_status = 0 denominator) and the calendar-month reader rule', () => {
  // server rows = canonical rows; today's server count = pending_status=0 AND resOverdueRow(mode)
  // (zoho-sync computePendingStatus: the stored flag, else the closed status set — the same rule as is_closed)
  const isClosedSrv = (r) => r.pending_status === 0 || (r.pending_status == null && ['closed', 'resolved', 'cancelled'].includes(String(r.request_status).toLowerCase()));
  for (const mode of ['flag', 'due_vs_resolved']) {
    const closed = CANON.filter(isClosedSrv);
    const viol = closed.filter((r) => SlaDef.resOverdueRow(r, mode)).length;
    const def = base(); def.numerator = [{ block: 'sla_met', rule: mode, cancelled_never_missed: false }]; def.rounding = 0;
    const got = E.evaluate(def, CANON);
    assert.equal(got.n, closed.length); assert.equal(got.n - got.numerator_n, viol, mode);
    assert.equal(got.value, Math.round((1 - viol / closed.length) * 100), mode);
  }
  // reports-db getCalendarMonthlyHelpdesk: cancelled + no-SLA-rule out of the denominator, met = overdue_status = 0
  const def = base();
  def.denominator = [{ block: 'is_closed' }, { block: 'field_not_in', field: 'request_status', values: ['Cancelled', 'canceled'] }, { block: 'field_present', field: 'overdue_status' }];
  def.numerator = [{ block: 'field_in', field: 'overdue_status', values: ['0'] }]; def.rounding = 0;
  const den = CANON.filter((r) => isClosedSrv(r) && !/cancel/i.test(r.request_status) && r.overdue_status !== '' && r.overdue_status != null);
  const ok = den.filter((r) => String(r.overdue_status) === '0').length;
  assert.equal(E.evaluate(def, CANON).value, Math.round(ok / den.length * 100));
  assert.equal(E.toResolutionSlaOpts(def), null, 'not expressible by the page helper → the page keeps today');
});

test('cancelled in / out of the SLA denominator is one block, and the page helper honours it', () => {
  const S = loadShared();
  const def = base(); def.denominator.push({ block: 'field_not_in', field: 'request_status', values: ['Cancelled'] });
  const opts = E.toResolutionSlaOpts(def);
  assert.deepEqual(opts, { definition: 'due_vs_resolved', excludeCancelled: true, minN: 10, rounding: 1 });
  const page = S.resolutionSla(FIX, { definition: opts.definition, excludeCancelled: true });
  const got = E.evaluate(def, CANON);
  assert.equal(got.value, page.ok_pct); assert.equal(got.n, page.closed);
  assert.ok(got.n < E.evaluate(base(), CANON).n, 'cancelled tickets left the denominator');
});

test('validate: unknown blocks / keys / fields are rejected, a ratio needs a denominator, thresholds must be consistent', () => {
  assert.equal(E.validate(base()).ok, true);
  const codes = (d) => E.validate(d).errors.map((e) => e.code);
  let d = base(); d.denominator = [{ block: 'raw_sql', sql: 'DELETE FROM users' }]; assert.ok(codes(d).includes('unknown_block'));
  d = base(); d.denominator = []; assert.ok(codes(d).includes('ratio_without_denominator'));
  d = base(); delete d.denominator; assert.ok(codes(d).includes('ratio_without_denominator'));
  d = base(); d.rag = { green: 70, amber: 90 }; assert.ok(codes(d).includes('inconsistent_thresholds'), 'higher is better: green below amber');
  d = base(); d.direction = 'lower_is_better'; assert.ok(codes(d).includes('inconsistent_thresholds'));
  d = base(); d.rag = { green: 90, amber: 70, by_site_class: { office: { green: 80, amber: 85 } } }; assert.ok(codes(d).includes('inconsistent_thresholds'));
  d = base(); d.rag.by_site_class = { moon: { green: 1, amber: 0 } }; assert.ok(codes(d).includes('unknown_site_class'));
  d = base(); d.code = 'process.exit()'; assert.ok(codes(d).includes('unknown_key'));
  d = base(); d.numerator = [{ block: 'field_in', field: 'password_hash', values: ['x'] }]; assert.ok(codes(d).includes('unknown_field'));
  d = base(); d.null_handling = 'zero'; assert.ok(codes(d).includes('null_must_be_unknown'), 'null = UNKNOWN, never 0');
  d = base(); d.dataset = 'changes'; assert.ok(codes(d).includes('block_not_in_dataset'), 'sla blocks are helpdesk-only');
  d = base(); d.window = { kind: 'rolling' }; assert.ok(codes(d).includes('bad_window_n'));
  d = { ...base(), aggregation: 'percentile', percentile: 90, value_field: 'resolution_hours', unit: 'hours', direction: 'lower_is_better', rag: { green: 24, amber: 48 } };
  delete d.denominator; delete d.numerator; d.filters = [{ block: 'is_closed' }];
  assert.equal(E.validate(d).ok, true, JSON.stringify(E.validate(d).errors));
  assert.throws(() => E.evaluate({ dataset: 'nope' }, []), /invalid KPI policy/);
});

test('evaluate: null = UNKNOWN never 0, minimum sample → NOT_COMPARABLE, RAG per site class, target linkage, other aggregations', () => {
  const d = base();
  assert.deepEqual([E.evaluate(d, []).value, E.evaluate(d, []).rag], [null, 'UNKNOWN']);
  const few = E.evaluate(d, CANON.slice(0, 5));
  assert.equal(few.comparable, false); assert.equal(few.rag, 'NOT_COMPARABLE');
  const all = E.evaluate(d, CANON);
  assert.equal(all.comparable, true); assert.ok(['GREEN', 'AMBER', 'RED'].includes(all.rag));
  const dd = base(); dd.rag = { green: 99, amber: 98, by_site_class: { office: { green: 1, amber: 0 } } };
  assert.equal(E.evaluate(dd, CANON).rag, 'RED'); assert.equal(E.evaluate(dd, CANON, { siteClass: 'office' }).rag, 'GREEN');
  assert.equal(E.evaluate(d, CANON, { target: 50 }).vs_target.rag, 'GREEN');
  assert.equal(E.evaluate(d, CANON).vs_target.rag, 'NA', 'no target → no verdict');
  // windows: the month of the fixture vs another month
  assert.equal(E.evaluate(d, CANON, E.windowRange(d.window, '2026-08-20')).n, all.n);
  assert.equal(E.evaluate(d, CANON, E.windowRange(d.window, '2026-09-20')).value, null);
  assert.deepEqual(E.windowRange({ kind: 'week' }, '2026-11-05'), { from: '2026-11-02', to: '2026-11-08' });
  assert.deepEqual(E.windowRange({ kind: 'quarter' }, '2026-11-05'), { from: '2026-10-01', to: '2026-12-31' });
  assert.deepEqual(E.windowRange({ kind: 'rolling', n: 7 }, '2026-11-05'), { from: '2026-10-30', to: '2026-11-05' });
  const cnt = { ...base(), aggregation: 'count', unit: 'count', direction: 'lower_is_better', rag: null, filters: [{ block: 'field_in', field: 'request_status', values: ['open', 'on hold'] }], min_sample: 0 };
  delete cnt.denominator; delete cnt.numerator;
  assert.equal(E.evaluate(cnt, CANON).value, 2); assert.equal(E.evaluate(cnt, CANON).rag, null);
  const med = { ...cnt, aggregation: 'median', value_field: 'resolution_hours', unit: 'hours', filters: [{ block: 'is_closed' }] };
  assert.equal(E.evaluate(med, [{ pending_status: 0, created_time: '2026-08-01T00:00:00', resolved_time: '2026-08-01T10:00:00' }, { pending_status: 0, created_time: '2026-08-01T00:00:00', resolved_time: '2026-08-01T20:00:00' }]).value, 15);
  const by = E.evaluateBy(d, CANON, (r) => r.site);
  assert.deepEqual(Object.keys(by).sort(), ['HOUNDE', 'MANA']);
});

test('diff lists exactly the changed settings', () => {
  const a = base(), b = base();
  b.rag.green = 95; b.denominator.push({ block: 'field_not_in', field: 'request_status', values: ['Cancelled'] });
  const d = E.diff(a, b);
  assert.deepEqual(d.map((x) => x.path).sort(), ['denominator', 'rag.green']);
  assert.equal(d.find((x) => x.path === 'rag.green').to, 95);
  assert.deepEqual(E.diff(a, base()), []);
});

test('imported definitions are honest: valid, labelled as not adopted, thresholds traced to today’s registry policy', () => {
  const KpiRag = require('../services/kpiRag');
  for (const p of E.IMPORTED_DEFINITIONS['helpdesk.resolution_sla_pct']) {
    assert.equal(E.validate(p.definition).ok, true);
    assert.match(p.rationale, /not yet adopted by the committee/);
    const pol = KpiRag.POLICIES ? KpiRag.POLICIES['sla-percent'] : null;
    if (pol) { assert.equal(p.definition.rag.green, pol.green); assert.equal(p.definition.rag.amber, pol.amber); }
  }
  const cat = E.catalogue();
  assert.ok(cat.datasets.helpdesk_tickets && cat.blocks.sla_met && !JSON.stringify(cat).includes('function'));
});
