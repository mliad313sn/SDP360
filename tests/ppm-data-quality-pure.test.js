'use strict';
// PORTFOLIO LOT 2 — the pure data-quality engine (spec §20, §4.3): each of the 19 checks, blank ≠ zero ≠ TBC,
// blocking override to Red, unknown → null (never 0 / green), site score = Σ completed ÷ Σ required, the PROPOSED policy.
const { test } = require('node:test');
const assert = require('node:assert');
const DQ = require('../services/ppm/dataQuality');
const FG = require('../services/ppm/fieldGuide');
const KpiRag = require('../public/lib/kpiRag');

const full = () => ({
  id: 1, site_id: 3, name: 'WAN redundancy', business_need: { problem: 'Single WAN link' }, expected_value: 'Fewer than 2 h outage', sponsor: 'Plant manager', owner: 'Site IT',
  priority: 'high', start_date: '2027-03-01', end_date: '2027-09-30', budget: 180000, budget_status: 'requested', depends_on: [7], decision_required: 'no', status: 'planned',
  delivery_effort: 'large', avg_fte: 0.5, peak_fte: 1.2, risk_exposure: 'high', delivery_lead: 'Network team', value_states: {},
});
const risks = [{ project_id: 1, kind: 'risk', title: 'Vendor lead time' }];
const state = (dq, key) => dq.checks.find((c) => c.key === key);

test('a complete project scores 100 and GREEN under the PROPOSED policy', () => {
  const dq = DQ.evaluate(full(), { risks });
  assert.equal(dq.required, 18); assert.equal(dq.completed, 18); assert.equal(dq.score, 100); assert.equal(dq.rag, 'GREEN');
  assert.deepStrictEqual(dq.blocking, []); assert.equal(dq.checks.length, 19);
  assert.ok(dq.checklist.every((i) => i.done === true));
  assert.equal(KpiRag.POLICIES['ppm-data-quality'].status, 'PROPOSED');
  assert.equal(DQ.policy().status, 'PROPOSED');
});

test('each of the 18 field checks fails on a blank value', () => {
  const blankOf = {
    name_missing: { name: '' }, business_need_missing: { business_need: null }, business_value_missing: { expected_value: '  ' }, sponsor_missing: { sponsor: null },
    it_owner_missing: { owner: '' }, priority_missing: { priority: null }, start_date_missing: { start_date: null }, end_date_missing: { end_date: null },
    budget_missing_or_zero: { budget: null }, budget_status_missing: { budget_status: null }, dependencies_missing: { depends_on: [] }, decision_required_missing: { decision_required: null },
    status_missing: { status: null }, delivery_effort_missing: { delivery_effort: null }, resource_demand_missing_or_zero: { avg_fte: null, peak_fte: null },
    risk_exposure_missing: { risk_exposure: null }, delivery_lead_missing: { delivery_lead: '' },
  };
  for (const [key, patch] of Object.entries(blankOf)) {
    const dq = DQ.evaluate({ ...full(), ...patch }, { risks });
    const c = state(dq, key);
    assert.equal(c.complete, false, key); assert.equal(c.state, 'blank', key);
    assert.equal(dq.completed, 17, key); assert.equal(dq.score, Math.floor(1700 / 18), key);
  }
  const noRisk = DQ.evaluate(full(), { risks: [] });
  assert.equal(state(noRisk, 'key_risks_missing').complete, false);
  // an issue is not a risk
  assert.equal(state(DQ.evaluate(full(), { risks: [{ project_id: 1, kind: 'issue' }] }), 'key_risks_missing').complete, false);
});

test('invalid dates: start after end, a non-date, a quarter in a date field → blocking; both blank → not applicable', () => {
  for (const patch of [{ start_date: '2027-10-01', end_date: '2027-09-30' }, { start_date: 'Q1' }, { end_date: '2027-02-30' }]) {
    const dq = DQ.evaluate({ ...full(), ...patch }, { risks });
    assert.equal(state(dq, 'dates_invalid').state, 'invalid', JSON.stringify(patch));
    assert.ok(dq.blocking.includes('dates_invalid')); assert.equal(dq.rag, 'RED');
  }
  const none = DQ.evaluate({ ...full(), start_date: null, end_date: null }, { risks });
  assert.equal(state(none, 'dates_invalid').state, 'not_applicable'); assert.ok(!none.blocking.includes('dates_invalid'));
  assert.equal(none.checklist.find((i) => i.key === 'planned_dates').done, false);
});

test('blocking override: 17/18 (94) with a missing IT owner reads RED, not AMBER', () => {
  const dq = DQ.evaluate({ ...full(), owner: null }, { risks });
  assert.equal(dq.score, 94); assert.deepStrictEqual(dq.blocking, ['it_owner_missing']); assert.equal(dq.rag, 'RED');
  // a missing delivery lead (not blocking) at the same score is AMBER
  assert.equal(DQ.evaluate({ ...full(), delivery_lead: null }, { risks }).rag, 'AMBER');
  // 'not applicable' never satisfies the accountable owner
  assert.equal(state(DQ.evaluate({ ...full(), owner: null, value_states: { owner: 'na' } }, { risks }), 'it_owner_missing').complete, false);
  assert.equal(DQ.ragOf(70, false), 'RED'); assert.equal(DQ.ragOf(80, false), 'AMBER'); assert.equal(DQ.ragOf(99, false), 'AMBER');
});

test('blank ≠ zero ≠ TBC: budget and resource demand', () => {
  const zero = DQ.evaluate({ ...full(), budget: 0 }, { risks });
  assert.equal(state(zero, 'budget_missing_or_zero').state, 'zero'); assert.equal(state(zero, 'budget_missing_or_zero').complete, false);
  const zeroNotBudgeted = DQ.evaluate({ ...full(), budget: 0, budget_status: 'not_budgeted' }, { risks });
  assert.equal(state(zeroNotBudgeted, 'budget_missing_or_zero').complete, true, 'a declared not-budgeted zero is an answer');
  const tbc = DQ.evaluate({ ...full(), budget: null, value_states: { budget: 'tbc' } }, { risks });
  assert.equal(state(tbc, 'budget_missing_or_zero').state, 'tbc'); assert.equal(state(tbc, 'budget_missing_or_zero').complete, false);
  const blank = DQ.evaluate({ ...full(), budget: null }, { risks });
  assert.equal(state(blank, 'budget_missing_or_zero').state, 'blank');
  const fteZero = DQ.evaluate({ ...full(), avg_fte: 0, peak_fte: 0 }, { risks });
  assert.equal(state(fteZero, 'resource_demand_missing_or_zero').state, 'zero');
  const fteNa = DQ.evaluate({ ...full(), avg_fte: null, peak_fte: null, value_states: { avg_fte: 'na' } }, { risks });
  assert.equal(state(fteNa, 'resource_demand_missing_or_zero').complete, true);
  // list TBC codes are TBC, distinct from blank
  const st = DQ.evaluate({ ...full(), budget_status: 'tbc', decision_required: 'tbc' }, { risks });
  assert.equal(state(st, 'budget_status_missing').state, 'tbc'); assert.equal(state(st, 'decision_required_missing').state, 'tbc');
  // na / none_known answer the question
  const ans = DQ.evaluate({ ...full(), priority: null, depends_on: [], value_states: { priority: 'na', dependencies: 'none_known', risks: 'none_known' } }, { risks: [] });
  for (const k of ['priority_missing', 'dependencies_missing', 'key_risks_missing']) assert.equal(state(ans, k).complete, true, k);
});

test('unknown is null, never 0 nor green: intake columns absent (switch off) → score null, rag NA', () => {
  const p = full(); for (const k of ['business_need', 'expected_value', 'priority', 'budget_status', 'decision_required', 'delivery_effort', 'avg_fte', 'peak_fte', 'risk_exposure', 'delivery_lead']) delete p[k];
  const dq = DQ.evaluate(p, { risks });
  assert.equal(dq.score, null); assert.equal(dq.completed, null); assert.equal(dq.rag, 'NA'); assert.equal(dq.unknown_reason, 'FIELDS_UNAVAILABLE');
  assert.equal(state(dq, 'priority_missing').complete, null);
  assert.equal(DQ.evaluate(full(), {}).score, null, 'risks not given = unknown');
  // a blocking error is still detected on the base columns
  assert.equal(DQ.evaluate({ ...p, owner: '' }, { risks }).rag, 'RED');
});

test('money hidden: the budget checks are left out (scope without_budget), checklist items hidden', () => {
  const dq = DQ.evaluate({ ...full(), budget: 0 }, { risks, money: false });
  assert.equal(dq.scope, 'without_budget'); assert.equal(dq.required, 16); assert.equal(dq.score, 100);
  assert.ok(!dq.checks.some((c) => c.field === 'budget' || c.field === 'budget_status'));
  assert.equal(dq.checklist.find((i) => i.key === 'budget_estimate').done, null);
});

test('site score = Σ completed ÷ Σ required (never the mean of the percentages); unscored projects counted apart', () => {
  // project A 18/18 (100), project B 9/18 (50), project C 16/16 (money-hidden would never be mixed: same reader here)
  const a = DQ.evaluate(full(), { risks });
  const halfBlank = { ...full(), id: 2, name: '', business_need: null, expected_value: null, sponsor: null, priority: null, delivery_effort: null, risk_exposure: null, delivery_lead: null, decision_required: null };
  const b = DQ.evaluate(halfBlank, { risks: [{ project_id: 2, kind: 'risk' }] });
  assert.equal(b.completed, 9);
  const unknown = { id: 3, site_id: 3, name: 'x' };
  const sites = DQ.siteScores([{ site_id: 3, dq: a }, { site_id: 3, dq: b }, { site_id: 3, dq: DQ.evaluate(unknown, { risks: [] }) }, { site_id: 9, dq: DQ.evaluate(unknown, {}) }]);
  const s3 = sites.find((s) => s.site_id === 3);
  assert.equal(s3.completed, 27); assert.equal(s3.required, 36); assert.equal(s3.score, 75); assert.equal(s3.rag, 'RED');
  assert.equal(s3.unknown_projects, 1); assert.equal(s3.scored_projects, 2);
  // weighting check: unequal denominators — 1/2 + 18/18 → (1+18)/(2+18) = 95, the mean of % would be 75
  const w = DQ.siteScores([{ site_id: 1, dq: { score: 50, completed: 1, required: 2, blocking: [] } }, { site_id: 1, dq: { score: 100, completed: 18, required: 18, blocking: [] } }]);
  assert.equal(w[0].score, 95);
  const s9 = sites.find((s) => s.site_id === 9);
  assert.equal(s9.score, null); assert.equal(s9.completed, null); assert.equal(s9.rag, 'NA');
});

test('portfolio block and gate refusal', () => {
  const blk = DQ.portfolioBlock([full(), { ...full(), id: 2, site_id: null, owner: null }], risks.concat([{ project_id: 2, kind: 'risk' }]));
  assert.equal(blk.proposed, true); assert.equal(blk.projects[1].score, 100); assert.equal(blk.projects[2].rag, 'RED');
  assert.deepStrictEqual(blk.projects[2].missing, ['it_owner_missing']);
  assert.ok(blk.sites.some((s) => s.site_id === null));
  assert.equal(DQ.gateRefusal(full(), { risks }), null);
  const r = DQ.gateRefusal({ ...full(), start_date: '2028-01-01' }, { risks });
  assert.equal(r.code, 'GATE_DATA_QUALITY'); assert.deepStrictEqual(r.blocking, ['dates_invalid']);
});

test('field guide extends Lot 1 (no copied entry) and covers every check and checklist item', () => {
  const IF = require('../services/ppm/intakeFields');
  const cat = FG.catalogue();
  for (const f of IF.GUIDE) assert.ok(cat.find((c) => c.key === f.key && c.en === f.en), `Lot 1 entry reused: ${f.key}`);
  for (const e of FG.EXTRA) assert.ok(!IF.GUIDE.some((f) => f.key === e.key), `no duplicate: ${e.key}`);
  const covered = new Set(cat.flatMap((f) => f.dq_checks));
  for (const c of DQ.CHECKS) assert.ok(covered.has(c.key), c.key);
  for (const it of DQ.CHECKLIST) assert.ok(cat.find((f) => f.key === it.field), it.key);
  for (const f of cat) for (const l of ['en', 'fr']) for (const k of ['label', 'description', 'why', 'example', 'mistake']) assert.ok(f[l][k], `${f.key}.${l}.${k}`);
  assert.equal(DQ.CHECKLIST.length, 16);
});
