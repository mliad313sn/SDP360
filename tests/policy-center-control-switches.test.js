'use strict';
// P11 round 5, R5-A2: with the Policy Center on, ONE super_admin could switch off ppm_field_audit_enabled (the field-level
// audit trail of projects), edit, and switch it back on, with no second person. Every switch whose ON state ADDS an audit
// trail or NARROWS a write / read (a control) must be four-eyes with strict_value '1': turning it on stays immediate,
// turning it off needs a second super_admin.
const { test } = require('node:test');
const assert = require('node:assert');
const PC = require('../services/policyCatalogue');
const AS = require('../tools/ops/activate-switches');

// ON = audit trail or control. Each one: switching OFF lifts that trail or control.
const CONTROLS = [
  'ppm_field_audit_enabled',            // one ppm_events row per changed project field
  'ppm_business_case_freeze_enabled',   // post-approval budget freeze (role-conflict control)
  'ppm_dq_gate_enforced',               // data-quality gate before approval
  'ppm_review_workflow_enabled',        // review workflow (self-approval refused)
  'ppm_timesheet_approval_enabled',     // hours approved by another person
  'insp_action_verify_enabled',         // independent verification of closed Critical/High actions
  'decision_lifecycle_enforced',        // illegal decision status jumps refused
  'decision_motive_required',           // a motive on every decision move
  'site_code_shared_block',             // saves under a shared site code refused
  'never_send_unconfirmed',             // never mail an unconfirmed address
  'wan_sla_require_contract_evidence',  // no credit amount without contract evidence
  'soft_delete_two_person',
];

test('every audit / control switch is four-eyes (strict side = 1, or fail closed)', () => {
  const by = PC.build({ fresh: true }).by;
  const bad = [];
  for (const k of CONTROLS) {
    const e = by.get(k);
    if (!e) { bad.push(`${k}: not catalogued`); continue; }
    // strict_value '1' (switching on stays immediate) or none at all (fail closed: every change needs a second person)
    if (!e.four_eyes || (e.strict_value !== '1' && e.strict_value !== null)) bad.push(`${k}: four_eyes=${e.four_eyes} strict_value=${e.strict_value}`);
  }
  assert.deepStrictEqual(bad, []);
});

test('switching a control OFF needs a second super_admin; switching it ON stays immediate', () => {
  const by = PC.build({ fresh: true }).by;
  for (const k of CONTROLS) {
    assert.strictEqual(PC.needsSecondPerson(by.get(k), '1', '0'), true, `${k} 1→0`);
    if (by.get(k).strict_value === '1') assert.strictEqual(PC.needsSecondPerson(by.get(k), '0', '1'), false, `${k} 0→1`);
  }
});

test('every boolean switch the activation tool classes as NARROWING access is four-eyes (cross-check)', () => {
  const by = PC.build({ fresh: true }).by;
  const bad = [];
  for (const [k, [dir]] of Object.entries(AS.ACCESS)) {
    if (dir !== 'narrows') continue;
    const e = by.get(k);
    if (!e) { bad.push(`${k}: not catalogued`); continue; }
    if (!e.four_eyes) bad.push(`${k}: not four-eyes`);
    else if (e.strict_value == null && !e.strict_direction) continue; // fail-closed: every change needs a second person
    else if (e.strict_value != null && PC.needsSecondPerson(e, e.strict_value, String(e.default)) === false && String(e.default) !== e.strict_value) bad.push(`${k}: back to the default is immediate`);
  }
  assert.deepStrictEqual(bad, []);
});
