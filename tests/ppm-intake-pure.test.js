'use strict';
// PORTFOLIO LOT 1 — pure rules of the intake fields (services/ppm/intakeFields.js) and of the reference lists
// (services/ppm/portfolioLookups.js): validation, the five value states, warnings, read shape, guidance FR coverage.
const { test } = require('node:test');
const assert = require('node:assert');
const IF = require('../services/ppm/intakeFields');
const LK = require('../services/ppm/portfolioLookups');

const codes = {
  project_type: new Set(['infrastructure', 'other']), priority: new Set(['critical', 'high', 'medium', 'low']), schedule_confidence: new Set(['low', 'medium', 'high']),
  budget_status: new Set(['approved', 'requested', 'not_budgeted', 'tbc']), decision_required: new Set(['yes', 'no', 'tbc']), delivery_effort: new Set(['small', 'large']), risk_exposure: new Set(['high', 'low']),
};
const reason = (fn) => { try { fn(); } catch (e) { return e.reason; } return null; };

test('list fields: active codes only on change; a retired code already stored stays', () => {
  assert.deepStrictEqual(IF.normaliseIntake({ priority: 'high', project_type: ' infrastructure ' }, null, codes), { priority: 'high', project_type: 'infrastructure' });
  assert.strictEqual(reason(() => IF.normaliseIntake({ priority: 'urgent' }, null, codes)), 'LOOKUP_VALUE');
  // stored 'legacy_type' (retired since): re-sending it unchanged is accepted, changing to another unknown is not
  assert.deepStrictEqual(IF.normaliseIntake({ project_type: 'legacy_type' }, { project_type: 'legacy_type' }, codes), { project_type: 'legacy_type' });
  assert.strictEqual(reason(() => IF.normaliseIntake({ project_type: 'nope' }, { project_type: 'legacy_type' }, codes)), 'LOOKUP_VALUE');
  assert.deepStrictEqual(IF.normaliseIntake({ priority: '' }, null, codes), { priority: null }, 'blank = cleared (unknown), never a default');
});

test('quarter, dates, FTE, tags, business need: shape checks; quarters never in date fields', () => {
  assert.strictEqual(IF.normaliseIntake({ indicative_quarter: '2027-q2' }, null, codes).indicative_quarter, '2027-Q2');
  assert.strictEqual(reason(() => IF.normaliseIntake({ indicative_quarter: 'Q2' }, null, codes)), 'QUARTER_INVALID');
  assert.strictEqual(reason(() => IF.normaliseIntake({ budget_approval_date: '2027-02-30' }, null, codes)), 'DATE_INVALID');
  assert.strictEqual(reason(() => IF.normaliseIntake({ budget_approval_date: 'TBC' }, null, codes)), 'DATE_INVALID');
  assert.deepStrictEqual(IF.normaliseIntake({ avg_fte: '0.5', peak_fte: 1.234 }, null, codes), { avg_fte: 0.5, peak_fte: 1.23 });
  assert.strictEqual(IF.normaliseIntake({ avg_fte: 0 }, null, codes).avg_fte, 0, 'zero is a measured value');
  assert.strictEqual(reason(() => IF.normaliseIntake({ avg_fte: 'medium' }, null, codes)), 'FTE_INVALID', 'categorical text never goes in a numeric FTE');
  assert.strictEqual(reason(() => IF.normaliseIntake({ avg_fte: 2, peak_fte: 1 }, null, codes)), 'FTE_PEAK_BELOW_AVERAGE');
  assert.strictEqual(reason(() => IF.normaliseIntake({ peak_fte: 1 }, { avg_fte: '2', peak_fte: null }, codes)), 'FTE_PEAK_BELOW_AVERAGE', 'checked against the stored average');
  assert.strictEqual(IF.normaliseIntake({ tags: 'ot, cyber ,ot,' }, null, codes).tags, JSON.stringify(['ot', 'cyber']));
  assert.strictEqual(IF.normaliseIntake({ tags: [] }, null, codes).tags, null);
  const bn = JSON.parse(IF.normaliseIntake({ business_need: { problem: 'single WAN link', impact: ' outages ', bogus: 'x' } }, null, codes).business_need);
  assert.deepStrictEqual(bn, { impact: 'outages', problem: 'single WAN link' });
  assert.strictEqual(reason(() => IF.normaliseIntake({ business_need: 'free text' }, null, codes)), 'BUSINESS_NEED_INVALID');
});

test('value states: blank ≠ zero ≠ tbc ≠ na ≠ none_known; a state only on an empty field; a value clears it', () => {
  const vs = (o) => JSON.parse(o.value_states);
  assert.deepStrictEqual(vs(IF.normaliseIntake({ value_states: { avg_fte: 'tbc', expected_value: 'na', risks: 'none_known' } }, null, codes)), { avg_fte: 'tbc', expected_value: 'na', risks: 'none_known' });
  assert.strictEqual(reason(() => IF.normaliseIntake({ avg_fte: 0, value_states: { avg_fte: 'tbc' } }, null, codes)), 'VALUE_STATE_CONFLICT', 'zero is a value, not TBC');
  assert.strictEqual(reason(() => IF.normaliseIntake({ value_states: { budget: 'tbc' } }, { budget: '0' }, codes)), 'VALUE_STATE_CONFLICT', 'stored zero budget is a value');
  assert.strictEqual(reason(() => IF.normaliseIntake({ value_states: { risks: 'tbc' } }, null, codes)), 'VALUE_STATE_INVALID');
  assert.strictEqual(reason(() => IF.normaliseIntake({ value_states: { avg_fte: 'none_known' } }, null, codes)), 'VALUE_STATE_INVALID');
  assert.strictEqual(reason(() => IF.normaliseIntake({ value_states: { budget_status: 'tbc' } }, null, codes)), 'VALUE_STATE_FIELD', 'budget status has its own TBC code');
  assert.strictEqual(reason(() => IF.normaliseIntake({ value_states: { avg_fte: 'maybe' } }, null, codes)), 'VALUE_STATE_INVALID');
  // a value sent later clears the state; removing a state with null
  const before = { value_states: JSON.stringify({ avg_fte: 'tbc', expected_value: 'na' }) };
  assert.deepStrictEqual(vs(IF.normaliseIntake({ avg_fte: 0.4 }, before, codes)), { expected_value: 'na' });
  assert.strictEqual(IF.normaliseIntake({ value_states: { avg_fte: null, expected_value: null } }, before, codes).value_states, null);
  assert.ok(!('value_states' in IF.normaliseIntake({ priority: 'low' }, before, codes)), 'untouched map is not rewritten');
});

test('aliases: business_sponsor / it_owner map onto sponsor / owner; project_ref is never client-written', () => {
  assert.deepStrictEqual(IF.aliases({ business_sponsor: 'GM', it_owner: 'Site IT', project_ref: 'PRJ-1999-001' }), { sponsor: 'GM', owner: 'Site IT' });
  assert.deepStrictEqual(IF.aliases({ business_sponsor: 'GM', sponsor: 'Real' }), { sponsor: 'Real' });
  assert.ok(!IF.WRITABLE.includes('project_ref'));
});

test('warnings: same person in the three roles / two roles; zero budget not "not budgeted" (never a refusal)', () => {
  assert.deepStrictEqual(IF.intakeWarnings({ sponsor: 'Ana', owner: ' ana ', delivery_lead: 'ANA' }).map((w) => w.code), ['ROLES_SAME_PERSON']);
  assert.deepStrictEqual(IF.intakeWarnings({ sponsor: 'Ana', owner: 'Ana', delivery_lead: 'Bo' }).map((w) => w.code), ['ROLES_OVERLAP']);
  assert.deepStrictEqual(IF.intakeWarnings({ sponsor: 'Ana', owner: 'Bo', delivery_lead: null }), []);
  assert.deepStrictEqual(IF.intakeWarnings({ budget: 0, budget_status: 'approved' }).map((w) => w.code), ['BUDGET_ZERO']);
  assert.deepStrictEqual(IF.intakeWarnings({ budget: 0, budget_status: 'not_budgeted' }), []);
  assert.deepStrictEqual(IF.intakeWarnings({ budget: null, budget_status: 'approved' }), [], 'blank budget is unknown, not zero');
});

test('read shape: JSON parsed, FTE numbers, calendar duration = end − start + 1, null without valid dates', () => {
  const r = IF.readIntake({ tags: '["a"]', business_need: '{"problem":"p"}', value_states: null, avg_fte: '0.50', start_date: '2027-01-01', end_date: '2027-01-31' });
  assert.deepStrictEqual(r.tags, ['a']); assert.deepStrictEqual(r.business_need, { problem: 'p' }); assert.deepStrictEqual(r.value_states, {});
  assert.strictEqual(r.avg_fte, 0.5); assert.strictEqual(r.peak_fte, null); assert.strictEqual(r.planned_duration_days, 31);
  assert.strictEqual(IF.readIntake({ start_date: '2027-01-01', end_date: '2027-01-01' }).planned_duration_days, 1);
  assert.strictEqual(IF.readIntake({ start_date: '2027-01-01', end_date: null }).planned_duration_days, null);
});

test('guidance: every field has EN + FR texts (label, description, why, example, mistake) and a level', () => {
  for (const f of IF.GUIDE) {
    assert.ok(['required', 'recommended', 'automatic'].includes(f.level), f.key);
    assert.ok(IF.SECTIONS.includes(f.section), f.key);
    for (const l of ['en', 'fr']) for (const k of ['label', 'description', 'why', 'example', 'mistake']) assert.ok(f[l][k] && f[l][k].trim(), `${f.key}.${l}.${k}`);
  }
  for (const c of IF.WRITABLE.filter((c) => c !== 'value_states')) assert.ok(IF.GUIDE.some((f) => f.key === c), `guidance for ${c}`);
});

test('reference lists: create needs code + EN/FR labels; code immutable; locked lists take no new code; colours are tokens', () => {
  assert.deepStrictEqual(LK.validateValue('project_type', { code: 'ot', label_en: 'OT', label_fr: 'OT', color: 'teal', sort_order: 5 }), { code: 'ot', label_en: 'OT', label_fr: 'OT', color: 'teal', sort_order: 5 });
  assert.strictEqual(reason(() => LK.validateValue('project_type', { code: 'Bad Code', label_en: 'x', label_fr: 'x' })), 'LOOKUP_CODE');
  assert.strictEqual(reason(() => LK.validateValue('project_type', { code: 'ot', label_en: 'OT' })), 'LOOKUP_LABEL');
  assert.strictEqual(reason(() => LK.validateValue('project_status', { code: 'archived', label_en: 'A', label_fr: 'A' })), 'LOOKUP_LOCKED');
  assert.deepStrictEqual(LK.validateValue('project_status', { code: 'done', label_en: 'Delivered' }, { code: 'done' }), { label_en: 'Delivered' }, 'a locked list is relabelled');
  assert.strictEqual(reason(() => LK.validateValue('priority', { code: 'other' }, { code: 'high' })), 'LOOKUP_CODE_IMMUTABLE');
  assert.strictEqual(reason(() => LK.validateValue('priority', { code: 'x', label_en: 'X', label_fr: 'X', color: '#ff0000' })), 'LOOKUP_COLOR');
  assert.strictEqual(reason(() => LK.validateValue('nope', {})), 'LOOKUP_DOMAIN');
});

test('P11 R4-2 — readIntake drops a value state whose field holds a value (written while the register was off)', () => {
  const r = IF.readIntake({ budget: 5000, delivery_lead: null, sponsor: '  ', value_states: '{"budget":"tbc","delivery_lead":"tbc","sponsor":"na","risks":"none_known"}' });
  assert.deepStrictEqual(r.value_states, { delivery_lead: 'tbc', sponsor: 'na', risks: 'none_known' });
  assert.deepStrictEqual(IF.readIntake({ budget: 0, value_states: '{"budget":"tbc"}' }).value_states, {}, 'a measured zero answers too');
  assert.deepStrictEqual(IF.readIntake({ value_states: '[1]' }).value_states, {});
});
