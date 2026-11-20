'use strict';
// N-R5-1 (P11 round 5) — every report_config writer goes through services/fourEyesGuard (static), and the guard itself
// refuses a four-eyes change that needs a second person while the Policy Center is on (unit).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const FE = require('../services/fourEyesGuard');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
const DIRECT = /(^|[^A-Za-z_])setConfig\(/;   // a call of reportConfig.setConfig, not guardedSetConfig(
const callers = (files) => files.filter((f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n').split('\n').some((l) => DIRECT.test(l) && !/^\s*(\/\/|\*)/.test(l))).map(rel).sort();

// The ONLY server-side callers allowed to write report_config without the guard.
const SERVER_ALLOWED = [
  'routes/policyCenter.js',      // the four-eyes request flow itself (applies an approved request / a strict move)
  'services/fourEyesGuard.js',   // the guarded writer
  'services/reportConfig.js',    // the store
];
// Operator CLIs (run on the server with database credentials, never reachable over HTTP). Listed so that a new one is
// noticed and reviewed; PROPOSED: route the ones that may write four-eyes keys through the guard too.
const TOOLS_KNOWN = [
  'tools/governance/apply-values.js',
  'tools/meraki/check-timeup-calibration.js',
  'tools/meraki/poll-wan-outages.js',
  'tools/ops/activate-switches.js',
  'tools/reports/set-ui-policy.js',
  'tools/teams/poll-sla.js',
];

test('every route / service writes report_config through the four-eyes guard (no new bypass door)', () => {
  const files = [...walk(path.join(ROOT, 'routes')), ...walk(path.join(ROOT, 'services')), path.join(ROOT, 'server.js')];
  const found = callers(files);
  assert.deepStrictEqual(found, SERVER_ALLOWED, 'direct reportConfig.setConfig callers changed — use services/fourEyesGuard.guardedSetConfig');
});

test('operator CLIs that write report_config are a known list', () => {
  assert.deepStrictEqual(callers(walk(path.join(ROOT, 'tools'))), TOOLS_KNOWN);
});

test('the routes that used to write config directly now use guardedSetConfig', () => {
  for (const f of ['routes/teamsSla.js', 'routes/adminConfig.js', 'routes/policies.js', 'routes/trackers.js', 'routes/opmanager.js', 'routes/assets.js', 'routes/governanceWorkbench.js']) {
    assert.match(fs.readFileSync(path.join(ROOT, f), 'utf8'), /guardedSetConfig\(/, f);
  }
});

test('blockedKeys: center off → nothing; on → a weakening four-eyes change is blocked, a strict move passes', () => {
  assert.deepStrictEqual(FE.blockedKeys({ policy_center_enabled: '0', teams_sla_enabled: '0' }, { teams_sla_enabled: '1' }), []);
  const on = { policy_center_enabled: '1', teams_sla_enabled: '0', dashkey_scope_mode: 'open' };
  assert.deepStrictEqual(FE.blockedKeys(on, { teams_sla_enabled: '1' }), ['teams_sla_enabled'], 'arming an outbound switch alone');
  assert.deepStrictEqual(FE.blockedKeys(on, { teams_sla_enabled: true }), ['teams_sla_enabled'], 'boolean form too');
  assert.deepStrictEqual(FE.blockedKeys({ ...on, teams_sla_enabled: '1' }, { teams_sla_enabled: '0' }), [], 'disarming = towards strict, immediate');
  assert.deepStrictEqual(FE.blockedKeys(on, { teams_sla_enabled: '0', sdp_api_base_url: 'https://x' }), [], 'unchanged + non-four-eyes');
  assert.deepStrictEqual(FE.blockedKeys(on, { dashkey_scope_mode: 'restrict' }), [], 'hardening passes');
  assert.deepStrictEqual(FE.blockedKeys(on, { dashkey_scope_mode: 'restrict' }, { anyChange: true }), ['dashkey_scope_mode'], 'legacy generic PUT: any change');
  const e = FE.refusal(['teams_sla_enabled']);
  assert.strictEqual(e.status, 409); assert.strictEqual(e.code, 'CONFLICT'); assert.match(e.message, /policy-center/);
});
