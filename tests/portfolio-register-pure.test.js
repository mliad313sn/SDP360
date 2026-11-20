'use strict';
// PORTFOLIO LOT 3 — the pure register / executive-dashboard engine (spec §21, §23.1, §24.5, §30), fictitious data only.
//   - every KPI card reconciles with its drill-through list (value = count of the drilled rows, or for the DQ / budget
//     cards: count = rows of the drill);
//   - unknown stays null ("—"), never 0 / green: intake off, DQ off, money hidden, no FTE, no stage-entry date;
//   - amounts in different currencies are never added together;
//   - a money-hidden reader gets no amount, no budget status and no budget-derived count in any view;
//   - filters / search / sort / reports, monthly active load.
const { test } = require('node:test');
const assert = require('node:assert');
const PR = require('../services/ppm/portfolioRegister');
const UI = require('../public/lib/portfolioRegister');
const UrlFilters = require('../public/lib/urlFilters');

const NOW = new Date('2027-06-15T00:00:00Z');
const sites = [{ id: 1, name: 'Hounde' }, { id: 2, name: 'Mana' }];
const P = (o) => ({ objective_id: 1, owner: 'Site IT', sponsor: 'Plant manager', status: 'planned', stage: 'proposal', start_date: '2027-03-01', end_date: '2027-09-30',
  baseline_start: null, baseline_end: null, budget: null, currency: null, project_type: 'infrastructure', priority: 'medium', budget_status: null, decision_required: 'no',
  delivery_effort: 'medium', risk_exposure: 'low', delivery_lead: 'Network team', avg_fte: null, business_need: { problem: 'p' }, expected_value: 'v', value_states: {}, created_at: '2027-01-10T00:00:00Z', ...o });
const projects = [
  P({ id: 1, key: 'A', project_ref: 'PRJ-2027-001', name: 'WAN failover', site_id: 1, priority: 'critical', budget: 1000, currency: 'USD', budget_status: 'approved', avg_fte: 0.5, risk_exposure: 'high', decision_required: 'yes', baseline_start: '2027-03-01', baseline_end: '2027-09-30', stage: 'in_progress', status: 'active', delivery_effort: 'very_large' }),
  P({ id: 2, key: 'B', project_ref: 'PRJ-2027-002', name: 'ERP upgrade', site_id: 1, priority: 'high', budget: 500, currency: 'EUR', budget_status: 'requested', avg_fte: 1, project_type: 'business_application' }),
  P({ id: 3, key: 'C', project_ref: 'PRJ-2027-003', name: 'Badge readers', site_id: 2, priority: 'low', budget: 200, currency: 'USD', budget_status: 'not_budgeted', status: 'on_hold', stage: 'on_hold', owner: '' }),
  P({ id: 4, key: 'D', project_ref: null, name: 'Cyber audit', site_id: 2, priority: 'medium', start_date: null, end_date: null, budget_status: 'tbc', decision_required: 'tbc', stage: 'approval', status: 'planned', delivery_lead: null }),
  P({ id: 5, key: 'E', project_ref: 'PRJ-2026-010', name: 'Old closure', site_id: 1, priority: 'low', start_date: '2026-01-01', end_date: '2026-06-30', status: 'done', stage: 'closed', budget: 0, currency: 'USD', budget_status: 'approved' }),
];
const risks = [{ project_id: 2, status: 'open', probability: 3, impact: 3 }, { project_id: 2, status: 'closed', probability: 3, impact: 3 }, { project_id: 3, status: 'open', probability: 1, impact: 1 }];
const stageEntries = { 1: '2027-03-01T00:00:00Z', 3: '2027-02-01T00:00:00Z' };
const build = (opts = {}) => PR.build(projects, { sites, risks, stageEntries, now: NOW, money: true, intake: true, dqOn: true, ...opts });

test('rows: whitelisted fields, site names, stage age, baselined, high open risks; unknown stays null', () => {
  const { rows } = build();
  const a = rows.find((r) => r.id === 1), d = rows.find((r) => r.id === 4), b = rows.find((r) => r.id === 2);
  assert.equal(a.ref, 'PRJ-2027-001'); assert.equal(d.ref, 'D', 'no PRJ id yet → the key');
  assert.equal(a.site, 'Hounde'); assert.equal(a.baselined, true); assert.equal(b.baselined, false);
  assert.equal(a.stage_age_days, 106); assert.equal(rows.find((r) => r.id === 2).stage_age_days, 156, 'proposal with no stage event → age from creation');
  assert.equal(d.stage_age_days, null, 'approval with no stage event: entry date unknown, never 0');
  assert.equal(b.high_risks, 1, 'only open high-severity risks'); assert.equal(d.avg_fte, null);
  assert.equal(d.duration_days, null); assert.equal(a.duration_days, 214);
  assert.ok(!('charter' in a) && !('spent' in a), 'only the register columns leave the engine');
});

test('KPI cards reconcile with their drill-through lists (same filter engine)', () => {
  const out = build();
  for (const k of out.kpis) {
    assert.ok(k.drill && typeof k.drill === 'object', k.key);
    const drilled = PR.applyFilters(out.rows, UrlFilters.parse(UrlFilters.serialise(k.drill, UI.SCHEMA), UI.SCHEMA), { money: true });
    assert.equal(k.count, drilled.length, `${k.key}: count = rows of its drill`);
    if (k.unit === 'count') assert.equal(k.value, drilled.length, `${k.key}: value = its drill list`);
  }
  const by = Object.fromEntries(out.kpis.map((k) => [k.key, k]));
  assert.deepStrictEqual(Object.keys(by), ['total_projects', 'data_quality', 'critical_high', 'budget_identified', 'decisions_required']);
  assert.equal(by.total_projects.value, 5); assert.equal(by.critical_high.value, 2); assert.equal(by.decisions_required.value, 1);
  assert.deepStrictEqual(by.budget_identified.value, { USD: 1200, EUR: 500 }, 'per currency; the 0 budget is not "identified"');
  assert.equal(by.budget_identified.count, 3);
  assert.ok(Number.isInteger(by.data_quality.value) && by.data_quality.value >= 0 && by.data_quality.value <= 100);
});

test('unknown → null with a reason, never 0: DQ off, intake off, money hidden', () => {
  const k = (o) => Object.fromEntries(build(o).kpis.map((x) => [x.key, x]));
  const dqOff = k({ dqOn: false });
  assert.equal(dqOff.data_quality.value, null); assert.equal(dqOff.data_quality.reason, 'DQ_DISABLED');
  const noIntake = PR.build(projects.map((p) => { const { project_type, priority, decision_required, risk_exposure, delivery_effort, delivery_lead, avg_fte, budget_status, ...rest } = p; return rest; }), { sites, risks, now: NOW, money: true, intake: false, dqOn: false }); // eslint-disable-line no-unused-vars
  const ni = Object.fromEntries(noIntake.kpis.map((x) => [x.key, x]));
  assert.equal(ni.critical_high.value, null); assert.equal(ni.critical_high.reason, 'INTAKE_DISABLED');
  assert.equal(ni.decisions_required.value, null);
  assert.equal(noIntake.load.months[6].fte, null, 'no FTE source → null, never 0');
  const hidden = k({ money: false });
  assert.equal(hidden.budget_identified.value, null); assert.equal(hidden.budget_identified.reason, 'MONEY_HIDDEN');
});

test('money-hidden reader: no amount, currency, budget status or budget-derived count anywhere', () => {
  const out = build({ money: false });
  const s = JSON.stringify(out);
  assert.ok(!('budget' in out.analyses));
  for (const k of ['"budget"', '"budget_status"', '"currency"', '"budget_by_currency"', 'not_budgeted', 'requested', '1200']) assert.ok(!s.includes(k), 'leak: ' + k);
  assert.equal(out.analyses.budget_reason, 'MONEY_HIDDEN');
  assert.ok(out.analyses.by_priority.every((p) => p.unfunded === null && !('budget' in p)));
  assert.equal(out.reports.find((r) => r.key === 'unfunded').count, null);
  // a budget filter or the unfunded report is ignored, never leaks through counts
  const f = UrlFilters.parse('?budget_status=approved&report=unfunded&budget=identified', UI.SCHEMA);
  assert.equal(PR.applyFilters(out.rows, f, { money: false }).length, 5);
});

test('currencies are never summed together; a single-currency group gets one total', () => {
  const b = build().analyses.budget;
  assert.deepStrictEqual(Object.keys(b.by_currency).sort(), ['EUR', 'USD']);
  assert.equal(b.by_currency.USD.total, 1200); assert.equal(b.by_currency.USD.approved, 1000); assert.equal(b.by_currency.EUR.requested, 500);
  assert.equal(b.not_budgeted, 1); assert.equal(b.tbc, 1);
  const site1 = build().analyses.by_site.find((s) => s.site_id === 1);
  assert.deepStrictEqual(site1.budget, { USD: 1000, EUR: 500 });
  assert.ok(!('total' in b), 'no cross-currency grand total');
});

test('analyses: priority (pct, FTE, sites, unfunded), status (stage age, approved not started, in progress without lead, on hold), risk, site DQ', () => {
  const { analyses: a } = build();
  const crit = a.by_priority.find((p) => p.priority === 'critical'), low = a.by_priority.find((p) => p.priority === 'low');
  assert.equal(crit.count, 1); assert.equal(crit.pct, 20); assert.equal(crit.fte, 0.5); assert.equal(crit.sites, 1); assert.equal(crit.unfunded, 0);
  assert.equal(low.unfunded, 1, 'not_budgeted counts as unfunded (PROPOSED)');
  assert.equal(a.status.on_hold, 1); assert.equal(a.status.approved_not_started, 1);
  assert.equal(a.status.in_progress_without_lead, 0);
  assert.equal(a.status.avg_stage_age_days, Math.round((106 + 156 + 134) / 3), 'mean over known ages of open projects only');
  assert.equal(a.status.stage_age_known, 3);
  assert.ok(a.status.stalled >= 1);
  assert.equal(a.risk.by_site.find((s) => s.key === '1').high_risk, 2, 'declared exposure OR an open high risk');
  const s1 = a.by_site.find((s) => s.site_id === 1);
  assert.equal(s1.count, 3); assert.ok(s1.dq === null || Number.isInteger(s1.dq));
  assert.equal(s1.fte, 1.5); assert.equal(s1.fte_unknown, 1);
});

test('filters, search, standard reports, sort (nulls last), year', () => {
  const { rows } = build();
  const f = (q) => PR.applyFilters(rows, UrlFilters.parse(q, UI.SCHEMA), { money: true }).map((r) => r.id).sort((a, b) => a - b);
  assert.deepStrictEqual(f('?site=2'), [3, 4]);
  assert.deepStrictEqual(f('?priority=critical,high&site=1'), [1, 2]);
  assert.deepStrictEqual(f('?q=erp'), [2]); assert.deepStrictEqual(f('?q=hounde,wan'), [1], 'every token must match');
  assert.deepStrictEqual(f('?report=on_hold'), [3]);
  assert.deepStrictEqual(f('?report=without_owners'), [3]);
  assert.deepStrictEqual(f('?report=unfunded'), [2, 3, 4]);
  assert.deepStrictEqual(f('?report=high_risk'), [1, 2]);
  assert.deepStrictEqual(f('?report=not_baselined'), [2, 3, 4], 'closed projects are not flagged');
  assert.deepStrictEqual(f('?year=2026'), [5]); assert.deepStrictEqual(f('?year=2027'), [1, 2, 3]);
  assert.deepStrictEqual(f('?status=on_hold&budget_status=not_budgeted'), [3]);
  const sorted = PR.sortRows(rows, 'avg_fte', 'desc').map((r) => r.id);
  assert.deepStrictEqual(sorted.slice(0, 2), [2, 1]); assert.ok([3, 4, 5].includes(sorted[4]), 'unknown FTE last');
  assert.deepStrictEqual(PR.sortRows(rows, 'avg_fte', 'asc').slice(-3).map((r) => r.avg_fte), [null, null, null]);
  assert.deepStrictEqual(PR.sortRows(rows, 'nope', 'asc').map((r) => r.id), PR.sortRows(rows, 'ref', 'asc').map((r) => r.id), 'unknown sort key → ref');
});

test('monthly active load: active projects, FTE, critical, high-risk, very large per month', () => {
  const { load } = build({ year: 2027 });
  assert.equal(load.year, 2027); assert.equal(load.months.length, 12);
  const jun = load.months[5];
  assert.equal(jun.active, 3); assert.equal(jun.fte, 1.5); assert.equal(jun.fte_unknown, 1); assert.equal(jun.critical, 1); assert.equal(jun.high_risk, 2); assert.equal(jun.very_large, 1);
  assert.equal(load.months[0].active, 0); assert.equal(load.undated, 1);
  assert.equal(load.months[0].fte, null, 'no active project with a known FTE → null');
});

test('UI schema / columns: money columns flagged, frozen identity columns, default sort', () => {
  assert.deepStrictEqual(UI.COLUMNS.filter((c) => c.frozen).map((c) => c.key), ['ref', 'site', 'name']);
  assert.ok(UI.COLUMNS.filter((c) => c.money).map((c) => c.key).includes('budget'));
  assert.equal(UI.SCHEMA.sort.def, 'ref');
  assert.equal(UrlFilters.serialise(UrlFilters.parse('', UI.SCHEMA), UI.SCHEMA), '', 'no filter → clean URL');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const html = UI.tableHtml([{ id: 1, ref: '<x>', site: 'S', name: 'N', avg_fte: null }], { cols: ['ref', 'site', 'name', 'avg_fte'], esc, T: UI.T.en, sort: 'ref', dir: 'asc' });
  assert.ok(html.includes('&lt;x&gt;') && !html.includes('<x>'), 'escaped');
  assert.ok(html.includes('—'), 'unknown shows —');
  assert.ok(/aria-sort="ascending"/.test(html));
  const k = UI.kpiHtml([{ key: 'budget_identified', value: null, reason: 'MONEY_HIDDEN', count: 0, unit: 'money', drill: { budget: 'identified' } }], { esc, T: UI.T.en, search: '' });
  assert.ok(k.includes('—') && !/>0</.test(k));
});
