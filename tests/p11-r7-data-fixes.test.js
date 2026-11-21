'use strict';
// P11 round 7 data-kpi + PPM fixes (fix 30): F-29 (project RAG risk input used inherent P×I and read an unscored risk as
// "no risk"), F-30 / R7-3 (project card active vs high counts on two populations; strict status === 'open' filters),
// F-31 (Vue Groupe: a helpdesk cell red on its CLOSED band did not cap the site overall; a 1-ticket closed base read
// green), R7-1 (project demand: a shared cell this project alone already exceeds read NA, not RED) and R7-2 (the
// per-cell shared flag told a site-scoped reader that an unreadable project demands a skill in a month).
// AI-written regression pins — not a human review.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

const RE = require('../services/ppm/riskExposure');
const KPI = require('../services/ppm/projectKpis');
const RAG = require('../services/ppm/projectRag');
const RAID = require('../services/ppm/raid');
const SS = require('../services/siteHelpdeskSla');
const FLEET = require('../services/siteAwarenessFleet');

const risk = (o) => Object.assign({ id: 1, kind: 'risk', status: 'open', probability: null, impact: null }, o);
const riskRag = (risks) => RAG.computeRag({ risk_score: KPI.riskScore(risks) }, null).components.risk.rag;

// ---- F-29 ---------------------------------------------------------------------------------------------------------
test('F-29: the project RAG risk input is residual-first (the shared rule), not inherent P×I', () => {
  // inherent 3×3 = 9 (critical), mitigated to 1×1 = low → NOT red
  const mitigated = [risk({ probability: 3, impact: 3, residual_probability: 1, residual_impact: 1 })];
  assert.equal(KPI.riskScore(mitigated), 1);
  assert.equal(riskRag(mitigated), 'green');
  // inherent 1×1, residual 3×3 → red
  assert.equal(riskRag([risk({ probability: 1, impact: 1, residual_probability: 3, residual_impact: 3 })]), 'red');
  // a residual half-filled falls back to the inherent score (same as riskExposure.effective)
  assert.equal(KPI.riskScore([risk({ probability: 3, impact: 2, residual_probability: 1, residual_impact: null })]), 6);
  // agreement with the card count: the RAG risk component is red / amber exactly when isHigh says high / critical
  for (const r of [risk({ probability: 3, impact: 3 }), risk({ probability: 2, impact: 3 }), risk({ probability: 2, impact: 2 }), risk({ probability: 3, impact: 3, residual_probability: 1, residual_impact: 2 })]) {
    const rag = riskRag([r]); assert.equal(rag === 'red' || rag === 'amber', RE.isHigh(r), JSON.stringify(r));
  }
});

test('F-29: an unscored open risk is UNKNOWN (null → component NA), never a measured "no risk"', () => {
  const unscored = [risk({ probability: null, impact: 3 })];
  assert.equal(KPI.riskScore(unscored), null);
  assert.equal(riskRag(unscored), null, 'never green on an unscored risk');
  // an unknown beside a known LOW stays unknown (it could be worse)
  assert.equal(KPI.riskScore([risk({ id: 1, probability: 1, impact: 1 }), risk({ id: 2, probability: null, impact: null })]), null);
  // a known HIGH / CRITICAL is never hidden by an unknown sibling
  assert.equal(KPI.riskScore([risk({ id: 1, probability: 3, impact: 3 }), risk({ id: 2 })]), 9);
  // unchanged edges: empty register → null; rows but none open → 0; assumptions ignored
  assert.equal(KPI.riskScore([]), null);
  assert.equal(KPI.riskScore([risk({ status: 'closed', probability: 3, impact: 3 })]), 0);
  // P11 r8 data R8-2 (fix 34): an assumptions-only list is "nothing in scope" — null like an empty list, not 0 (green)
  assert.equal(KPI.riskScore([risk({ kind: 'assumption', probability: 3, impact: 3 })]), null);
  // a legacy 'Open' row is open
  assert.equal(KPI.riskScore([risk({ status: 'Open', probability: 3, impact: 3 })]), 9);
});

test('F-29: the risk band is DERIVED from riskExposure (no second literal threshold on raw P×I)', () => {
  assert.strictEqual(RAG.DEFAULT_THRESHOLDS.risk_score, RE.RAG_THRESHOLDS);
  assert.equal(RE.RAG_THRESHOLDS.red_enter, RE.SCORE_MIN.critical - 1);
  assert.equal(RE.RAG_THRESHOLDS.amber_enter, RE.SCORE_MIN.high - 1);
  assert.match(read('services/ppm/projectKpis.js'), /RE\.projectScore\(risks\)/);
});

test('F-29: guard — no ad-hoc probability × impact threshold (>= 6 OR red_enter / amber_enter literal on risk_score)', () => {
  const ALLOW = new Map([
    ['services/ppm/riskExposure.js', 'the ONE mapping'],
    ['public/lib/ppmVisuals.js', 'browser heat-map CELL band of a fixed P×I position (matrix display, not a count) — mirrors the mapping'],
  ]);
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) { const p = d + '/' + e.name; if (e.isDirectory()) { if (!['node_modules', 'vendor'].includes(e.name)) walk(p); } else if (/\.js$/.test(e.name) && !/\.min\.js$/.test(e.name)) files.push(p); } };
  ['services', 'routes', 'public/lib'].forEach(walk);
  const PATTERNS = [
    /\*\s*(?:Number\()?[\w.]*impact\b[^;\n]*>=\s*6\b|\b(?:score|exposure|e)\s*>=\s*6\b|probability\s*\*\s*\w*\.?impact\s*>=/,
    // a literal RAG band on the risk score (the r6 guard missed `risk_score: { red_enter: 8, amber_enter: 5 }`)
    /risk_?score\b[^\n]*\b(?:red|amber)_(?:enter|exit)\s*:\s*\d/i,
    // a local probability × impact maximum used as a RAG input
    /Math\.max\([^)\n]*probability[^)\n]*\*[^)\n]*impact/,
    /Number\([\w.]*probability\)\s*\*\s*Number\([\w.]*impact\)/,
  ];
  const hits = [];
  for (const f of files) {
    if (ALLOW.has(f)) continue;
    read(f).split('\n').forEach((l, i) => { if (PATTERNS.some((re) => re.test(l))) hits.push(`${f}:${i + 1}: ${l.trim().slice(0, 120)}`); });
  }
  assert.deepEqual(hits, [], 'a second risk-score rule:\n' + hits.join('\n'));
  // the guard bites on the round-7 shapes (self-test)
  assert.ok(PATTERNS[1].test("  risk_score: Object.freeze({ dir: 'high', red_enter: 8, red_exit: 8, amber_enter: 5, amber_exit: 5 }),"));
  assert.ok(PATTERNS[3].test('  const scores = open.map((r) => Number(r.probability) * Number(r.impact)).filter(Number.isFinite);'));
});

// ---- F-30 / R7-3 --------------------------------------------------------------------------------------------------
test('F-30 / R7-3: active and high count the SAME population (high ⊆ active); legacy "Open" rows read alike', () => {
  const base = { project: { stage: 'in_progress' }, tasks: [], milestones: [], schedule: null, evm: null, rag: null, gates: null, today: '2026-11-21' };
  const cards = (risks) => KPI.projectSummary({ ...base, risks });
  const issueOnly = cards([risk({ kind: 'issue', probability: 3, impact: 3 })]).cards;
  assert.equal(issueOnly.active_risks, 1); assert.equal(issueOnly.high_risks, 1, '"0 · 1" can no longer happen');
  const legacy = cards([risk({ status: 'Open', probability: 3, impact: 3, title: 'Legacy' })]);
  assert.equal(legacy.cards.active_risks, 1); assert.equal(legacy.cards.high_risks, 1);
  assert.equal(legacy.top_risks.length, 1, 'top_risks reads the shared isOpen');
  const closedUpper = cards([risk({ status: 'Mitigated', probability: 3, impact: 3 })]);
  assert.equal(closedUpper.cards.active_risks, 0); assert.equal(closedUpper.top_risks.length, 0);
  // assumption out of both counts
  assert.equal(cards([risk({ kind: 'assumption', probability: 3, impact: 3 })]).cards.active_risks, 0);
  // fuzz: high is a subset of active
  for (const kind of ['risk', 'issue', 'Issue', 'assumption']) for (const status of ['open', 'Open', 'closed', 'Closed']) for (const p of [null, 1, 3]) {
    const c = cards([risk({ kind, status, probability: p, impact: 3 })]).cards; assert.ok(c.high_risks <= c.active_risks, `${kind}/${status}/${p}`);
  }
  // labels say "risks + issues"
  assert.match(read('public/lib/ppmGovernanceW3.js'), /Active risks \+ issues · high/);
  assert.match(read('services/ppm/projectReport.js'), /Open risks \+ issues \/ high/);
});

test('F-30: raid.review_overdue and the remaining strict status filters use the shared case-insensitive isOpen', () => {
  const row = { id: 1, project_id: 1, kind: 'risk', title: 'x', probability: 2, impact: 2, status: 'Open' };
  assert.equal(RAID.view(row, { review_date: '2026-01-01' }, { today: '2026-11-21', money: false }).review_overdue, true);
  assert.equal(RAID.view({ ...row, status: 'Closed' }, { review_date: '2026-01-01' }, { today: '2026-11-21', money: false }).review_overdue, false);
  for (const f of ['services/ppm/projectKpis.js', 'services/ppm/raid.js', 'services/portfolioDeck.js']) assert.ok(!/status === 'open'/.test(read(f)), f);
  assert.ok(!/r\.status === 'open' && r\.severity/.test(read('routes/governance.js')));
});

// ---- F-31 ---------------------------------------------------------------------------------------------------------
const G = { rag: 'green', value: 'x' };
const four = { inspections: G, meetings: G, actions: G, tracker: G };
test('F-31: a helpdesk cell red on its CLOSED band caps the site overall (all 20 closed missed SLA)', () => {
  const c = SS.fleetCell({ created: 20, res_sla_den: 20, res_sla_missed: 20, res_sla_pct: 0, open_overdue: 0 });
  assert.equal(c.rag, 'red'); assert.equal(c.cap, 'red');
  assert.equal(FLEET.rollupRag({ helpdesk: c, ...four }), 'red', 'not green behind four green modules');
  const amber = SS.fleetCell({ created: 20, res_sla_den: 20, res_sla_missed: 2, res_sla_pct: 90, open_overdue: 0 });
  assert.equal(amber.rag, 'amber'); assert.equal(amber.cap, 'amber');
  assert.equal(FLEET.rollupRag({ helpdesk: amber, ...four }), 'amber');
  // a green cell sets no cap (unchanged)
  assert.equal(SS.fleetCell({ created: 100, res_sla_den: 60, res_sla_missed: 0, res_sla_pct: 100, open_overdue: 2 }).cap, undefined);
});

test('F-31: a closed base below the PROPOSED minimum is shown but not judged — never green on 1 ticket', () => {
  const P = require('../public/lib/kpiRag').POLICIES['helpdesk-fleet-sla'];
  assert.equal(P.min_closed, 5); assert.equal(P.status, 'PROPOSED');
  const one = SS.fleetCell({ created: 100, res_sla_den: 1, res_sla_missed: 0, res_sla_pct: 100, open_overdue: 0 });
  assert.equal(one.rag, 'na'); assert.equal(one.value, '0/1', 'the figure is still shown'); assert.equal(one.insufficient, true); assert.equal(one.min_closed, 5);
  assert.equal(FLEET.rollupRag({ helpdesk: one, ...four }), 'green', 'an na cell is not scored (the other modules decide)');
  assert.equal(SS.fleetCell({ created: 4, res_sla_den: 4, res_sla_missed: 0, res_sla_pct: 100, open_overdue: 0 }).rag, 'na');
  assert.equal(SS.fleetCell({ created: 5, res_sla_den: 5, res_sla_missed: 0, res_sla_pct: 100, open_overdue: 0 }).rag, 'green', 'at the minimum: judged');
  // small closed base + a bad open band → the open band still gives a verdict (r6 F-26 case kept)
  const r6 = SS.fleetCell({ created: 50, res_sla_den: 1, res_sla_missed: 0, res_sla_pct: 100, open_overdue: 40 });
  assert.equal(r6.rag, 'red'); assert.equal(r6.cap, 'red');
  // the route carries the flag; the page tooltip says it
  assert.match(read('routes/siteAwareness.js'), /cell\.insufficient = true/);
  assert.match(read('public/site-awareness.html'), /fewer than \{min\} closed tickets/);   // r8 F-31: the number comes from the policy
});

// ---- R7-1 / R7-2 (static; the HTTP behaviour is pinned by tests/p11-r7-ppm.smoke.test.js) -------------------------
test('R7-1 / R7-2: the project demand route keeps a certain RED and tells sharing only to a full-portfolio reader', () => {
  const src = read('routes/governancePortfolioPhase2.js');
  assert.match(src, /const fullRead = others\.every\(\(id\) => seen\.has\(id\)\)/);
  assert.match(src, /own_demand_over_capacity = true/);
  assert.match(src, /load\.over = load\.cells\.filter\(\(c\) => c\.rag === 'RED'\)\.length;/);
});
