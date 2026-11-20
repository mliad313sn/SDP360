'use strict';
// N-R6-1 (P11 round 6, security seat) — a report_config switch round-trips canonically: whatever the client sends
// (JSON boolean, "true", "on", 1…), the value the four-eyes guard compared == the value setConfig stores == the value
// the readers see ('1' or '0' only, since readers compare `=== '1'` / `!== '0'`). Anything else is a 400, never stored.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const RC = require('../services/reportConfig');
const FE = require('../services/fourEyesGuard');
const PC = require('../services/policyCatalogue');

const ON = [true, 1, '1', 'true', 'TRUE', ' on ', 'On', 'yes'];
const OFF = [false, 0, '0', 'false', 'False', 'off', ' OFF', 'no'];
const BAD = ['', 'maybe', 'true1', 2, -1, null, {}, [], '1 0'];

test('switch keys = the policy catalogue bool keys (one list, two views)', () => {
  const bools = [...PC.build().by.values()].filter((e) => e.source === 'report_config' && e.type === 'bool').map((e) => e.key).sort();
  assert.deepStrictEqual([...RC.SWITCH_KEYS].sort(), bools);
  assert.ok(RC.SWITCH_KEYS.size > 100);
  for (const k of ['asset_replacement_uplift_pct', 'opm_rest_concurrency', 'exec_view_min_cell', 'site_codes_from_registry']) assert.ok(!RC.SWITCH_KEYS.has(k), k + ' is not a switch');
});

test('canonicalValue: every switch key maps every accepted spelling to 1/0 and refuses the rest with a 400', () => {
  for (const k of RC.SWITCH_KEYS) {
    for (const v of ON) assert.strictEqual(RC.canonicalValue(k, v), '1', `${k} ${JSON.stringify(v)}`);
    for (const v of OFF) assert.strictEqual(RC.canonicalValue(k, v), '0', `${k} ${JSON.stringify(v)}`);
    for (const v of BAD) assert.throws(() => RC.canonicalValue(k, v), (e) => e.status === 400 && e.code === 'VALIDATION', `${k} ${JSON.stringify(v)}`);
  }
  // a non-switch key keeps its string (numbers that default to 0/1 too)
  assert.strictEqual(RC.canonicalValue('asset_replacement_uplift_pct', '3'), '3');
  assert.strictEqual(RC.canonicalValue('site_codes_from_registry', 'shadow'), 'shadow');
});

test('round-trip through the store: guard-compared value == stored value == reader value, for every switch key', async () => {
  const db = await require('./_pg-fresh').fresh(['report_config']);
  const keys = [...RC.SWITCH_KEYS];
  for (const [inputs, want] of [[ON, '1'], [OFF, '0']]) {
    for (let i = 0; i < inputs.length; i++) {
      const patch = Object.fromEntries(keys.map((k) => [k, inputs[i]]));
      const compared = Object.fromEntries(keys.map((k) => [k, RC.canonicalValue(k, patch[k])]));   // what the guard compares
      await RC.setConfig(db, patch, 'test');
      const stored = await RC.getConfig(db);
      for (const k of keys) {
        assert.strictEqual(compared[k], want, k);
        assert.strictEqual(stored[k], compared[k], `${k}: stored ${JSON.stringify(stored[k])} for input ${JSON.stringify(inputs[i])}`);
        assert.strictEqual(stored[k] === '1', want === '1', `${k}: reader sees the intended state`);
      }
    }
  }
  // a refused value writes NOTHING (the whole patch, other keys included)
  await RC.setConfig(db, { export_policy_strict: '1', smtp_host: 'before' }, 'test');
  await assert.rejects(RC.setConfig(db, { smtp_host: 'after', export_policy_strict: 'maybe' }, 'test'), (e) => e.status === 400);
  const c = await RC.getConfig(db);
  assert.strictEqual(c.smtp_host, 'before');
  assert.strictEqual(c.export_policy_strict, '1');
});

test('the four-eyes guard compares the canonical value (JSON boolean true against a stored "1" is no change; false is)', () => {
  const cur = { ...RC.DEFAULTS, policy_center_enabled: '1', portfolio_site_scope_reads: '1', export_policy_strict: '1', access_require_approval: '1' };
  assert.deepStrictEqual(FE.blockedKeys(cur, { portfolio_site_scope_reads: true, export_policy_strict: 'on', access_require_approval: 1 }, { anyChange: true }), []);
  assert.deepStrictEqual(FE.blockedKeys(cur, { portfolio_site_scope_reads: false, export_policy_strict: 'off', access_require_approval: 0 }, { anyChange: true }).sort(),
    ['access_require_approval', 'export_policy_strict', 'portfolio_site_scope_reads']);
  assert.throws(() => FE.blockedKeys(cur, { export_policy_strict: 'true-ish' }, { anyChange: true }), (e) => e.status === 400);
});

test('no reader compares a switch key to a non-canonical spelling ("true"/"on"/"yes")', () => {
  const ROOT = path.join(__dirname, '..');
  const files = ['server.js', ...['routes', 'services', 'tools'].flatMap((d) => {
    const out = []; const walk = (p) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) { const f = path.join(p, e.name); if (e.isDirectory()) { if (e.name !== 'node_modules') walk(f); } else if (e.name.endsWith('.js')) out.push(f); } };
    walk(path.join(ROOT, d)); return out.map((f) => path.relative(ROOT, f));
  })];
  const bad = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const k of RC.SWITCH_KEYS) {
      const re = new RegExp(`\\b${k}\\b\\s*[!=]==?\\s*['"](true|false|on|off|yes|no)['"]`, 'i');
      if (re.test(src)) bad.push(`${f}: ${k}`);
    }
  }
  assert.deepStrictEqual(bad, []);
});
