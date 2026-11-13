'use strict';
// W3-GOVERNANCE — pure engines: composite RAG + hysteresis (T9), DCMA 14 points (T11), gate checklist (T9), RAID,
// KPI cards / phase strip parity with the engines (T10). Hand-built fixtures, no database.
const { test } = require('node:test');
const assert = require('node:assert');
const RAG = require('../services/ppm/projectRag');
const DCMA = require('../services/ppm/dcma');
const GC = require('../services/ppm/gateChecklist');
const RAID = require('../services/ppm/raid');
const KPI = require('../services/ppm/projectKpis');
const ENGINE = require('../services/ppm/scheduleEngine');

const T = RAG.DEFAULT_THRESHOLDS;

test('RAG boundaries: lower-is-worse (SPI) at every edge, from green', () => {
  const r = (v, prev = null) => RAG.metricRag(v, T.spi, prev);
  assert.equal(r(0.8999), 'red'); assert.equal(r(0.90), 'amber', '0.90 is not < 0.90');
  assert.equal(r(0.9499), 'amber'); assert.equal(r(0.95), 'green', '0.95 is not < 0.95');
  assert.equal(r(1.2), 'green'); assert.equal(r(null), null, 'unknown is null, never green'); assert.equal(r(''), null);
});

test('RAG hysteresis: a red SPI stays red until 0.92, then amber until 0.97', () => {
  const r = (v, prev) => RAG.metricRag(v, T.spi, prev);
  assert.equal(r(0.91, 'red'), 'red', 'inside the band: stays red');
  assert.equal(r(0.9199, 'red'), 'red'); assert.equal(r(0.92, 'red'), 'amber', 'exit edge inclusive');
  assert.equal(r(0.97, 'red'), 'green', 'a big recovery jumps to green');
  assert.equal(r(0.96, 'amber'), 'amber', 'amber stays amber inside its band');
  assert.equal(r(0.9699, 'amber'), 'amber'); assert.equal(r(0.97, 'amber'), 'green');
  assert.equal(r(0.96, 'green'), 'green', 'from green 0.96 is green (no band on the way down)');
  assert.equal(r(0.89, 'amber'), 'red');
  // a flapping series: without hysteresis it would flip four times
  let prev = null; const seq = [0.94, 0.955, 0.945, 0.96, 0.97];
  const out = seq.map((v) => (prev = r(v, prev)));
  assert.deepEqual(out, ['amber', 'amber', 'amber', 'amber', 'green']);
});

test('RAG boundaries: higher-is-worse (slip working days, risk score)', () => {
  const s = (v, prev = null) => RAG.metricRag(v, T.slip_wd, prev);
  assert.equal(s(0), 'green'); assert.equal(s(1), 'amber'); assert.equal(s(10), 'amber', '10 is not > 10'); assert.equal(s(11), 'red');
  assert.equal(s(9, 'red'), 'red', 'stays red until <= 8'); assert.equal(s(8, 'red'), 'amber'); assert.equal(s(0, 'red'), 'green');
  assert.equal(s(-3), 'green', 'ahead of the baseline');
  const k = (v) => RAG.metricRag(v, T.risk_score, null);
  assert.equal(k(9), 'red'); assert.equal(k(6), 'amber'); assert.equal(k(4), 'green'); assert.equal(k(0), 'green');
});

test('composite RAG: worst component; unknown never green; risk alone cannot make a project green', () => {
  assert.equal(RAG.computeRag({}, null).rag, null, 'nothing measured = UNKNOWN');
  assert.equal(RAG.computeRag({ risk_score: 0 }, null).rag, null, 'an empty risk register alone is not green');
  assert.equal(RAG.computeRag({ risk_score: 9 }, null).rag, 'red', 'a measured severe risk still colours it');
  assert.equal(RAG.computeRag({ spi: 1, cpi: 1, slip_wd: 0, risk_score: 6 }, null).rag, 'amber');
  const c = RAG.computeRag({ spi: 0.96, cpi: 0.85, slip_wd: 2 }, null);
  assert.equal(c.rag, 'red'); assert.equal(c.components.cost.rag, 'red'); assert.equal(c.components.schedule.rag, 'amber');
  assert.deepEqual(c.measured, ['spi', 'cpi', 'slip_wd']);
  // state round-trip carries the hysteresis memory per metric
  const next = RAG.computeRag({ spi: 0.96, cpi: 0.91, slip_wd: 0 }, c.state);
  assert.equal(next.components.cost.rag, 'red', 'CPI 0.91 still inside the red band');
  assert.equal(next.components.schedule.rag, 'green', 'SPI 0.96 was green and slip 0 leaves amber (exit 0)');
});

test('RAG thresholds: config overrides, incoherent / bad JSON keeps the PROPOSED default and says so', () => {
  const d = RAG.parseThresholds('');
  assert.match(d.status, /PROPOSED/); assert.deepEqual(d.problems, []);
  const ok = RAG.parseThresholds(JSON.stringify({ spi: { red_enter: 0.85, red_exit: 0.87, amber_enter: 0.9, amber_exit: 0.93 } }));
  assert.equal(ok.thresholds.spi.red_enter, 0.85); assert.equal(ok.thresholds.cpi.red_enter, 0.90); assert.match(ok.status, /configured/);
  const bad = RAG.parseThresholds(JSON.stringify({ spi: { red_enter: 0.99, amber_enter: 0.9 } }));
  assert.equal(bad.thresholds.spi.red_enter, 0.90); assert.equal(bad.problems.length, 1); assert.match(bad.status, /PROPOSED/);
  assert.equal(RAG.parseThresholds('{not json').problems.length, 1);
});

// ---- DCMA fixture: a 6-task plan, Monday 2026-11-02 start, status date 2026-11-16 ----------------------------
function fixture(extra = {}) {
  const tasks = [
    { id: 1, name: 'Design', start_date: '2026-11-02', duration_days: 5, status: 'done', actual_start: '2026-11-02', actual_end: '2026-11-06', baseline_start: '2026-11-02', baseline_end: '2026-11-06', depends_on: [], progress_pct: 100, effort_hours: 40 },
    { id: 2, name: 'Build', duration_days: 10, status: 'in_progress', actual_start: '2026-11-09', depends_on: [1], baseline_start: '2026-11-09', baseline_end: '2026-11-20', progress_pct: 50, effort_hours: 80 },
    { id: 3, name: 'Docs', duration_days: 3, status: 'todo', depends_on: [1], progress_pct: 0, effort_hours: 24 },
    { id: 4, name: 'Test', duration_days: 5, status: 'todo', depends_on: [2], progress_pct: 0, effort_hours: 40 },
    { id: 5, name: 'Long', duration_days: 50, status: 'todo', depends_on: [3], progress_pct: 0, effort_hours: 400 },
    { id: 6, name: 'Go live', duration_days: 0, status: 'todo', depends_on: [4, 5], progress_pct: 0 },
  ];
  return tasks.map((t) => ({ ...t, ...(extra[t.id] || {}) }));
}
const sched = (tasks, deadline = null) => ENGINE.schedule(tasks, { anchor: '2026-11-02', deadline });
const pt = (r, id) => r.points.find((p) => p.id === id);

test('DCMA: 14 points; W2-only points are null (not measurable) without their data, never pass', () => {
  const tasks = fixture(); const s = sched(tasks);
  const r = DCMA.dcma14({ tasks, schedule: s, statusDate: '2026-11-16' });
  assert.equal(r.points.length, 14); assert.deepEqual(r.points.map((p) => p.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  for (const id of [2, 3, 4, 5, 10, 13]) { assert.equal(pt(r, id).value, null, `point ${id} has no data`); assert.equal(pt(r, id).pass, null); assert.ok(pt(r, id).basis); }
  // 1 logic: 5 incomplete leaves; task 6 has no successor, task 2/3... have preds+succs; 6 lacks successor → 1 of 5 = 20 %
  assert.equal(pt(r, 1).count, 1); assert.equal(pt(r, 1).of, 5); assert.equal(pt(r, 1).value, 20); assert.equal(pt(r, 1).pass, false);
  // 8 high duration: task 5 (50 d) of 5 incomplete with a duration
  assert.deepEqual(pt(r, 8).details, [5]); assert.equal(pt(r, 8).pass, false);
  // 6 high float: Build/Test path (15 d) vs Docs/Long (53 d) → Build, Test float = 38 d; nothing > 44
  assert.equal(pt(r, 6).count, 0); assert.equal(pt(r, 6).pass, true);
  assert.equal(pt(r, 7).value, 0, 'no deadline → no negative float'); assert.equal(pt(r, 7).pass, true);
  // 11 missed: baseline finish due ≤ 16 Nov = task 1 (done 6 Nov, on time) → 0 %; 14 BEI = 1/1
  assert.equal(pt(r, 11).value, 0); assert.equal(pt(r, 11).pass, true);
  assert.equal(pt(r, 14).value, 1); assert.equal(pt(r, 14).pass, true);
  // 12 critical path test: the finish moves by exactly the delay
  assert.equal(pt(r, 12).value, 600); assert.equal(pt(r, 12).pass, true);
  assert.equal(r.summary.not_measurable, 6);
});

test('DCMA: with W2 data present the link / constraint / resource / CPLI points light up', () => {
  const tasks = fixture({
    2: { dependency_links: [{ id: 1, type: 'FS', lag: 2 }], constraint_type: 'MSO', constraint_date: '2026-11-11', assignments: [{ resource_id: 1 }] },
    3: { dependency_links: [{ id: 1, type: 'SS', lag: -1 }], constraint_type: null },
    4: { constraint_type: null }, 5: { constraint_type: null }, 6: { constraint_type: null }, 1: { constraint_type: null },
  });
  const s = sched(tasks, '2027-01-01');
  const r = DCMA.dcma14({ tasks, schedule: s, statusDate: '2026-11-16', deadline: '2027-01-01' });
  assert.equal(pt(r, 2).value, 1, 'one negative lag = one lead'); assert.equal(pt(r, 2).pass, false);
  assert.equal(pt(r, 3).count, 1); assert.equal(pt(r, 3).of, 6);
  assert.equal(pt(r, 4).count, 5, '5 of 6 links FS'); assert.equal(pt(r, 4).pass, false, '83.3 % < 90 %');
  assert.deepEqual(pt(r, 5).details, [2], 'MSO is a hard constraint'); assert.equal(pt(r, 5).value, 20);
  assert.equal(pt(r, 10).count, 3, 'tasks 3,4,5 have a duration and no resource (2 is assigned, 6 is a milestone)');
  assert.ok(pt(r, 13).value != null); assert.equal(typeof pt(r, 13).pass, 'boolean');
});

test('DCMA: negative float, invalid dates and a cycle are reported, not hidden', () => {
  const tasks = fixture({ 6: { deadline: '2026-11-20' }, 4: { actual_start: '2026-12-31' } });
  const s = sched(tasks);
  const r = DCMA.dcma14({ tasks, schedule: s, statusDate: '2026-11-16' });
  assert.ok(pt(r, 7).count > 0, 'a deadline before the forecast finish gives negative float'); assert.equal(pt(r, 7).pass, false);
  assert.ok(pt(r, 9).details.includes(4), 'an actual start after the status date is invalid');
  const cyc = fixture({ 1: { depends_on: [6] } });
  const r2 = DCMA.dcma14({ tasks: cyc, schedule: sched(cyc), statusDate: '2026-11-16' });
  for (const id of [6, 7, 12]) assert.equal(pt(r2, id).pass, null, `point ${id}: no schedule on a cycle`);
});

// ---- gate checklist ----------------------------------------------------------------------------------------
const DEF = GC.normaliseDefinition({ items: [{ key: 'charter', label: 'Signed charter', kind: 'artifact' }, { key: 'risk-review', label: 'Risk review held', kind: 'check' }], approvers: [{ user_id: 7 }, { role: 'finance-viewer' }], rule: 'all' });

test('gate checklist: definition validation (never auto-approve, distinct people, quorum range)', () => {
  const t = (b, code) => assert.throws(() => GC.normaliseDefinition(b), (e) => e.reason === code);
  t({ items: [], approvers: [] }, 'NO_APPROVER');
  t({ items: [{ key: 'a', label: 'Aaa' }, { key: 'a', label: 'Bbb' }], approvers: [{ user_id: 1 }] }, 'DUPLICATE_ITEM');
  t({ items: [{ key: 'A b', label: 'Aaa' }], approvers: [{ user_id: 1 }] }, 'BAD_ITEM_KEY');
  t({ items: [{ key: 'a', label: 'Aaa', kind: 'x' }], approvers: [{ user_id: 1 }] }, 'BAD_ITEM_KIND');
  t({ approvers: [{ user_id: 1 }, { user_id: 1 }] }, 'DUPLICATE_APPROVER');
  t({ approvers: [{ user_id: 1 }], rule: 'quorum', quorum: 2 }, 'BAD_QUORUM');
  t({ approvers: [{}] }, 'BAD_APPROVER');
  assert.deepEqual(GC.normaliseDefinition({ approvers: [{ user_id: 2 }, { role: 'admin' }], rule: 'quorum', quorum: 1 }).quorum, 1);
});

test('gate checklist: owner cannot sign; non-approver refused; one person one slot; reject needs a reason', () => {
  assert.equal(GC.eligibleSlots(DEF, { id: 7 }, () => false, true).error.code, 'GATE_SOD');
  assert.equal(GC.eligibleSlots(DEF, { id: 9 }, () => false, false).error.code, 'NOT_AN_APPROVER');
  assert.deepEqual(GC.eligibleSlots(DEF, { id: 7 }, (r) => r === 'finance-viewer', false).slots, [0, 1]);
  assert.throws(() => GC.normaliseDecision({ decision: 'reject', reason: 'short' }), (e) => e.reason === 'REASON_REQUIRED');
  assert.throws(() => GC.normaliseDecision({ decision: 'maybe' }), (e) => e.reason === 'BAD_DECISION');
  // user 7 holds both a named slot and the role: fills ONE slot; the second slot goes to someone else
  const decisions = [{ id: 1, approver_id: 7, slot_index: 0, cycle_key: 'c', checklist_version: 1, decision: 'approve' }];
  assert.equal(GC.pickSlot([0, 1], decisions, 7), 0, 'keeps their slot');
  assert.equal(GC.pickSlot([1], decisions, 8), 1);
  assert.equal(GC.pickSlot([0], decisions, 8), null, 'slot 0 is held by someone else');
});

test('gate checklist: evaluation — items, all-required, quorum, standing reject, cycle and version scope', () => {
  const ev = [{ id: 1, item_key: 'charter', link: 'https://sp.example/charter.pdf', cycle_key: 'c' }, { id: 2, item_key: 'risk-review', link: null, cycle_key: 'c' }];
  const so = (id, who, slot, decision, extra = {}) => ({ id, approver_id: who, approver_name: 'u' + who, slot_index: slot, decision, cycle_key: 'c', checklist_version: 1, at: '2026-11-13T10:00:00Z', ...extra });
  const e0 = GC.evaluate({ definition: DEF, version: 1, evidence: [], signoffs: [], cycleKey: 'c' });
  assert.equal(e0.complete, false); assert.equal(e0.refusal.code, 'GATE_CHECKLIST');
  assert.equal(GC.evaluate({ definition: DEF, version: 1, evidence: [{ id: 1, item_key: 'charter', link: 'javascript:alert(1)', cycle_key: 'c' }, ev[1]], signoffs: [], cycleKey: 'c' }).refusal.code, 'GATE_CHECKLIST', 'an unsafe link is not evidence');
  const e1 = GC.evaluate({ definition: DEF, version: 1, evidence: ev, signoffs: [so(1, 7, 0, 'approve')], cycleKey: 'c' });
  assert.equal(e1.refusal.code, 'GATE_SIGNOFF'); assert.equal(e1.approved, 1); assert.equal(e1.required, 2);
  const e2 = GC.evaluate({ definition: DEF, version: 1, evidence: ev, signoffs: [so(1, 7, 0, 'approve'), so(2, 8, 1, 'approve')], cycleKey: 'c' });
  assert.equal(e2.complete, true); assert.equal(e2.refusal, null); assert.match(e2.note, /not a legal/);
  const e3 = GC.evaluate({ definition: DEF, version: 1, evidence: ev, signoffs: [so(1, 7, 0, 'approve'), so(2, 8, 1, 'approve'), so(3, 8, 1, 'reject', { reason: 'cost not justified enough' })], cycleKey: 'c' });
  assert.equal(e3.refusal.code, 'GATE_REJECTED', 'the latest decision of an approver counts');
  assert.equal(GC.evaluate({ definition: DEF, version: 2, evidence: ev, signoffs: [so(1, 7, 0, 'approve'), so(2, 8, 1, 'approve')], cycleKey: 'c' }).refusal.code, 'GATE_SIGNOFF', 'a redefined checklist needs fresh sign-offs');
  assert.equal(GC.evaluate({ definition: DEF, version: 1, evidence: ev, signoffs: [so(1, 7, 0, 'approve'), so(2, 8, 1, 'approve')], cycleKey: 'd' }).refusal.code, 'GATE_CHECKLIST', 'a new cycle needs fresh evidence and sign-offs');
  const Q = GC.normaliseDefinition({ approvers: [{ user_id: 7 }, { user_id: 8 }, { user_id: 9 }], rule: 'quorum', quorum: 2 });
  assert.equal(GC.evaluate({ definition: Q, version: 1, evidence: [], signoffs: [so(1, 7, 0, 'approve')], cycleKey: 'c' }).refusal.code, 'GATE_SIGNOFF');
  assert.equal(GC.evaluate({ definition: Q, version: 1, evidence: [], signoffs: [so(1, 7, 0, 'approve'), so(2, 8, 1, 'approve')], cycleKey: 'c' }).complete, true);
  assert.equal(GC.evaluate({ definition: null }).complete, true, 'no checklist defined = today');
});

// ---- RAID ----------------------------------------------------------------------------------------------------
test('RAID: kinds incl. dependency, P×I, exposure null when unknown, amounts masked for non-money readers', () => {
  assert.throws(() => RAID.normalise({ kind: 'x', title: 'abc' }), (e) => e.reason === 'BAD_KIND');
  assert.throws(() => RAID.normalise({ title: 'abc', probability: 4 }), (e) => e.reason === 'BAD_SCORE');
  assert.throws(() => RAID.normalise({ title: 'abc', impact_amount: 100 }), (e) => e.reason === 'CURRENCY_REQUIRED');
  assert.throws(() => RAID.normalise({ title: 'abc', review_date: '2026-02-30' }), (e) => e.reason === 'DATE_INVALID');
  const n = RAID.normalise({ kind: 'dependency', title: 'Fibre from carrier', probability: 2, impact: 3, impact_amount: 1000, impact_currency: 'usd', probability_pct: 40, response: 'mitigate', review_date: '2026-11-01', dependency_ref: 'Carrier order 42' });
  assert.equal(n.details.impact_currency, 'USD');
  const row = { id: 1, project_id: 2, ...n.row };
  const m = RAID.view(row, n.details, { today: '2026-11-13', money: true });
  assert.equal(m.score, 6); assert.equal(m.severity, 'high'); assert.equal(m.exposure_amount, 400); assert.equal(m.review_overdue, true);
  const h = RAID.view(row, n.details, { today: '2026-11-13', money: false });
  assert.equal(h.money_hidden, true); assert.ok(!('impact_amount' in h) && !('exposure_amount' in h) && !('impact_currency' in h));
  const u = RAID.view(row, { ...n.details, probability_pct: null }, { today: '2026-11-13', money: true });
  assert.equal(u.exposure_amount, null, 'unknown probability → exposure unknown, never 0');
  assert.deepEqual(RAID.exposureTotals([m, u]), [{ currency: 'USD', exposure_amount: null, entries: 2, unknown: 1 }]);
  assert.deepEqual(RAID.exposureTotals([m]), [{ currency: 'USD', exposure_amount: 400, entries: 1, unknown: 0 }]);
});

// ---- KPI cards / phase strip parity -------------------------------------------------------------------------
test('KPI cards reconcile to the engines (recomputed from the source rows)', () => {
  const tasks = fixture(); const s = sched(tasks);
  const project = { id: 1, stage: 'in_progress', baseline_end: '2027-01-08' };
  const risks = [{ id: 1, kind: 'risk', status: 'open', probability: 3, impact: 3, title: 'Severe' }, { id: 2, kind: 'risk', status: 'open', probability: 1, impact: 2, title: 'Low' }, { id: 3, kind: 'issue', status: 'open', probability: 2, impact: 2, title: 'Issue' }, { id: 4, kind: 'risk', status: 'closed', probability: 3, impact: 3, title: 'Old' }];
  const milestones = [{ id: 1, name: 'Kick-off', due_date: '2026-11-03', status: 'done' }, { id: 2, name: 'UAT', due_date: '2026-11-10', status: 'planned' }, { id: 3, name: 'Go live', due_date: '2027-01-15', status: 'planned' }, { id: 4, name: 'Handover', due_date: '2026-12-01', status: 'planned' }];
  const evm = { currencies: [{ currency: 'USD', bac: 1000, pv: 400, ev: 380, ac: 420, spi: 0.95, cpi: 0.9048 }] };
  const rag = RAG.computeRag({ spi: KPI.worstIndex(evm, 'spi'), cpi: KPI.worstIndex(evm, 'cpi'), slip_wd: KPI.slipWorkingDays(project, s), risk_score: KPI.riskScore(risks) }, null);
  const out = KPI.projectSummary({ project, tasks, milestones, risks, schedule: s, evm, rag, gates: null, today: '2026-11-13' });
  // independent recomputation from the rows: work-weighted % over the leaves
  const leaves = tasks; const W = leaves.reduce((a, t) => a + (t.effort_hours || 0), 0);
  assert.equal(leaves.some((t) => t.effort_hours == null), true, 'the milestone has no work → duration weight is used');
  assert.equal(out.cards.schedule_complete_pct, ENGINE.rollupProgress(leaves.map((t) => ({ ...t, _duration: s.tasks.find((r) => r.id === t.id).duration_days }))).progress_pct);
  assert.ok(W > 0);
  assert.equal(out.cards.forecast_finish, s.project_finish);
  const cal = ENGINE.makeCalendar(null); assert.equal(out.cards.slip_working_days, cal.ord(ENGINE.toDay(s.project_finish)) - cal.ord(ENGINE.toDay('2027-01-08')));
  assert.equal(out.cards.active_risks, 2); assert.equal(out.cards.high_risks, 1);
  assert.deepEqual(out.cards.next_milestone, { id: 4, name: 'Handover', due_date: '2026-12-01', baseline_date: null, owner: null });
  assert.equal(out.cards.overdue_milestones, 1);
  assert.deepEqual(out.cards.budget_burn, [{ currency: 'USD', ac: 420, pv: 400, bac: 1000, burn_vs_plan: 1.05 }]);
  assert.equal(out.cards.rag, 'red', 'a 3×3 open risk is red'); assert.equal(rag.components.cost.rag, 'amber', 'CPI 0.905 is amber');
  assert.deepEqual(out.top_risks.map((r) => r.id), [1, 3, 2]);
  assert.deepEqual(out.phase_strip.map((p) => p.state), ['done', 'done', 'current', 'upcoming']);
  assert.equal(out.phase_strip[2].pct_complete, out.cards.schedule_complete_pct); assert.equal(out.phase_strip[2].health, 'red');
  assert.match(out.phase_mapping_status, /PROPOSED/);
  // unknown stays unknown
  const blank = KPI.projectSummary({ project: { stage: 'proposal' }, tasks: [{ id: 1, progress_pct: null }], milestones: [], risks: [], schedule: null, evm: null, rag: null, gates: null, today: '2026-11-13' });
  assert.equal(blank.cards.schedule_complete_pct, null); assert.equal(blank.cards.budget_burn, null); assert.equal(blank.cards.slip_working_days, null); assert.equal(blank.cards.next_milestone, null);
  assert.equal(KPI.riskScore([]), null, 'an empty register is unknown');
});
