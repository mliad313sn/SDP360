'use strict';
const test = require('node:test');
const assert = require('node:assert');
const A = require('../services/siteReportAdapters');

test('adaptMeetingsSummary maps the real kpi keys to the contract', () => {
  const real = {
    site_code: 'HGO', month_label: 'July 2026', available: true,
    kpis: { pvs_held: 2, dept_target: 3, open_issues: 4, high_open: 1,
            resolved_month: 6, new_month: 3, escalations_open: 1,
            signoff_pct: 80, overdue_actions_count: 2 },
    departments: [{ department: 'hse', status: 'on_track' }],
  };
  const r = A.adaptMeetingsSummary(real);
  assert.strictEqual(r.kpis.pvs_target, 3);        // ← dept_target
  assert.strictEqual(r.kpis.resolved, 6);          // ← resolved_month
  assert.strictEqual(r.kpis.new, 3);               // ← new_month
  assert.strictEqual(r.kpis.escalations, 1);       // ← escalations_open
  assert.strictEqual(r.kpis.signoff_pct, 80);
  assert.strictEqual(r.kpis.overdue_actions_count, 2);
  assert.strictEqual(r.site_name, 'HGO');          // no site_name in source → code
});

test('adaptMeetingsSummary tolerates the unavailable shape', () => {
  const r = A.adaptMeetingsSummary({ available: false, kpis: {}, departments: [] });
  assert.strictEqual(r.kpis.pvs_target, 0);
  assert.deepStrictEqual(r.departments, []);
});

test('adaptMeetingsActions maps owner_it → owner', () => {
  const r = A.adaptMeetingsActions([{ description: 'Fix', owner_it: 'Jean', target_date: '2026-07-20' }]);
  assert.deepStrictEqual(r, [{ description: 'Fix', owner: 'Jean', target_date: '2026-07-20' }]);
});

test('adaptInspectionAggregate lifts counts.* and derives findings_critical_major', () => {
  const real = { counts: { total: 2, critical_count: 1 }, findingStatus: [{ status: 'critical', n: 1 }, { status: 'major', n: 3 }, { status: 'ok', n: 9 }], open_actions: 4, overdue_actions: 2, monthly: [] };
  const r = A.adaptInspectionAggregate(real);
  assert.strictEqual(r.inspections_done, 2);
  assert.strictEqual(r.findings_critical_major, 4);   // critical 1 + major 3
  assert.strictEqual(r.overall_risk, 'critical');     // worst present
});

test('adaptInspectionAggregate with no findings → 0 / low', () => {
  const r = A.adaptInspectionAggregate({ counts: { total: 1 }, findingStatus: [{ status: 'ok', n: 5 }] });
  assert.strictEqual(r.findings_critical_major, 0);
  assert.strictEqual(r.overall_risk, 'low');
});

// 'low' is NOT in the finding-status vocabulary (inspection-init.json:
// ok · minor · major · critical · opp · na), so _RISK_ORDER.find() can never
// return it — every 'low' came from the fallback. On a site with ZERO
// inspections that fallback printed a GREEN "Overall risk: low" over nothing
// measured. No inspections → no verdict.
test('adaptInspectionAggregate with ZERO inspections → overall_risk null, never "low"', () => {
  const r = A.adaptInspectionAggregate({ counts: { total: 0 }, findingStatus: [] });
  assert.strictEqual(r.inspections_done, 0);
  assert.strictEqual(r.overall_risk, null, 'no inspection was run — there is no risk verdict to state');
});

test('adaptInspectionAggregate on junk → null risk (a failed read is not "low")', () => {
  assert.strictEqual(A.adaptInspectionAggregate(null).overall_risk, null);
  assert.strictEqual(A.adaptInspectionAggregate({}).overall_risk, null);
});

// The other half of the rule: inspections DID run and turned up nothing
// serious — that is a real measurement and 'low' is legitimate.
test('adaptInspectionAggregate with inspections but no findings keeps "low"', () => {
  const r = A.adaptInspectionAggregate({ counts: { total: 3 }, findingStatus: [{ status: 'ok', n: 5 }] });
  assert.strictEqual(r.overall_risk, 'low');
});

test('adaptInspectionAggregate on junk → zeros, never throws', () => {
  const r = A.adaptInspectionAggregate(null);
  assert.strictEqual(r.inspections_done, 0);
  assert.strictEqual(r.findings_critical_major, 0);
});
