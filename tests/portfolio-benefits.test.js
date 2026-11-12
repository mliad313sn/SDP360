'use strict';
// B-08 — benefit record on a portfolio project (catalogue A09): the pure rules (state, review due, money read rule,
// evidence link) and the obligation lines they feed. Fictitious data only.
const test = require('node:test');
const assert = require('node:assert');
const B = require('../services/portfolioBenefits');
const { compose } = require('../services/obligations');
const { buildMyWork } = require('../services/myWork');

const base = { id: 7, project_id: 3, project_key: 'NET-1', project_name: 'Second WAN link', description: 'Fewer site outages', owner: 'Site GM', value_kind: 'quantity', baseline_value: 12, target_value: 4, realised_value: null, review_date: '2027-06-30', verified_at: null };

test('state: planned before the review date, review_due after it, awaiting verification with a value, verified last', () => {
  assert.equal(B.benefitState(base, '2027-06-29'), 'planned');
  assert.equal(B.benefitState(base, '2027-06-30'), 'review_due', 'the review date itself counts');
  assert.equal(B.benefitState({ ...base, realised_value: 5 }, '2027-07-15'), 'awaiting_verification');
  assert.equal(B.benefitState({ ...base, realised_value: 0 }, '2027-07-15'), 'awaiting_verification', 'a measured zero is a value');
  assert.equal(B.benefitState({ ...base, realised_value: 5, verified_at: '2027-07-20' }, '2027-07-25'), 'verified');
  assert.equal(B.benefitState({ ...base, review_date: null }, '2030-01-01'), 'planned', 'no review date → never due');
});

test('review due: from the review date until verified, value or not', () => {
  assert.equal(B.isReviewDue(base, '2027-06-29'), false);
  assert.equal(B.isReviewDue(base, '2027-07-01'), true);
  assert.equal(B.isReviewDue({ ...base, realised_value: 5 }, '2027-07-01'), true, 'entered but not verified is still due');
  assert.equal(B.isReviewDue({ ...base, realised_value: 5, verified_at: '2027-07-02' }, '2027-07-03'), false);
});

test('money read rule: a money benefit loses its values for a non-money reader, keeps description, dates and state', () => {
  const m = { ...base, value_kind: 'money', currency: 'USD', baseline_value: 100000, target_value: 40000, realised_value: 55000 };
  const hidden = B.visibleBenefit(m, { money: false, asOf: '2027-07-01' });
  for (const f of B.VALUE_FIELDS) assert.equal(hidden[f], undefined, f);
  assert.equal(hidden.values_hidden, true);
  assert.equal(hidden.description, 'Fewer site outages'); assert.equal(hidden.state, 'awaiting_verification');
  assert.equal(JSON.stringify(hidden).includes('55000'), false);
  assert.equal(B.visibleBenefit(m, { money: true }).realised_value, 55000);
  assert.equal(B.visibleBenefit(base, { money: false }).target_value, 4, 'a quantity is never hidden');
});

test('evidence link: http(s) only — never javascript:, data:, a bare path or an empty value', () => {
  assert.equal(B.evidenceLinkOk('https://intranet.example/kpi/123'), true);
  assert.equal(B.evidenceLinkOk('http://share.example/a.pdf'), true);
  for (const bad of ['', null, 'javascript:alert(1)', 'data:text/html,x', '/files/a.pdf', 'https://x.example/a b', 'https://x"onmouseover=1', 'x'.repeat(2000)]) assert.equal(B.evidenceLinkOk(bad), false, String(bad).slice(0, 30));
});

test('reviewItems: one obligation line per due benefit, status says what is missing, no value in the line', () => {
  const rows = [base, { ...base, id: 8, realised_value: 99, review_date: '2027-07-01' }, { ...base, id: 9, review_date: '2027-08-01' }, { ...base, id: 10, realised_value: 1, verified_at: '2027-07-01' }];
  const items = B.reviewItems(rows, '2027-07-01');
  assert.deepEqual(items.map((x) => [x.id, x.status, x.overdue]), [[7, 'missing', true], [8, 'awaiting_verification', false]]);
  assert.equal(items[0].register, 'benefit_review'); assert.equal(items[0].link, 'project.html?id=3#benefits'); assert.equal(items[0].ref, 'NET-1');
  assert.ok(!JSON.stringify(items).includes('99'), 'no value travels in the feed');
});

test('obligations compose: benefit lines join the site feed; not read = null, never "nothing due"', () => {
  const c = compose({ benefitReviews: [base], asOf: '2027-07-05' });
  assert.equal(c.totals.open, 1); assert.equal(c.totals.by_register.benefit_review.overdue, 1);
  assert.equal(c.registers.benefit_reviews, 'read');
  assert.equal(compose({ asOf: '2027-07-05' }).registers.benefit_reviews, null);
});

test('My work: a benefit_reviews block per site; a reader that throws → null (not measured)', async () => {
  const w = await buildMyWork({ sites: [{ site_id: 1, code: 'HGO', name: 'Hounde' }], asOf: '2027-07-05', readers: { benefitReviews: async () => [base] } });
  assert.deepEqual(w.sites[0].benefit_reviews, { count: 1, items: [{ project_id: 3, project_key: 'NET-1', title: 'Benefit review: Fewer site outages (Second WAN link)', due_date: '2027-06-30', status: 'missing', overdue: true }] });
  const z = await buildMyWork({ sites: [{ site_id: 1 }], asOf: '2027-07-05', readers: { benefitReviews: async () => { throw new Error('down'); } } });
  assert.equal(z.sites[0].benefit_reviews, null);
});

// ── F-PRODUCT-03 + F-DATA-09 — value class, measurement basis, evidence level; totals never across classes ──────────
const real = { ...base, realised_value: 5, realised_by: 2, evidence_link: 'https://example.test/e', verified_at: null };
const verified = (o) => ({ ...real, verified_at: '2027-07-01T00:00:00Z', verified_by: 3, ...o });

test('evidence level: planned → entered → verified; a null class stays unclassified (no default class)', () => {
  assert.equal(B.evidenceLevel(base), 'planned');
  assert.equal(B.evidenceLevel(real), 'entered');
  assert.equal(B.evidenceLevel(verified()), 'verified');
  assert.strictEqual(B.measurementClass(real), null, 'no basis = no class');
  assert.strictEqual(B.classView(real).class_label, null);
  assert.strictEqual(B.classProblem(base), null, 'an unclassified benefit is valid');
});

test('measurement class: an estimate stays an estimate even verified; "validated" needs observed + evidence + an independent verification', () => {
  assert.equal(B.measurementClass({ ...real, basis: 'observed' }), 'observed');
  assert.equal(B.measurementClass(verified({ basis: 'observed' })), 'observed', 'verified by "someone else" with no required role is not validated');
  assert.equal(B.measurementClass(verified({ basis: 'observed', verifier_role_required: 'finance-viewer' })), 'validated');
  assert.equal(B.measurementClass(verified({ basis: 'observed', verifier_role_required: 'finance-viewer', evidence_link: null })), 'observed', 'no evidence link');
  assert.equal(B.measurementClass(verified({ basis: 'observed', verifier_role_required: 'finance-viewer', verified_by: 2 })), 'observed', 'verifier = entrant');
  assert.equal(B.measurementClass(verified({ basis: 'observed', verifier_role_required: 'finance-viewer', owner_user_id: 3 })), 'observed', 'verifier = linked owner');
  const est = verified({ basis: 'estimated_avoidance', value_class: 'cost_avoidance_estimate', verifier_role_required: 'finance-viewer' });
  assert.equal(B.measurementClass(est), 'estimated');
  assert.equal(B.classView(est).class_label, 'estimate'); assert.equal(B.classView(est).is_estimate, true);
  assert.equal(B.visibleBenefit(est, { classes: true }).class_label, 'estimate');
  assert.strictEqual(B.visibleBenefit(est, {}).class_label, undefined, 'switch off: no class view');
});

test('classProblem: unknown codes, a cost avoidance called observed, realised cash called an estimate, metric without key, inverted period, money without currency', () => {
  const code = (o) => (B.classProblem({ ...base, ...o }) || {}).code || null;
  assert.equal(code({ value_class: 'savings' }), 'VALUE_CLASS');
  assert.equal(code({ basis: 'guess' }), 'BASIS');
  assert.equal(code({ value_class: 'cost_avoidance_estimate', basis: 'observed' }), 'CLASS_BASIS');
  assert.equal(code({ value_class: 'realised_cash', basis: 'estimated_avoidance' }), 'CLASS_BASIS');
  assert.equal(code({ source_kind: 'metric' }), 'METRIC_KEY');
  assert.equal(code({ source_kind: 'manual', metric_key: 'x' }), 'METRIC_KEY');
  assert.equal(code({ measured_from: '2027-03-01', measured_to: '2027-02-01' }), 'PERIOD');
  assert.equal(code({ value_kind: 'money', basis: 'observed', currency: null }), 'CURRENCY_REQUIRED');
  assert.equal(code({ value_kind: 'money', basis: 'observed', currency: 'USD', value_class: 'realised_cash', source_kind: 'metric', metric_key: 'helpdesk.sla_res_pct', measured_from: '2027-01-01', measured_to: '2027-03-31' }), null);
  assert.equal(code({ value_kind: 'money', currency: null }), null, 'no basis: today\'s rule (see finance_currency_required)');
});

test('benefitTotals: an estimate is never added to an observed or validated value; currencies and units are never added; null is not 0', () => {
  const m = (o) => ({ ...base, value_kind: 'money', currency: 'USD', realised_by: 2, evidence_link: 'https://example.test/e', ...o });
  const rows = [
    m({ id: 1, basis: 'observed', value_class: 'realised_cash', realised_value: 100 }),
    m({ id: 2, basis: 'observed', value_class: 'realised_cash', realised_value: 50 }),
    m({ id: 3, basis: 'estimated_avoidance', value_class: 'cost_avoidance_estimate', realised_value: 1000 }),
    m({ id: 4, basis: 'observed', value_class: 'realised_cash', realised_value: 7, currency: 'XOF' }),
    m({ id: 5, basis: 'observed', value_class: 'realised_cash', realised_value: 30, verified_at: '2027-07-01', verified_by: 3, verifier_role_required: 'finance-viewer' }),
    m({ id: 6, realised_value: 9 }),
    m({ id: 7, basis: 'observed', value_class: 'realised_cash', realised_value: null }),
    { ...base, id: 8, unit: 'hours', basis: 'observed', value_class: 'productivity_time', realised_value: 12 },
    { ...m({ id: 9, basis: 'observed', value_class: 'realised_cash' }), realised_value: undefined, values_hidden: true },
  ];
  const t = B.benefitTotals(rows);
  const pick = (mc, vc, dim) => t.find((g) => g.measurement_class === mc && g.value_class === vc && (g.currency || g.unit || null) === dim);
  assert.equal(pick('observed', 'realised_cash', 'USD').realised_total, 150);
  assert.deepEqual([pick('observed', 'realised_cash', 'USD').benefits, pick('observed', 'realised_cash', 'USD').without_value, pick('observed', 'realised_cash', 'USD').hidden], [4, 1, 1]);
  assert.equal(pick('estimated', 'cost_avoidance_estimate', 'USD').realised_total, 1000);
  assert.equal(pick('estimated', 'cost_avoidance_estimate', 'USD').label, 'estimate');
  assert.equal(pick('observed', 'realised_cash', 'XOF').realised_total, 7);
  assert.equal(pick('validated', 'realised_cash', 'USD').realised_total, 30);
  assert.equal(pick('unclassified', 'unclassified', 'USD').realised_total, 9);
  assert.equal(pick('observed', 'productivity_time', 'hours').realised_total, 12);
  assert.ok(!t.some((g) => g.realised_total === 1150 || g.realised_total === 1180 || g.realised_total === 157), 'no cross-class or cross-currency sum');
  assert.equal(t[0].measurement_class, 'validated', 'validated first, then observed, estimated, unclassified');
  const none = B.benefitTotals([m({ id: 1, basis: 'observed', realised_value: null })]);
  assert.strictEqual(none[0].realised_total, null, 'nothing measured is null, never 0');
});
