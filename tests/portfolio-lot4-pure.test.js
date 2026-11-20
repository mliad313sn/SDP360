'use strict';
// PORTFOLIO LOT 4 — pure rules: the decision agenda (spec §14) and the six management alert kinds (spec §22).
// No database. Fictitious data only. Every rule asserted here is PROPOSED (a PMO decision), not approved policy.
const { test } = require('node:test');
const assert = require('node:assert');
const PX = require('../services/ppmAlerts');
const DA = require('../services/ppm/decisionAgenda');
const PR = require('../services/ppm/portfolioRegister');

const TODAY = '2026-11-20';
const base = (id, o) => ({ id, key: 'P' + id, project_ref: 'PRJ-2026-00' + id, name: 'Project ' + id, owner: 'IT owner', site_id: 1, stage: 'in_progress', status: 'active',
  start_date: '2026-01-01', end_date: '2026-12-31', risk_exposure: 'low', budget_status: 'approved', decision_required: 'no', delivery_lead: 'Team A', value_states: null, ...o });

test('the six spec kinds are added to the alert vocabulary, after the A11 kinds', () => {
  assert.deepStrictEqual(PX.MANAGEMENT_KINDS, ['critical_risk', 'high_risk', 'unfunded', 'decision_bottleneck', 'missing_delivery_lead', 'schedule_error']);
  for (const k of PX.MANAGEMENT_KINDS) assert.ok(PX.ALL_KINDS.includes(k));
  assert.ok(PX.ALL_KINDS.indexOf('stale_plan') < PX.ALL_KINDS.indexOf('critical_risk'));
  for (const k of PX.MANAGEMENT_KINDS) { assert.ok(PX.SEVERITY[k]); assert.ok(PX.RECOMMENDED_ACTION[k] && PX.RECOMMENDED_ACTION[k].en && PX.RECOMMENDED_ACTION[k].fr); }
});

test('critical_risk / high_risk: declared exposure, or an open high-severity register risk; one kind per project', () => {
  const v = { projects: [base(1, { risk_exposure: 'critical' }), base(2, { risk_exposure: 'high' }), base(3, { risk_exposure: 'low' }), base(4, { risk_exposure: null }), base(5, { risk_exposure: 'critical', status: 'done' })],
    risks: [{ project_id: 3, status: 'open', probability: 3, impact: 3 }, { project_id: 4, status: 'closed', probability: 3, impact: 3 }, { project_id: 1, status: 'open', probability: 3, impact: 3 }] };
  const a = PX.findManagementAlerts(v, { today: TODAY, money: true });
  const kinds = (k) => a.filter((x) => x.kind === k).map((x) => x.project_id).sort();
  assert.deepStrictEqual(kinds('critical_risk'), [1]);
  assert.deepStrictEqual(kinds('high_risk'), [2, 3], 'declared high + open register risk of severity high; a closed risk raises nothing; a done project nothing');
  const c = a.find((x) => x.kind === 'critical_risk');
  assert.equal(c.severity, 'critical'); assert.equal(c.project_key, 'PRJ-2026-001'); assert.ok(c.recommended_action.en);
});

test('unfunded reuses the register rule (Lot 3) and is only computed for an amount reader', () => {
  const v = { projects: PR.UNFUNDED.map((s, i) => base(10 + i, { budget_status: s })).concat([base(20, { budget_status: 'approved' }), base(21, { budget_status: null })]) };
  const a = PX.findManagementAlerts(v, { today: TODAY, money: true }).filter((x) => x.kind === 'unfunded');
  assert.equal(a.length, PR.UNFUNDED.length, 'unknown budget status is NOT unfunded');
  assert.equal(PX.findManagementAlerts(v, { today: TODAY, money: false }).filter((x) => x.kind === 'unfunded').length, 0);
  const cov = PX.managementCoverage(v, { money: false });
  assert.equal(cov.unfunded, 'MONEY_HIDDEN');
});

test('decision_bottleneck: required with no decision recorded, an open decision past due, an old undated one (only with the age set)', () => {
  const v = { projects: [base(1, { decision_required: 'yes' }), base(2, { decision_required: 'yes' }), base(3, { decision_required: 'tbc' }), base(4, { decision_required: 'yes' }), base(5, { decision_required: 'yes' })] };
  const decisions = [
    { id: 71, ref: 'DEC-2026-071', project_id: 2, status: 'open', due_date: '2026-11-01', created_at: '2026-10-01T00:00:00Z' },
    { id: 72, ref: 'DEC-2026-072', project_id: 4, status: 'open', due_date: null, created_at: '2026-09-01T00:00:00Z' },
    { id: 73, ref: 'DEC-2026-073', project_id: 5, status: 'done', due_date: '2026-11-01', created_at: '2026-09-01T00:00:00Z' },
  ];
  const keys = (o) => PX.findManagementAlerts(v, { today: TODAY, money: true, decisions, ...o }).filter((x) => x.kind === 'decision_bottleneck').map((x) => x.key).sort();
  assert.deepStrictEqual(keys({}), ['decision_bottleneck:decision:71:2026-11-01', 'decision_bottleneck:project:1:not_recorded'],
    'a null due date is never overdue; a done decision is no bottleneck; tbc is a data-quality matter, not a bottleneck');
  assert.deepStrictEqual(keys({ decisionAgeDays: 30 }), ['decision_bottleneck:decision:71:2026-11-01', 'decision_bottleneck:decision:72:age', 'decision_bottleneck:project:1:not_recorded']);
  assert.equal(PX.findManagementAlerts(v, { today: TODAY, money: true }).filter((x) => x.kind === 'decision_bottleneck').length, 0, 'decisions unknown (not passed) → nothing guessed');
});

test('missing_delivery_lead (reuses the data-quality check) and schedule_error (the DQ dates_invalid rule); null dates never fire', () => {
  const v = { projects: [
    base(1, { delivery_lead: null }), base(2, { delivery_lead: null, value_states: JSON.stringify({ delivery_lead: 'na' }) }), base(3, { delivery_lead: null, stage: 'proposal', status: 'planned' }),
    base(4, { start_date: '2026-12-01', end_date: '2026-11-01' }), base(5, { start_date: null, end_date: null }), base(6, { start_date: '2026-02-30', end_date: '2026-12-01' }),
  ] };
  const a = PX.findManagementAlerts(v, { today: TODAY, money: true });
  assert.deepStrictEqual(a.filter((x) => x.kind === 'missing_delivery_lead').map((x) => x.project_id), [1], "'na' answers it; a proposal does not need a lead yet");
  assert.deepStrictEqual(a.filter((x) => x.kind === 'schedule_error').map((x) => x.project_id).sort(), [4, 6]);
});

test('intake switch off: the intake-based kinds are UNKNOWN (never "no alert" reported as fine)', () => {
  const p = { id: 1, key: 'P1', name: 'x', stage: 'in_progress', status: 'active', start_date: '2026-12-01', end_date: '2026-01-01' };
  const a = PX.findManagementAlerts({ projects: [p] }, { today: TODAY, money: true });
  assert.deepStrictEqual(a.map((x) => x.kind), ['schedule_error']);
  const cov = PX.managementCoverage({ projects: [p] }, { money: true });
  for (const k of ['critical_risk', 'high_risk', 'unfunded', 'decision_bottleneck', 'missing_delivery_lead']) assert.equal(cov[k], 'INTAKE_DISABLED', k);
  assert.equal(cov.schedule_error, null);
});

test('findExceptions: today\'s A11 list is unchanged unless the management option is passed', () => {
  const v = { projects: [base(1, { risk_exposure: 'critical' })], tasks: [], milestones: [] };
  assert.equal(PX.findExceptions(v, { today: TODAY }).length, 0);
  assert.deepStrictEqual(PX.findExceptions(v, { today: TODAY, management: { money: true } }).map((x) => x.kind), ['critical_risk']);
});

test('decision agenda: projects with decision required yes / tbc and their linked decisions; overdue and not recorded first', () => {
  const projects = [base(1, { decision_required: 'yes' }), base(2, { decision_required: 'tbc' }), base(3, { decision_required: 'no' }), base(4, { decision_required: 'yes' }), base(5, { decision_required: 'yes', status: 'cancelled' })];
  const decisions = [
    { id: 9, ref: 'DEC-2026-009', title: 'Go / no go', project_id: 4, status: 'open', due_date: '2026-12-15', authority: 'IT committee', owner: 'CIO' },
    { id: 8, ref: 'DEC-2026-008', title: 'Vendor', project_id: 2, status: 'open', due_date: '2026-11-01' },
    { id: 7, ref: 'DEC-2026-007', title: 'Old', project_id: 4, status: 'done', due_date: '2026-10-01', outcome: 'approved', decided_at: '2026-10-02' },
    { id: 6, ref: 'DEC-2026-006', title: 'Other project', project_id: 99, status: 'open' },
  ];
  const g = DA.buildAgenda(projects, decisions, { today: TODAY, intake: true, siteName: new Map([[1, 'Site One']]) });
  assert.deepStrictEqual(g.rows.map((r) => r.project_id), [1, 2, 4], 'not recorded, then overdue, then the rest');
  const r1 = g.rows[0]; assert.equal(r1.not_recorded, true); assert.equal(r1.decisions.length, 0); assert.equal(r1.site, 'Site One');
  const r2 = g.rows[1]; assert.equal(r2.overdue, 1); assert.equal(r2.decisions[0].overdue, true);
  const r4 = g.rows[2]; assert.equal(r4.open, 1); assert.equal(r4.decisions.find((d) => d.id === 7).overdue, null, 'a closed decision is not overdue');
  assert.equal(r4.next_due, '2026-12-15');
  assert.deepStrictEqual(g.summary, { projects: 3, required_yes: 2, required_tbc: 1, open_decisions: 2, overdue_decisions: 1, not_recorded: 1 });
});

test('decision agenda with the intake switch off: unknown, never an empty "all clear"', () => {
  const g = DA.buildAgenda([base(1, { decision_required: 'yes' })], [], { today: TODAY, intake: false });
  assert.deepStrictEqual(g.rows, []); assert.equal(g.summary, null); assert.equal(g.unknown_reason, 'INTAKE_DISABLED');
});

test('decision record input: authority / outcome / decided_at shapes', () => {
  assert.deepStrictEqual(DA.normaliseRecord({ authority: ' IT committee ', outcome: 'approved', decided_at: '2026-11-19' }), { authority: 'IT committee', outcome: 'approved', decided_at: '2026-11-19' });
  assert.throws(() => DA.normaliseRecord({ outcome: 'maybe' }), /outcome/);
  assert.throws(() => DA.normaliseRecord({ decided_at: '19/11/2026' }), /decided_at/);
  assert.throws(() => DA.normaliseRecord({ outcome: 'approved' }), /decided_at/, 'an outcome needs the decision date');
  assert.deepStrictEqual(DA.normaliseRecord({ authority: '' }), { authority: null });
});

test('promotion: commitment fields from an alert (kind / severity mapping, owner required)', () => {
  const al = { key: 'critical_risk:project:1', kind: 'critical_risk', project_id: 1, project_key: 'PRJ-2026-001', site_id: 1, message: 'm', severity: 'critical', recommended_action: { en: 'Review mitigation', fr: 'x' } };
  const f = PX.commitmentFromAlert(al, { owner: 'Ana', due_date: '2026-12-01' });
  assert.deepStrictEqual([f.kind, f.severity, f.accountable_owner, f.due_date, f.site_id, f.source.system, f.source.id], ['operational_risk', 'critical', 'Ana', '2026-12-01', 1, 'ppm_alert', 'critical_risk:project:1']);
  assert.ok(f.treatment_plan.includes('Review mitigation'));
  assert.throws(() => PX.commitmentFromAlert(al, {}), /owner/);
  assert.throws(() => PX.commitmentFromAlert(al, { owner: 'Ana', due_date: 'soon' }), /due_date/);
});
