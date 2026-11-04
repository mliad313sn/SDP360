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
