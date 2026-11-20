'use strict';
// PORTFOLIO LOT 6 — the pure rules: structured dependencies (exactly one target, cycle across projects, flags, legacy
// read-compatibility + backfill plan), 4-level exposure + rollup, numeric-only FTE, capacity threshold boundaries,
// effort score (partial → null, band boundaries), document checks (type / mime / content / size / title), scenario.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const SD = require('../services/ppm/structuredDependencies');
const RX = require('../services/ppm/riskExposure');
const RD = require('../services/ppm/resourceDemand');
const ES = require('../services/ppm/effortScoring');
const PD = require('../services/ppm/projectDocuments');
const SC = require('../services/ppm/portfolioScenario');
const KpiRag = require('../public/lib/kpiRag');

test('dependency: exactly one target, no self, vocabularies, dates', () => {
  assert.throws(() => SD.normalise({}, { projectId: 1 }), (e) => e.reason === 'DEP_TARGET');
  assert.throws(() => SD.normalise({ predecessor_project_id: 2, external_category: 'power' }, { projectId: 1 }), (e) => e.reason === 'DEP_TARGET');
  assert.throws(() => SD.normalise({ predecessor_project_id: 1 }, { projectId: 1 }), (e) => e.reason === 'DEP_SELF');
  assert.throws(() => SD.normalise({ external_category: 'pizza' }, { projectId: 1 }), (e) => e.reason === 'DEP_CATEGORY');
  assert.throws(() => SD.normalise({ external_category: 'power', target_date: '2027-02-30' }, { projectId: 1 }), (e) => e.reason === 'DATE_INVALID');
  const n = SD.normalise({ external_category: 'hse_approval', owner: ' HSE ', criticality: 'high' }, { projectId: 1 });
  assert.equal(n.status, 'open'); assert.equal(n.owner, 'HSE'); assert.equal(n.target_date, null);
});

test('dependency cycle across projects: direct and transitive loops are detected, an unrelated edge is not', () => {
  const edges = [{ from: 1, to: 2 }, { from: 2, to: 3 }];
  assert.equal(SD.wouldCreateCycle(edges, 3, 1), true, '3 → 1 closes 1 → 2 → 3');
  assert.equal(SD.wouldCreateCycle(edges, 2, 1), true);
  assert.equal(SD.wouldCreateCycle(edges, 4, 1), false);
  assert.equal(SD.wouldCreateCycle(edges, 1, 1), true);
  assert.deepEqual(SD.findCycles([...edges, { from: 3, to: 1 }]), [[1, 2, 3]]);
  assert.deepEqual(SD.findCycles(edges), []);
});

test('flags: an external dependency without an owner is flagged by DQ; open past target = overdue; met is not overdue', () => {
  assert.deepEqual(SD.dqFlags({ external_category: 'power', status: 'open', target_date: '2027-01-01' }, { today: '2026-11-20' }), ['DEP_EXTERNAL_NO_OWNER']);
  assert.deepEqual(SD.dqFlags({ predecessor_project_id: 2, owner: 'A', status: 'open' }, { today: '2026-11-20' }), ['DEP_NO_TARGET_DATE']);
  assert.deepEqual(SD.dqFlags({ predecessor_project_id: 2, owner: 'A', status: 'open', target_date: '2026-01-01' }, { today: '2026-11-20' }), ['DEP_OVERDUE']);
  assert.deepEqual(SD.dqFlags({ predecessor_project_id: 2, owner: 'A', status: 'met', target_date: '2026-01-01' }, { today: '2026-11-20' }), []);
});

test('legacy depends_on stays readable and the backfill plan skips what already exists', () => {
  const projects = [{ id: 1, key: 'A', depends_on: '[2, "B", "Vendor X"]' }, { id: 2, key: 'B', depends_on: null }, { id: 3, key: 'C', depends_on: ['1', 'unknown-key'] }];
  const pv = SD.portfolioView(projects, [], { today: '2026-11-20' });
  assert.ok(pv.items.every((i) => i.source === 'legacy'));
  assert.deepEqual(pv.edges.sort((a, b) => a.from - b.from), [{ from: 1, to: 2 }, { from: 3, to: 1 }], '"2" and key "B" collapse into one edge');
  const plan = SD.backfillPlan(projects, [{ project_id: 1, predecessor_project_id: 2 }]);
  assert.deepEqual(plan.map((r) => [r.project_id, r.predecessor_project_id, r.external_category, r.description]), [[1, null, 'other', 'Vendor X'], [3, 1, null, null], [3, null, 'other', 'unknown-key']]);
  assert.ok(plan.every((r) => r.owner === null && r.target_date === null), 'unknown stays unknown');
});

test('4-level exposure (PROPOSED mapping), residual wins over inherent, unknown is null, rollup = highest open', () => {
  assert.equal(RX.MAPPING.status, 'PROPOSED');
  assert.deepEqual([[1, 1], [1, 2], [1, 3], [2, 2], [2, 3], [3, 3], [null, 3]].map(([p, i]) => RX.level(p, i)), ['low', 'low', 'medium', 'medium', 'high', 'critical', null]);
  const ru = RX.rollup([{ id: 1, project_id: 9, kind: 'risk', status: 'open', probability: 3, impact: 3, residual_probability: 1, residual_impact: 2 },
    { id: 2, project_id: 9, kind: 'issue', status: 'open', probability: 2, impact: 3, due_date: '2026-01-01' }, { id: 3, project_id: 9, kind: 'risk', status: 'closed', probability: 3, impact: 3 },
    { id: 4, project_id: 9, kind: 'assumption', status: 'open', probability: 3, impact: 3 }], { today: '2026-11-20' });
  assert.equal(ru.level, 'high', 'residual low beats inherent critical; the issue is high; closed + assumption ignored');
  assert.equal(ru.open, 2); assert.equal(ru.overdue, 1);
  assert.equal(RX.rollup([], {}).level, null, 'no risk → unknown, never low');
  assert.throws(() => RX.normaliseResidual({ residual_probability: 4 }), (e) => e.reason === 'BAD_SCORE');
});

test('FTE is numeric only; peak ≥ average; window order', () => {
  for (const bad of ['medium', '0,5', 'abc', true, '1.2.3', -1, 101]) assert.throws(() => RD.normalise({ skill: 'Network engineer', avg_fte: bad }), (e) => /FTE_/.test(e.reason), String(bad));
  assert.throws(() => RD.normalise({ skill: 'NE', avg_fte: 1, peak_fte: 0.5 }), (e) => e.reason === 'FTE_PEAK');
  assert.throws(() => RD.normalise({ skill: 'NE', start_month: '2027-05', finish_month: '2027-01' }), (e) => e.reason === 'DATE_ORDER');
  assert.equal(RD.normalise({ skill: 'NE', avg_fte: '0.5' }).avg_fte, 0.5);
  assert.equal(RD.normalise({ skill: 'NE' }).avg_fte, null, 'unknown stays null, never 0');
});

test('capacity threshold boundaries (PROPOSED policy ppm-capacity on capacity ÷ demand)', () => {
  assert.equal(KpiRag.POLICIES['ppm-capacity'].status, 'PROPOSED');
  assert.deepEqual(RD.evaluate(1, null), { utilisation_pct: null, rag: 'NA' }, 'unknown capacity → no colour');
  assert.equal(RD.evaluate(1, 1).rag, 'AMBER', 'exactly at capacity');
  assert.equal(RD.evaluate(1.01, 1).rag, 'RED', 'just over');
  assert.equal(RD.evaluate(1, 1.18).rag, 'GREEN', 'ratio 1.18 = green boundary');
  assert.equal(RD.evaluate(1, 1.17).rag, 'AMBER');
  assert.equal(RD.evaluate(0, 2).rag, 'GREEN');
  assert.equal(RD.evaluate(1, 0).rag, 'RED');
  const cap = RD.parseCapacity('{"network engineer": 1, "*": 2}');
  const L = RD.monthlyLoad([{ project_id: 1, skill: 'Network Engineer', avg_fte: 0.6, peak_fte: 1, start_month: '2027-01', finish_month: '2027-02' }, { project_id: 2, skill: 'network engineer', avg_fte: 0.5, peak_fte: null, start_month: '2027-02', finish_month: '2027-02' },
    { project_id: 3, skill: 'PM', avg_fte: null, start_month: '2027-01', finish_month: '2027-01' }], { capacity: cap.map });
  const feb = L.cells.find((c) => c.month === '2027-02');
  assert.equal(feb.avg_fte, 1.1); assert.equal(feb.rag, 'RED'); assert.equal(feb.peak_fte, null, 'one peak unknown → the sum is unknown');
  assert.equal(L.cells.find((c) => c.month === '2027-01').rag, 'GREEN');
  assert.deepEqual(L.unplaced.map((u) => u.reason), ['no_avg_fte']);
  assert.equal(RD.parseCapacity('').configured, false); assert.ok(RD.parseCapacity('{bad').problems.length);
});

test('effort score: partial → null, PROPOSED weights and band boundaries, mismatch only shown', () => {
  const all = (v) => Object.fromEntries(ES.FACTORS.map((f) => [f, v]));
  assert.equal(ES.score({ ...all(3), change_impact: null }).score, null);
  assert.equal(ES.score(all(1)).score, 20); assert.equal(ES.score(all(1)).band, 'small');
  assert.equal(ES.score(all(5)).score, 100); assert.equal(ES.score(all(5)).band, 'very_large');
  assert.deepEqual([34, 35, 54, 55, 74, 75].map(ES.bandOf), ['small', 'medium', 'medium', 'large', 'large', 'very_large']);
  assert.equal(ES.score(all(3), { declared: 'small' }).mismatch, true);
  assert.throws(() => ES.normalise({ technical_complexity: 6 }), (e) => e.reason === 'EFFORT_SCORE');
  const w = ES.parseWeights('{"technical_complexity": 3}'); assert.equal(w.weights.technical_complexity, 3);
  assert.match(ES.parseWeights('').status, /PROPOSED/);
});

test('documents: type, mime allow-list, content must match the type, size, title; no path in the view or file name', () => {
  const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(10)]);
  const ok = PD.validateUpload({ doc_type: 'business_case', title: 'Case v1', mime: 'application/pdf', buf: pdf });
  assert.equal(ok.size_bytes, pdf.length);
  assert.throws(() => PD.validateUpload({ doc_type: 'selfie', title: 'Case', mime: 'application/pdf', buf: pdf }), (e) => e.reason === 'DOC_TYPE');
  assert.throws(() => PD.validateUpload({ doc_type: 'design', title: 'Case', mime: 'application/x-msdownload', buf: pdf }), (e) => e.reason === 'DOC_MIME');
  assert.throws(() => PD.validateUpload({ doc_type: 'design', title: 'Case', mime: 'application/pdf', buf: Buffer.from('MZ\x90\x00 exe') }), (e) => e.reason === 'DOC_CONTENT');
  assert.throws(() => PD.validateUpload({ doc_type: 'design', title: 'Case', mime: 'application/pdf', buf: Buffer.concat([pdf, Buffer.alloc(PD.MAX_BYTES)]) }), (e) => e.reason === 'DOC_TOO_LARGE');
  assert.throws(() => PD.validateUpload({ doc_type: 'design', title: 'x', mime: 'application/pdf', buf: pdf }), (e) => e.reason === 'DOC_TITLE');
  const v = PD.view({ id: 1, project_id: 2, doc_type: 'vendor_quotation', title: 't', version: 1, mime: 'application/pdf', size_bytes: 9, blob_ref: 'ppm-doc/p2/x' }, { money: false });
  assert.equal(v.restricted, true); assert.equal(v.download, false); assert.equal('blob_ref' in v, false);
  assert.equal(v.title, null); assert.equal(v.title_masked, true);   // P11 R5-6
  assert.equal(PD.view({ id: 1, project_id: 2, doc_type: 'vendor_quotation', title: 't', version: 1 }, { money: true }).title, 't');
  assert.equal(/[\\/]/.test(PD.downloadName({ doc_type: 'design', version: 2, title: '../../etc/passwd', mime: 'application/pdf' })), false);
});

test('scenario: read-only input checks and dependency conflicts after a shift', () => {
  assert.throws(() => SC.normalise({ shifts: [{ project_id: 99, months: 1 }] }, [1, 2]), (e) => e.reason === 'SCENARIO_PROJECT');
  assert.throws(() => SC.normalise({ shifts: [{ project_id: 1, months: 30 }] }, [1, 2]), (e) => e.reason === 'SCENARIO_MONTHS');
  const projects = [{ id: 1, start_date: '2027-04-01', end_date: '2027-06-30' }, { id: 2, start_date: '2027-01-01', end_date: '2027-03-31' }];
  const edges = [{ from: 1, to: 2 }];
  assert.equal(SC.conflicts(projects, edges).length, 0);
  const s = SC.normalise({ shifts: [{ project_id: 2, months: 2 }] }, [1, 2]);
  assert.equal(SC.conflicts(projects, edges, s).length, 1, 'predecessor now ends after the dependent starts');
  const out = SC.simulate({ projects, lines: [], edges, capacity: {}, scenario: s });
  assert.equal(out.read_only, true); assert.equal(out.delta.dependency_conflicts, 1);
  assert.equal(SC.shiftDay('2027-01-31', 1), '2027-02-28');
});

test('P11 R5-5 — a demand window over 60 months is refused; a stored long line is reported as truncated', () => {
  assert.throws(() => RD.normalise({ skill: 'Long skill', avg_fte: 1, start_month: '2030-01', finish_month: '2039-12' }), (e) => e.reason === 'DEMAND_WINDOW' && e.status === 400);
  assert.equal(RD.normalise({ skill: 'Long skill', avg_fte: 1, start_month: '2030-01', finish_month: '2034-12' }).finish_month, '2034-12', 'exactly 60 months is fine');
  const load = RD.monthlyLoad([{ id: 7, project_id: 1, skill: 'Long skill', avg_fte: 1, start_month: '2030-01', finish_month: '2039-12' }]);
  assert.deepEqual(load.truncated, [{ id: 7, project_id: 1, skill: 'Long skill', months_placed: 60, months_requested: 120 }]);
  assert.deepEqual(RD.monthlyLoad([{ project_id: 1, skill: 'x', avg_fte: 1, start_month: '2030-01', finish_month: '2030-02' }]).truncated, []);
});

test('P11 N-R5-4 — a predecessor the reader cannot read is served with neither name nor id', () => {
  const byId = new Map([[1, { id: 1, key: 'K1', name: 'One' }]]);
  const hidden = SD.view({ id: 5, project_id: 1, predecessor_project_id: 42, status: 'open' }, { byId });
  assert.equal(hidden.predecessor_project_id, null); assert.equal(hidden.predecessor_label, null); assert.equal(hidden.predecessor_readable, false);
  const seen = SD.view({ id: 6, project_id: 1, predecessor_project_id: 1, status: 'open' }, { byId });
  assert.equal(seen.predecessor_project_id, 1); assert.equal(seen.predecessor_readable, true);
});
