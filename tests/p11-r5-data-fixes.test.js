'use strict';
// P11 round 5 (seat data-kpi) — F-21 .. F-25 regression tests. Pure engines, fictitious data only.
//   F-21  a Lot 3 KPI card / standard-report count == the list its link opens, whatever filters are active
//   F-23  ONE "high risk" rule (services/ppm/riskExposure.js: residual first, unknown score → null, never low)
//         used by the Lot 3 register, the Lot 4 alerts and Lot 6
//   F-22  partial data is never a verdict (demand cell, risk rollup, group Home worst sites, DQ card scope)
//   F-24  the site-view tooltip states the real rule; the Vue Groupe helpdesk cell follows the closed-only doctrine
//   F-25  destructive-DDL detector catches quoted dynamic SQL, DROP DOMAIN, DROP OWNED
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const PR = require('../services/ppm/portfolioRegister');
const PE = require('../services/portfolioEvidence');
const RE = require('../services/ppm/riskExposure');
const AL = require('../services/ppmAlerts');
const RD = require('../services/ppm/resourceDemand');
const HG = require('../public/lib/homeGroup');
const SS = require('../services/siteHelpdeskSla');
const UI = require('../public/lib/portfolioRegister');
const { destructiveDdl, rerunOnChange, listMigrations } = require('../db/migrate');

// ---- F-21 ---------------------------------------------------------------------------------------------------------
const mk = (id, priority, status, decision, extra) => ({ id, key: 'P' + id, name: 'p' + id, site_id: 1, priority, status, decision_required: decision,
  start_date: '2026-01-01', end_date: '2026-06-30', owner: 'o', sponsor: 's', stage: status === 'on_hold' ? 'on_hold' : 'in_progress', created_at: '2026-01-01', ...extra });
const projects = [mk(1, 'low', 'active', 'no'), mk(2, 'low', 'on_hold', 'yes'), mk(3, 'high', 'active', 'yes', { owner: '' }), mk(4, 'critical', 'active', 'no'), mk(5, 'high', 'on_hold', 'no')];
const opts = (filters, money = false) => ({ sites: [{ id: 1, name: 'S' }], risks: [], now: new Date('2026-11-20'), money, intake: true, dqOn: false, filters });
const linkRows = (filters, patch) => PR.build(projects, opts(Object.assign({}, filters, patch))).rows.length;   // = portfolioRegisterPage merge()

test('F-21: priority=low active — the Critical/high card count equals the list its link opens (reviewer repro)', () => {
  const cur = { priority: ['low'] };
  const card = PR.build(projects, opts(cur)).kpis.find((k) => k.key === 'critical_high');
  assert.equal(card.count, 0);
  if (card.drill) assert.equal(linkRows(cur, card.drill), card.count, 'the link must not replace the active priority filter');
});

test('F-21: report=on_hold active — the "without owners" report link count equals its list (reviewer repro)', () => {
  const cur = { report: 'on_hold' };
  const rep = PR.build(projects, opts(cur)).reports.find((r) => r.key === 'without_owners');
  assert.ok(rep.drill, 'each report carries the exact filter its link opens');
  assert.equal(linkRows(cur, rep.drill), rep.count);
});

test('F-21: for every card and report under every active filter, count == rows of the link', () => {
  const states = [{}, { priority: ['low'] }, { priority: ['high', 'medium'] }, { report: 'on_hold' }, { report: 'without_owners' }, { decision_required: ['yes'] },
    { decision_required: ['no'], priority: ['critical', 'low'] }, { status: ['on_hold'], report: 'high_risk' }];
  for (const s of states) {
    const b = PR.build(projects, opts(s));
    for (const k of b.kpis) {
      if (k.count == null) continue;
      if (k.drill == null) { assert.equal(k.count, 0, `${k.key} without a link must be 0 under ${JSON.stringify(s)}`); continue; }
      assert.equal(linkRows(s, k.drill), k.count, `card ${k.key} under ${JSON.stringify(s)}`);
      if (k.unit === 'count') assert.equal(k.value, k.count);
    }
    for (const r of b.reports) {
      if (r.count == null) continue;
      assert.equal(linkRows(s, r.drill), r.count, `report ${r.key} under ${JSON.stringify(s)}`);
    }
  }
});

// ---- F-23 ---------------------------------------------------------------------------------------------------------
const risk = (o) => ({ id: 1, project_id: 1, kind: 'risk', status: 'open', title: 'r', ...o });
const proj = (id) => ({ id, key: 'P' + id, name: 'p' + id, site_id: 1, status: 'active', stage: 'in_progress', start_date: '2026-01-01', end_date: '2026-12-31', risk_exposure: 'low', owner: 'o' });
function verdicts(r) {
  const rs = [r];
  const reg = PR.build([proj(1)], { sites: [{ id: 1, name: 'S' }], risks: rs, now: new Date('2026-11-20'), money: false, intake: true, dqOn: false, filters: { report: 'high_risk' } });
  const alerts = AL.findManagementAlerts({ projects: [proj(1)], risks: rs }, { today: '2026-11-20' }).filter((a) => a.kind === 'high_risk');
  return { register: reg.rows.length === 1, alerts: alerts.length === 1, lot6: ['high', 'critical'].includes(RE.rollup(rs).level), view: PE.riskView(r).severity };
}

test('F-23: inherent 3×3 mitigated to residual 1×1 gives the SAME (not high) verdict everywhere', () => {
  const v = verdicts(risk({ probability: 3, impact: 3, residual_probability: 1, residual_impact: 1 }));
  assert.deepEqual({ register: v.register, alerts: v.alerts, lot6: v.lot6 }, { register: false, alerts: false, lot6: false });
  assert.equal(v.view, 'low');
});

test('F-23: inherent 1×1 with residual 3×3 is high everywhere', () => {
  const v = verdicts(risk({ probability: 1, impact: 1, residual_probability: 3, residual_impact: 3 }));
  assert.deepEqual({ register: v.register, alerts: v.alerts, lot6: v.lot6 }, { register: true, alerts: true, lot6: true });
});

test('F-23: an unknown score is unknown (null), never "low"', () => {
  assert.equal(PE.riskView(risk({ probability: null, impact: null })).severity, null);
  assert.equal(PE.riskView(risk({ probability: null, impact: null })).exposure, null);
  assert.equal(RE.view(risk({ probability: null, impact: null })).effective_exposure, null);
  const v = verdicts(risk({ probability: null, impact: null }));
  assert.deepEqual({ register: v.register, alerts: v.alerts, lot6: v.lot6 }, { register: false, alerts: false, lot6: false });
});

test('F-23: the kind rule is shared — an issue counts, an assumption does not, on every surface', () => {
  const vi = verdicts(risk({ kind: 'issue', probability: 3, impact: 3 }));
  assert.deepEqual({ register: vi.register, alerts: vi.alerts, lot6: vi.lot6 }, { register: true, alerts: true, lot6: true });
  const va = verdicts(risk({ kind: 'assumption', probability: 3, impact: 3 }));
  assert.deepEqual({ register: va.register, alerts: va.alerts, lot6: va.lot6 }, { register: false, alerts: false, lot6: false });
  assert.equal(RE.isHigh(risk({ probability: 3, impact: 2 })), true);
  assert.equal(RE.isHigh(risk({ probability: 3, impact: 3, status: 'closed' })), false);
});

// ---- F-22 ---------------------------------------------------------------------------------------------------------
test('F-22: a demand cell with a line of unknown FTE carries unknown_lines and never reads green', () => {
  const lines = [{ id: 1, project_id: 1, skill: 'Net', avg_fte: 0.5, start_month: '2027-01', finish_month: '2027-01' },
    { id: 2, project_id: 2, skill: 'Net', avg_fte: null, start_month: '2027-01', finish_month: '2027-01' }];
  const L = RD.monthlyLoad(lines, { capacity: { net: 1 } });
  const c = L.cells.find((x) => x.skill === 'net' && x.month === '2027-01');
  assert.equal(c.unknown_lines, 1); assert.equal(c.partial, true);
  assert.equal(c.rag, 'NA'); assert.equal(c.utilisation_pct, null);
  // a cell whose KNOWN lines already exceed capacity is red whatever the unknown line holds (a lower bound)
  const over = RD.monthlyLoad([{ ...lines[0], avg_fte: 2 }, lines[1]], { capacity: { net: 1 } }).cells[0];
  assert.equal(over.rag, 'RED'); assert.equal(over.unknown_lines, 1);
  const full = RD.monthlyLoad([lines[0]], { capacity: { net: 1 } }).cells[0];
  assert.equal(full.unknown_lines, 0); assert.equal(full.partial, false);
});

test('F-22: risk rollup reports unknown-score risks and does not claim a low level while some are unknown', () => {
  const r = RE.rollup([risk({ id: 1, probability: 1, impact: 1 }), risk({ id: 2, probability: null, impact: null })]);
  assert.equal(r.counts.unknown, 1); assert.equal(r.unknown, 1);
  assert.equal(r.level, null, 'a known low next to an unknown is not a "low" verdict');
  assert.equal(r.level_at_least, 'low'); assert.equal(r.partial, true);
  assert.equal(RE.rollup([risk({ probability: null, impact: null })]).level, null);
  const hi = RE.rollup([risk({ id: 1, probability: 3, impact: 2 }), risk({ id: 2, probability: null, impact: null })]);
  assert.equal(hi.level, 'high', 'a known high is never hidden by an unknown sibling'); assert.equal(hi.partial, true);
  const tot = RE.portfolio([proj(1)], [risk({ id: 1, probability: 1, impact: 1 }), risk({ id: 2, probability: null, impact: null })]);
  assert.equal(tot.totals.unknown, 1); assert.equal(tot.totals.low, 0);
});

test('F-22: worst sites never says "no site in red or amber" when sites are unmeasured', () => {
  const sites = [{ site_id: 1, site_name: 'A', overall_rag: 'green' }].concat(Array.from({ length: 10 }, (_, i) => ({ site_id: i + 2, site_name: 'N' + i, overall_rag: 'na' })));
  const w = HG.worstSites({ sites });
  assert.equal(w.measured, 1); assert.equal(w.unmeasured, 10);
  const html = HG.groupHtml({ worst: w, late: null, decisions: null }, 'en');
  assert.ok(/10 not measured/.test(html), html);
  assert.ok(/1 measured/.test(html), html);
  const fr = HG.groupHtml({ worst: w, late: null, decisions: null }, 'fr');
  assert.ok(/10 non mesuré/.test(fr), fr);
  assert.equal(HG.worstSites({ sites: sites.slice(1) }), null, 'all unmeasured → "—"');
  const allMeasured = HG.groupHtml({ worst: HG.worstSites({ sites: [sites[0]] }), late: null, decisions: null }, 'en');
  assert.ok(!/· \d+ not measured/.test(allMeasured), 'no coverage note when every site is measured');
});

test('F-22: the executive Data quality card states which scope (with / without budget checks) its score uses', () => {
  const base = { sites: [{ id: 1, name: 'S' }], risks: [], now: new Date('2026-11-20'), intake: true, dqOn: true, filters: {} };
  const ps = [{ ...proj(1), budget: 100, currency: 'USD', budget_status: 'approved' }];
  assert.equal(PR.build(ps, { ...base, money: true }).kpis.find((k) => k.key === 'data_quality').scope, 'with_budget_checks');
  assert.equal(PR.build(ps, { ...base, money: false }).kpis.find((k) => k.key === 'data_quality').scope, 'without_budget_checks');
  const esc = (s) => String(s);
  const html = UI.kpiHtml(PR.build(ps, { ...base, money: false }).kpis, { esc, T: UI.T.en, merge: () => '?' });
  assert.ok(html.includes(UI.T.en.dq_scope_without), html);
  assert.ok(UI.T.fr.dq_scope_without && UI.T.fr.dq_scope_with && UI.T.en.dq_scope_with);
});

// ---- F-24 ---------------------------------------------------------------------------------------------------------
test('F-24: the site-view tooltip does not claim dictionary parity under every rule', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'site-awareness.html'), 'utf8').replace(/\r\n/g, '\n');
  const line = src.split('\n').find((l) => l.includes('c_sla_def:'));
  assert.ok(line);
  assert.ok(!/the same rule as the dictionary's "Resolution SLA"/.test(line), 'unconditional parity claim removed');
  assert.ok(/flag/.test(line), 'the tooltip names the rule the dictionary figure uses');
});

test('F-24: the Vue Groupe helpdesk cell uses the closed-only Resolution SLA (cancelled / open out of the base)', () => {
  // 10 created: 4 closed on time, 1 closed late, 2 open flagged overdue, 3 cancelled flagged overdue
  const hw = { created: 10, sla_overdue: 6, res_sla_den: 5, res_sla_missed: 1, res_sla_pct: 80 };
  const c = SS.fleetCell(hw);
  assert.equal(c.rag, 'red'); assert.equal(c.value, '1/5');
  assert.equal(SS.fleetCell({ created: 10, sla_overdue: 9, res_sla_den: 40, res_sla_missed: 1, res_sla_pct: 97.5 }).rag, 'green', 'open / cancelled overdue do not colour the cell');
  assert.equal(SS.fleetCell({ created: 3, sla_overdue: 3, res_sla_den: 0, res_sla_missed: 0, res_sla_pct: null }).rag, 'na', 'nothing closed → not measured');
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'siteAwareness.js'), 'utf8');
  assert.ok(!/sla_overdue \/ created/.test(route), 'no second formula in the route');
});

// ---- F-25 ---------------------------------------------------------------------------------------------------------
test('F-25: quoted dynamic DROP, DROP DOMAIN and DROP OWNED are destructive (run-once)', () => {
  for (const sql of ["DO $$ BEGIN EXECUTE 'DROP TABLE legacy_x'; END $$;", 'DROP DOMAIN money_amt CASCADE;', 'DROP OWNED BY old_role;',
    "DO $$ BEGIN EXECUTE 'ALTER TABLE t DROP COLUMN c'; END $$;", "DO $$ BEGIN EXECUTE format('DROP TABLE %I', 'x'); END $$;"]) {
    assert.equal(destructiveDdl(sql), true, sql);
    assert.equal(rerunOnChange(sql), false, sql);
  }
  for (const sql of ['DROP INDEX IF EXISTS ix;', "COMMENT ON COLUMN t.c IS 'drop-in replacement';", 'DROP FUNCTION IF EXISTS f();']) assert.equal(destructiveDdl(sql), false, sql);
  // P11 r6 F-25: DROP FUNCTION … CASCADE drops dependent generated columns / views → destructive (run-once) since fix 25
  assert.equal(destructiveDdl('DROP FUNCTION f() CASCADE;'), true);
  for (const m of listMigrations()) assert.equal(destructiveDdl(m.sql), false, m.id);
});
