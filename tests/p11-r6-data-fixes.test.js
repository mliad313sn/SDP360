'use strict';
// P11 round 6 data-kpi fixes (fix 25): F-26 (Vue Groupe helpdesk cell ignored open overdue tickets), F-27 (two more
// "high risk" rules: project card + stage gate), F-28 (risk status free text read as open), F-25 (destructive-DDL
// detector: dollar-quoted / concat / EXTENSION / ATTRIBUTE / CASCADE), plus the PPM seat's R6-1 (project demand
// coloured against group capacity), R6-4 (two meanings of `partial`) and R5-8 (PPM coverage command).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

const SS = require('../services/siteHelpdeskSla');
const FLEET = require('../services/siteAwarenessFleet');
const RE = require('../services/ppm/riskExposure');
const KPI = require('../services/ppm/projectKpis');
const M = require('../db/migrate');

// ---- F-26 ---------------------------------------------------------------------------------------------------------
test('F-26: 1 closed on time + 40 open overdue out of 50 is NOT green — open overdue colours the cell and rides along', () => {
  const c = SS.fleetCell({ created: 50, res_sla_den: 1, res_sla_missed: 0, res_sla_pct: 100, open_overdue: 40 });
  assert.equal(c.rag, 'red'); assert.equal(c.value, '0/1', 'the rate stays the closed-only Resolution SLA');
  assert.equal(c.open_overdue, 40); assert.equal(c.cap, 'red');
  // the overall verdict cannot average back to green behind four green modules
  const g = { rag: 'green', value: 'x' };
  assert.equal(FLEET.rollupRag({ helpdesk: c, inspections: g, meetings: g, actions: g, tracker: g }), 'red');
  // the Lot B "Sites needing attention" ranking lists it (it reads overall_rag)
  const HG = require('../public/lib/homeGroup');
  const w = HG.worstSites({ sites: [{ site_id: 1, site_name: 'Drowning', overall_rag: 'red', cells: { helpdesk: c } }, { site_id: 2, site_name: 'Fine', overall_rag: 'green', cells: {} }] }, 3);
  assert.equal(w.total, 1); assert.equal(w.items[0].name, 'Drowning');
});

test('F-26: the round-5 cases keep their verdicts; bands are the PROPOSED kpiRag policy, exact at the boundaries', () => {
  assert.deepEqual(SS.fleetCell({ created: 10, sla_overdue: 6, res_sla_den: 5, res_sla_missed: 1, res_sla_pct: 80 }).rag, 'red');
  assert.equal(SS.fleetCell({ created: 10, sla_overdue: 9, res_sla_den: 40, res_sla_missed: 1, res_sla_pct: 97.5 }).rag, 'green');
  assert.equal(SS.fleetCell({ created: 3, sla_overdue: 3, res_sla_den: 0, res_sla_missed: 0, res_sla_pct: null }).rag, 'na');
  // nothing closed but open overdue → the open band alone (never green, never silent)
  const open = SS.fleetCell({ created: 3, res_sla_den: 0, res_sla_missed: 0, res_sla_pct: null, open_overdue: 3 });
  assert.equal(open.rag, 'red'); assert.equal(open.value, null);
  // nothing closed, nothing overdue → not measured
  assert.equal(SS.fleetCell({ created: 5, res_sla_den: 0, res_sla_missed: 0, res_sla_pct: null, open_overdue: 0 }).rag, 'na');
  // former strict cut-offs: 1/20 missed = 5 % → amber (not green), 3/20 = 15 % → red
  assert.equal(SS.fleetCell({ created: 20, res_sla_den: 20, res_sla_missed: 1, res_sla_pct: 95, open_overdue: 0 }).rag, 'amber');
  assert.equal(SS.fleetCell({ created: 20, res_sla_den: 20, res_sla_missed: 3, res_sla_pct: 85, open_overdue: 0 }).rag, 'red');
  // a small open overdue share (2 / 100) keeps a green closed verdict, and sets no cap
  const small = SS.fleetCell({ created: 100, res_sla_den: 60, res_sla_missed: 0, res_sla_pct: 100, open_overdue: 2 });
  assert.equal(small.rag, 'green'); assert.equal(small.cap, undefined);
  const P = require('../public/lib/kpiRag').POLICIES['helpdesk-fleet-sla'];
  assert.equal(P.status, 'PROPOSED'); assert.equal(P.green, 0.95); assert.equal(P.amber, 0.85);
});

test('F-26: the route and the page carry open_overdue and the cap; no second helpdesk formula', () => {
  const route = read('routes/siteAwareness.js');
  assert.match(route, /cell\.open_overdue = c\.open_overdue/);
  assert.match(route, /require\('\.\.\/services\/siteAwarenessFleet'\)\.rollupRag/);
  assert.ok(!/function rollupRag/.test(route), 'one rollup, in the service');
  const page = read('public/site-awareness.html');
  assert.match(page, /g_open_overdue:/); assert.match(page, /c\.open_overdue/);
});

// ---- F-27 / F-28 ---------------------------------------------------------------------------------------------------
test('F-27: the project page card counts high risks with the ONE rule (residual first, risks + issues, unknown never high)', () => {
  const base = { project: { stage: 'in_progress' }, tasks: [], milestones: [], schedule: null, evm: null, rag: null, gates: null, today: '2026-11-20' };
  const n = (risks) => KPI.projectSummary({ ...base, risks }).cards.high_risks;
  assert.equal(n([{ id: 1, kind: 'risk', status: 'open', probability: 3, impact: 3, residual_probability: 1, residual_impact: 1 }]), 0, 'mitigated to low: not high');
  assert.equal(n([{ id: 2, kind: 'risk', status: 'open', probability: 1, impact: 1, residual_probability: 3, residual_impact: 3 }]), 1, 'residual high counts');
  assert.equal(n([{ id: 3, kind: 'issue', status: 'open', probability: 3, impact: 3 }]), 1, 'an open issue counts');
  assert.equal(n([{ id: 4, kind: 'risk', status: 'open', probability: null, impact: 3 }]), 0, 'unknown score is not high');
});

test('F-27: no high-risk threshold outside services/ppm/riskExposure.js (every surface uses isHigh / level)', () => {
  const ALLOW = new Map([
    ['services/ppm/riskExposure.js', 'the ONE mapping'],
    ['public/lib/ppmVisuals.js', 'browser heat-map CELL band of a fixed P×I position (matrix display, not a count) — mirrors the mapping'],
  ]);
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) { const p = d + '/' + e.name; if (e.isDirectory()) { if (!['node_modules', 'vendor'].includes(e.name)) walk(p); } else if (/\.js$/.test(e.name) && !/\.min\.js$/.test(e.name)) files.push(p); } };
  ['services', 'routes', 'public/lib'].forEach(walk);
  const hits = [];
  const re = /\*\s*(?:Number\()?[\w.]*impact\b[^;\n]*>=\s*6\b|\b(?:score|exposure|e)\s*>=\s*6\b|probability\s*\*\s*\w*\.?impact\s*>=/;
  for (const f of files) {
    const src = read(f).split('\n');
    src.forEach((l, i) => { if (re.test(l) && !ALLOW.has(f)) hits.push(`${f}:${i + 1}: ${l.trim().slice(0, 120)}`); });
  }
  assert.deepEqual(hits, [], 'a second high-risk rule:\n' + hits.join('\n'));
  // the named surfaces call the shared predicate
  assert.match(read('services/ppm/projectKpis.js'), /filter\(RE\.isHigh\)/);
  assert.match(read('services/governanceStore.js'), /riskExposure'\)\.isHigh\)\.length/);
  assert.match(read('services/portfolioDeck.js'), /riskExposure'\)\.isHigh/);
});

test('F-28: closed / mitigated / other terminal statuses (any case) are not open; kind is case-insensitive', () => {
  const r = (status, kind = 'risk') => ({ kind, status, probability: 3, impact: 3 });
  for (const st of ['closed', 'Closed', 'CLOSED', 'mitigated', 'Mitigated', 'resolved', 'cancelled', 'done']) assert.equal(RE.isHigh(r(st)), false, st);
  assert.equal(RE.isHigh(r('open')), true); assert.equal(RE.isHigh(r('Open')), true);
  assert.equal(RE.isHigh(r('open', 'Assumption')), false, 'an assumption in any case is out of scope');
  const ru = RE.rollup([r('Mitigated'), { ...r('open'), probability: 1, impact: 1 }]);
  assert.equal(ru.open, 1); assert.equal(ru.level, 'low');
});

// ---- F-25 ---------------------------------------------------------------------------------------------------------
test('F-25: dollar-quoted / concat-built dynamic DDL, DROP EXTENSION, ALTER TYPE DROP ATTRIBUTE, DROP … CASCADE are run-once', () => {
  const run1 = ['DO $$ BEGIN EXECUTE $q$DROP TABLE legacy_x$q$; END $$;', 'DO $$ BEGIN EXECUTE $s$ALTER TABLE t DROP COLUMN c$s$; END $$;',
    "DO $$ BEGIN EXECUTE concat('DROP', ' TABLE legacy_x'); END $$;", 'DO $f$ BEGIN EXECUTE $$DROP TABLE x$$; END $f$;',
    'DROP EXTENSION citext CASCADE;', 'DROP EXTENSION IF EXISTS citext;', 'ALTER TYPE addr DROP ATTRIBUTE zip CASCADE;', 'DROP FUNCTION f(int) CASCADE;'];
  for (const s of run1) { assert.equal(M.destructiveDdl(s), true, s); assert.equal(M.rerunOnChange(s), false, s); }
  const rerun = ['DROP FUNCTION IF EXISTS f(int);', 'DROP TRIGGER IF EXISTS t ON x;', 'DROP INDEX IF EXISTS i;', 'ALTER TABLE t DROP CONSTRAINT c;',
    "DO $$ BEGIN EXECUTE $f$CREATE OR REPLACE FUNCTION g() RETURNS int LANGUAGE sql AS 'SELECT 1'$f$; END $$;", 'CREATE TABLE IF NOT EXISTS a (id int REFERENCES b(id) ON DELETE CASCADE);'];
  for (const s of rerun) assert.equal(M.rerunOnChange(s), true, s);
});

test('F-25: every shipped migration keeps its classification (pinned)', () => {
  const root = path.join(ROOT, 'db', 'postgres');
  const destructive = [];
  for (const a of fs.readdirSync(root)) {
    const d = path.join(root, a); if (!fs.statSync(d).isDirectory()) continue;
    for (const f of fs.readdirSync(d).filter((x) => x.endsWith('.sql'))) if (M.destructiveDdl(fs.readFileSync(path.join(d, f), 'utf8'))) destructive.push(a + '/' + f);
  }
  const PINNED = JSON.parse(read('tests/fixtures/destructive-migrations.json'));
  assert.deepEqual(destructive.sort(), PINNED.sort());
});

// ---- R6-1 / R6-4 / R5-8 (PPM seat) ---------------------------------------------------------------------------------
test('R6-1 / R6-4: the project demand route never colours a shared skill-month against group capacity; one name per meaning', () => {
  const src = read('routes/governancePortfolioPhase2.js');
  assert.match(src, /shared_with_other_projects/); assert.match(src, /c\.rag = 'NA'; c\.utilisation_pct = null/);
  assert.match(src, /view_partial: true, view_partial_note/); assert.ok(!/flags: \{ partial:/.test(src), 'the response flag is view_partial, not partial');
  assert.match(read('public/lib/ppmPhase2.js'), /d\.view_partial/); assert.match(read('public/lib/portfolioPhase2Page.js'), /d\.view_partial/);
});

test('R5-8: the PPM coverage command includes the portfolio test files and services', () => {
  const s = require('../package.json').scripts['test:coverage:ppm'];
  assert.ok(s, 'npm run test:coverage:ppm exists');
  assert.match(s, /tests\/ppm-\*\.test\.js/); assert.match(s, /tests\/portfolio-\*\.test\.js/);
  assert.match(s, /services\/ppm\/\*\*/); assert.match(s, /services\/portfolio\*\.js/);
});

// ---- PG: the generic writer (F-28) and the stage-gate count (F-27) ---------------------------------------------------
async function govStore() {
  const { makeGovernanceStore } = require('../services/governanceStore');
  const s = makeGovernanceStore(await require('./_pg-fresh').freshStore(['portfolio_programmes', 'portfolio_objectives', 'portfolio_projects', 'portfolio_risks']), { now: () => '2026-11-20T10:00:00.000Z' });
  await s.init();
  const pr = await s.upsertPortfolio('programme', { key: 'r6p', name: 'P' });
  const ob = await s.upsertPortfolio('objective', { programme_id: pr, key: 'r6o', name: 'O' });
  const pj = await s.upsertPortfolio('project', { objective_id: ob, key: 'r6j', name: 'J' });
  return { s, pj };
}

test('F-28 (pg): the generic risk writer refuses a status outside open | closed and normalises case', async () => {
  const { s, pj } = await govStore();
  await assert.rejects(s.upsertPortfolio('risk', { project_id: pj, title: 'R mitigated', probability: 3, impact: 3, status: 'mitigated' }), /risk status must be open \| closed/);
  await assert.rejects(s.upsertPortfolio('risk', { project_id: pj, title: 'R free', status: 'whatever text' }), /risk status/);
  const id = await s.upsertPortfolio('risk', { project_id: pj, title: 'R closed', probability: 3, impact: 3, status: 'Closed' });
  const row = (await s.projectDetail(pj)).risks.find((r) => r.id === id);
  assert.equal(row.status, 'closed');
  assert.equal((await s.gateCounts(pj)).openRisksHigh, 0, 'a closed risk is not a high open risk');
});

test('F-27 (pg): the stage-gate count = riskExposure.isHigh (residual first, issues count, unknown never high)', async () => {
  const { s, pj } = await govStore();
  const pg = require('../reports-db').pgHandle();
  const a = await s.upsertPortfolio('risk', { project_id: pj, title: 'Inherent high, mitigated', probability: 3, impact: 3 });
  await pg.prepare('UPDATE portfolio_risks SET residual_probability = 1, residual_impact = 1 WHERE id = ?').run(a);
  assert.equal((await s.gateCounts(pj)).openRisksHigh, 0, 'residual low: the gate no longer counts it');
  const b = await s.upsertPortfolio('risk', { project_id: pj, title: 'Inherent low, residual high', probability: 1, impact: 1 });
  await pg.prepare('UPDATE portfolio_risks SET residual_probability = 3, residual_impact = 3 WHERE id = ?').run(b);
  assert.equal((await s.gateCounts(pj)).openRisksHigh, 1);
  await s.upsertPortfolio('risk', { project_id: pj, title: 'Open issue high', kind: 'issue', probability: 3, impact: 3 });
  assert.equal((await s.gateCounts(pj)).openRisksHigh, 2, 'an open issue counts like the register');
});
