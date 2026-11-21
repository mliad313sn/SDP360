'use strict';
// P11 round 9 (fix 37) — pure regression pins, fictitious data only. AI-written, not a human review.
//   R9-1  a RAID update merges onto the stored entry: absent / null keeps the stored value, '' or clear_score clears;
//         the shipped form pre-fills an edited entry and sends only the fields the user changed.
//   R9-3  the project card says when its "high" count is a lower bound (open entries without a score).
//   R9-4  the project card carries the risk component's "partial" flag and the page renders a marker.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { mergeRaidBody } = require('../services/ppm/governanceW3Store');
const RAID = require('../services/ppm/raid');
const KPI = require('../services/ppm/projectKpis');
const RAG = require('../services/ppm/projectRag');
const Form = require('../public/lib/ppmRaidForm');

const stored = { kind: 'risk', title: 'critical vendor', probability: 3, impact: 3, owner: 'alice', status: 'open', mitigation: 'second supplier' };
const storedD = { response: 'mitigate', review_date: '2026-12-01', probability_pct: '50', impact_amount: null, impact_currency: null, dependency_ref: null };

test('R9-1 — a form-shaped update (every key, empty inputs = null) keeps the stored score and fields', () => {
  const body = { id: 7, kind: 'risk', title: 'critical vendor', probability: null, impact: null, owner: 'bob', status: 'open', response: null, review_date: null, probability_pct: null, dependency_ref: null, mitigation: null };
  const n = RAID.normalise(mergeRaidBody(body, stored, storedD));
  assert.deepStrictEqual({ p: n.row.probability, i: n.row.impact, o: n.row.owner, m: n.row.mitigation }, { p: 3, i: 3, o: 'bob', m: 'second supplier' });
  assert.deepStrictEqual({ r: n.details.response, d: n.details.review_date, pct: n.details.probability_pct }, { r: 'mitigate', d: '2026-12-01', pct: 50 });
});

test('R9-1 — only an explicit clear resets: "" per field, or clear_score for the pair', () => {
  let n = RAID.normalise(mergeRaidBody({ id: 7, probability: '', impact: '' }, stored, storedD));
  assert.deepStrictEqual([n.row.probability, n.row.impact], [null, null]);
  n = RAID.normalise(mergeRaidBody({ id: 7, clear_score: true }, stored, storedD));
  assert.deepStrictEqual([n.row.probability, n.row.impact], [null, null]);
  n = RAID.normalise(mergeRaidBody({ id: 7, owner: '' }, stored, storedD));
  assert.strictEqual(n.row.owner, null, 'an emptied owner is cleared');
  assert.deepStrictEqual([n.row.probability, n.row.impact], [3, 3]);
  n = RAID.normalise(mergeRaidBody({ id: 7, probability: 1 }, stored, storedD));
  assert.deepStrictEqual([n.row.probability, n.row.impact], [1, 3]);
});

test('R9-1 — a legacy stored status / kind outside the vocabulary is not carried into the writer', () => {
  const n = RAID.normalise(mergeRaidBody({ id: 7, title: 'x legacy' }, { ...stored, status: 'mitigated', kind: 'Threat' }, null));
  assert.deepStrictEqual([n.row.status, n.row.kind], ['open', 'risk']);
});

test('R9-1 — the form helper: create sends null for empty, edit sends only changed fields and "" for an emptied one', () => {
  const create = Form.buildBody({ kind: 'risk', title: 'new one', probability: '', impact: '', status: '' }, null, false);
  assert.strictEqual(create.probability, null); assert.strictEqual(create.impact, null); assert.strictEqual(create.status, 'open');
  const item = { id: 7, kind: 'risk', title: 'critical vendor', probability: 3, impact: 3, owner: 'alice', status: 'open', mitigation: 'm', response: null, review_date: null, probability_pct: null, dependency_ref: null };
  const orig = Form.prefill(item, false);
  assert.strictEqual(orig.probability, '3');
  const values = { ...orig, owner: 'bob' };
  assert.deepStrictEqual(Form.buildBody(values, orig, false), { owner: 'bob' }, 'only the owner travels');
  assert.deepStrictEqual(Form.buildBody({ ...orig, probability: '', impact: '' }, orig, false), { probability: '', impact: '' }, 'emptied = explicit clear');
  const money = Form.prefill({ ...item, impact_amount: 5000, impact_currency: 'USD' }, true);
  assert.deepStrictEqual(Form.buildBody({ ...money, impact_amount: '6000' }, money, true), { impact_amount: '6000' });
});

test('R9-1 — the shipped page uses the helper and pre-fills (no full-body null form any more)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'lib', 'ppmGovernanceW3.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /PpmRaidForm\.buildBody\(/);
  assert.match(src, /PpmRaidForm\.prefill\(/);
  assert.match(src, /data-raid-edit=/);
  assert.ok(!/probability: v\('w3-r-p'\)/.test(src), 'the old always-null body is gone');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'project.html'), 'utf8');
  assert.ok(html.indexOf('src="lib/ppmRaidForm.js"') > -1 && html.indexOf('src="lib/ppmRaidForm.js"') < html.indexOf('src="lib/ppmGovernanceW3.js"'));
});

const base = { project: { stage: 'in_progress' }, tasks: [], milestones: [], schedule: null, evm: null, gates: null, today: '2026-11-21' };
test('R9-3 — "high" is a lower bound when an open entry has no score', () => {
  const s = KPI.projectSummary({ ...base, rag: null, risks: [{ id: 1, kind: 'issue', status: 'open', title: 'u', probability: null, impact: null }] });
  assert.deepStrictEqual({ a: s.cards.active_risks, h: s.cards.high_risks, u: s.cards.unscored_risks, p: s.cards.high_risks_partial }, { a: 1, h: 0, u: 1, p: true });
  const k = KPI.projectSummary({ ...base, rag: null, risks: [{ id: 1, kind: 'risk', status: 'open', title: 'k', probability: 3, impact: 3 }] });
  assert.deepStrictEqual({ h: k.cards.high_risks, u: k.cards.unscored_risks, p: k.cards.high_risks_partial }, { h: 1, u: 0, p: false });
});

test('R9-4 — the card carries rag_partial and the page renders a partial marker', () => {
  const rag = { rag: 'amber', components: { risk: { rag: 'amber', partial: true } } };
  assert.strictEqual(KPI.projectSummary({ ...base, rag, risks: [] }).cards.rag_partial, true);
  assert.strictEqual(KPI.projectSummary({ ...base, rag: { rag: 'red', components: { risk: { partial: false } } }, risks: [] }).cards.rag_partial, false);
  assert.strictEqual(KPI.projectSummary({ ...base, rag: null, risks: [] }).cards.rag_partial, false);
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'lib', 'ppmGovernanceW3.js'), 'utf8');
  assert.match(src, /c\.rag_partial \?/);
  assert.match(src, /c\.high_risks_partial \?/);
  const fr = fs.readFileSync(path.join(__dirname, '..', 'public', 'lib', 'i18n', 'project.fr.js'), 'utf8');
  for (const k of ['partial — some open risks have no score', 'unscored — the high count is a lower bound']) { assert.ok(src.includes(k)); assert.ok(fr.includes(`'${k}'`), k); }
  void RAG;
});
