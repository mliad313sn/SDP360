'use strict';
// D1 (P10) — the flag register is also machine-readable (FLAG-REGISTER.json); every DARK switch carries the decision
// fields from the hand-maintained sidecar docs/ops/flag-decisions.json; the report of what is still missing
// (FLAG-DECISIONS-GAPS.md) is CURRENT — this test never asserts that humans filled it; --stale reports passed expiries.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const FR = require('../tools/agent/flag-register');

const read = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');

test('FLAG-REGISTER.json and FLAG-DECISIONS-GAPS.md are up to date (node tools/agent/flag-register.js)', () => {
  assert.equal(read(FR.OUT_JSON), FR.buildJson());
  assert.equal(read(FR.OUT_GAPS), FR.buildGaps());
});

test('JSON covers every report_config key, policy and env variable; secrets carry no default', () => {
  const j = JSON.parse(read(FR.OUT_JSON));
  const { DEFAULTS, _SECRET_BLANK_KEEP } = require('../services/reportConfig');
  const keys = new Set(j.report_config.map((r) => r.key));
  for (const k of Object.keys(DEFAULTS)) assert.ok(keys.has(k), k);
  for (const k of _SECRET_BLANK_KEEP) { const r = j.report_config.find((x) => x.key === k); assert.strictEqual(r.default, null, k); assert.strictEqual(r.dark, false); }
  assert.ok(j.governance_policies.length >= 30);
  assert.ok(j.environment.some((e) => e.key === 'AI_PROVIDER'));
});

test('every dark switch is in the decisions list, including today\'s lots (P2..P8, D2, D3) and the pseudo-rows', () => {
  const j = JSON.parse(read(FR.OUT_JSON));
  const dark = new Set(j.dark.map((d) => d.key));
  const { DEFAULTS, _SECRET_BLANK_KEEP } = require('../services/reportConfig');
  for (const [k, v] of Object.entries(DEFAULTS)) if (v === '0' && !_SECRET_BLANK_KEEP.has(k)) assert.ok(dark.has(k), `${k} default '0' but not dark`);
  for (const k of [
    'finance_certification_enabled', 'actuals_import_enabled',                        // P2
    'sla_headline_definition',                                                         // P3 (word default)
    'connector_health_page_enabled', 'weekly_report_nudges_enabled',                  // P4
    'ui_home_queue', 'workspace_profiles_enabled', 'action_aging_reminders_enabled',  // P5
    'decision_motive_required', 'soft_delete_two_person', 'breakglass_timebox_enabled', // P6
    'ppm_timesheet_approval_enabled', 'ppm_cr_simulation_enabled', 'portfolio_sensitive_projects', 'roadmap_audience_publication_enabled', // P7
    'wan_sla_claims_enabled',                                                          // P8
    'value_scoreboard_enabled', 'exec_pack_portfolio_slide', 'exec_view_min_cell',    // D2 / D3
    'frozen:tracker_green_band_90', 'frozen:installer_safety_parity', 'sla_wan_config.notify.enabled',
  ]) assert.ok(dark.has(k), `${k} missing from the dark list`);
  const arm = j.pseudo.find((p) => p.key === 'sla_wan_config.notify.enabled');
  assert.strictEqual(arm.default, false, 'nested default read from the code');
});

test('decision fields come only from the sidecar: unknown stays null and is listed as missing', () => {
  const side = { items: { value_scoreboard_enabled: { owner: 'A. Person', risk: 'low', canary_site: '', expiry: 'to be decided' } } };
  const c = FR.collect({ sidecar: side });
  const d = c.dark.find((x) => x.key === 'value_scoreboard_enabled');
  assert.strictEqual(d.decision.owner, 'A. Person');
  assert.strictEqual(d.decision.canary_site, null, 'blank = not decided');
  assert.strictEqual(d.decision.expiry, null, '"to be decided" = not decided');
  assert.deepStrictEqual(d.missing, ['dependencies', 'canary_site', 'rollback_trigger', 'success_metric', 'decision_deadline', 'expiry']);
  const other = c.dark.find((x) => x.key === 'finance_certification_enabled');
  assert.deepStrictEqual(other.missing, FR.DECISION_FIELDS, 'no sidecar entry = every field missing, nothing invented');
});

test('the committed sidecar invents nothing: only known field names, and the gaps file says so', () => {
  const side = JSON.parse(read(FR.SIDECAR));
  for (const [k, v] of Object.entries(side.items)) for (const f of Object.keys(v)) assert.ok(FR.DECISION_FIELDS.includes(f) || f === 'note', `${k}.${f} is not a decision field`);
  assert.match(read(FR.OUT_GAPS), /The agent fills none of them/);
});

test('--stale lists passed expiries / deadlines and sidecar entries whose switch is gone', () => {
  const side = { items: {
    value_scoreboard_enabled: { expiry: '2026-01-31', decision_deadline: '2026-12-31' },
    ui_home_queue: { decision_deadline: '2026-02-01' },
    no_such_switch_anymore: { owner: 'x' },
  } };
  const r = FR.staleReport({ today: '2026-06-01', sidecar: side });
  assert.deepStrictEqual(r.expired, [{ key: 'value_scoreboard_enabled', expiry: '2026-01-31' }]);
  assert.deepStrictEqual(r.overdue, [{ key: 'ui_home_queue', decision_deadline: '2026-02-01' }]);
  assert.deepStrictEqual(r.dead, ['no_such_switch_anymore']);
  const clean = FR.staleReport({ today: '2026-06-01', sidecar: { items: {} } });
  assert.deepStrictEqual([clean.expired, clean.overdue, clean.dead], [[], [], []]);
});
