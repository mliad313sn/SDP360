'use strict';
// P11 round 7 (security seat) — fix 31, through the real server and against the readers themselves:
//   N-R7-1  a numeric four-eyes key with a strict_direction accepts only the range its READER accepts. Before, the
//           Policy Center judged "stricter" with Number(next) alone: one super_admin could store
//           auth_pbkdf2_iterations = 10000000 ("higher") or auth_account_throttle_max = 0 ("lower") — applied at once —
//           and the readers silently fell back to the weak defaults (100000 / 10). Now: 400 before the four-eyes
//           check (center PUT, import dry run, generic config PUT), and the catalogue, the write path and the readers
//           share one table (services/policyRanges.js).
//   P3      a switch sent as '' through the generic config PUT means "not sent" (one blank box no longer refuses the
//           whole form); garbage stays a 400 and a real change still meets the four-eyes guard.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'p11r7-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'p11r7-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'p11r7-admin-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'p11r7-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
process.env.AI_PROVIDER = 'off';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const path = require('path');
let server, base, rdb, RC; const T = {};

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); RC = require('../services/reportConfig');
  const mk = async (k, roles) => { const u = 'p11r7_' + k; try { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles }); } catch {} T[k] = (await rdb.login(u, u + 'pass1234')).token; };
  await mk('super', ['super_admin']);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const send = async (m, p, t, body) => { const r = await fetch(base + p, { method: m, headers: { ...(t ? { 'x-report-token': t } : {}), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, j }; };
const cfg = async () => RC.getConfig(rdb.db);

// ── unit: one source of truth ─────────────────────────────────────────────────────────────────────────────────────
test('N-R7-1: every numeric four-eyes key with a strict_direction declares a range, equal in the catalogue file and the code', () => {
  const R = require('../services/policyRanges').RANGES;
  const PC = require('../services/policyCatalogue');
  const cat = JSON.parse(_fs.readFileSync(path.join(__dirname, '..', 'docs', 'ops', 'policy-catalogue.json'), 'utf8')).keys;
  const strictNumeric = PC.build().entries.filter((e) => e.source === 'report_config' && e.four_eyes && e.strict_direction);
  assert.ok(strictNumeric.length >= 5, 'the five known keys at least');
  for (const e of strictNumeric) {
    const r = R[e.key];
    assert.ok(r, `${e.key}: strict_direction without a reader range`);
    assert.deepStrictEqual([e.min, e.max, e.integer], [r.min, r.max, true], `${e.key}: built entry = range`);
    assert.deepStrictEqual([cat[e.key].min, cat[e.key].max, cat[e.key].integer], [r.min, r.max, true], `${e.key}: catalogue file = range`);
    assert.ok(r.min <= Number(RC.DEFAULTS[e.key]) && Number(RC.DEFAULTS[e.key]) <= r.max, `${e.key}: the code default is inside its range`);
  }
  assert.deepStrictEqual(require('../tools/agent/policy-catalogue').check(require('../tools/agent/policy-catalogue').readFile()).badRange, []);
});

test('N-R7-1: each reader accepts exactly its declared range (min and max kept as typed, nothing outside honoured)', () => {
  const R = require('../services/policyRanges').RANGES;
  const pb = rdb._pbkdf2Target, P = R.auth_pbkdf2_iterations;
  assert.strictEqual(pb(String(P.min)), P.min); assert.strictEqual(pb(String(P.max)), P.max);
  assert.strictEqual(pb(String(P.max + 1)), 100000); assert.strictEqual(pb('700000.5'), 100000);
  const th = require('../services/accountThrottle').settings, M = R.auth_account_throttle_max, W = R.auth_account_throttle_window_min;
  assert.strictEqual(th({ auth_account_throttle_max: String(M.min) }).max, M.min); assert.strictEqual(th({ auth_account_throttle_max: String(M.max) }).max, M.max);
  assert.strictEqual(th({ auth_account_throttle_max: '0' }).max, 10, 'below the range = the default (the weaker value)');
  assert.strictEqual(th({ auth_account_throttle_window_min: String(W.max) }).windowMs, W.max * 60000);
  const bg = require('../services/breakglassGuard'), B = R.breakglass_session_minutes;
  const minutes = (v) => bg.decide({ cfg: { breakglass_timebox_enabled: '1', breakglass_session_minutes: v }, sso: { breakglassUser: 'b', mode: 'available' }, username: 'b', reason: 'entra outage right now' }).minutes;
  assert.strictEqual(minutes(String(B.min)), B.min); assert.strictEqual(minutes(String(B.max)), B.max);
  const ea = require('../services/emergencyAccess'), E = R.emergency_access_max_hours;
  assert.strictEqual(ea.maxHours(String(E.min)), E.min); assert.strictEqual(ea.maxHours(String(E.max)), E.max);
});

test('N-R7-1: the write path refuses a value outside the reader range with a 400, before any four-eyes decision', () => {
  const PC = require('../services/policyCatalogue'); const by = PC.build().by;
  const bad = { auth_pbkdf2_iterations: ['10000000', '5000001', '99999', '700000.5', '6e5', '-5', '', 'abc'],
    auth_account_throttle_max: ['0', '-5', '1001', '2.5', '1e1', ''], auth_account_throttle_window_min: ['0', '1441', '3.5'],
    breakglass_session_minutes: ['1', '4', '1441', '7.5'], emergency_access_max_hours: ['0', '25', '2.5'] };
  for (const [k, vals] of Object.entries(bad)) for (const v of vals) {
    assert.throws(() => PC.validateConfigValue(by.get(k), v), (e) => e.status === 400, `${k}=${v} (center)`);
    assert.throws(() => RC.canonicalValue(k, v), (e) => e.status === 400, `${k}=${v} (config write path)`);
    assert.strictEqual(PC.needsSecondPerson(by.get(k), String(RC.DEFAULTS[k]), v), true, `${k}=${v} is never "stricter"`);
  }
  assert.strictEqual(RC.canonicalValue('auth_pbkdf2_iterations', ' 600000 '), '600000');
  assert.strictEqual(PC.validateConfigValue(by.get('auth_account_throttle_max'), '3'), '3');
});

// ── through the server ────────────────────────────────────────────────────────────────────────────────────────────
test('N-R7-1: center ON — the reviewer repro is refused (400), nothing applied, the readers keep the strict values', async () => {
  await RC.setConfig(rdb.db, { policy_center_enabled: '1', auth_pbkdf2_iterations: '600000', auth_account_throttle_enabled: '1', auth_account_throttle_max: '3' }, 'test');
  const put = (k, value) => send('PUT', '/api/policy-center/rules/' + k, T.super, { value, reason: 'harden the access controls a lot' });
  for (const [k, v] of [['auth_pbkdf2_iterations', '10000000'], ['auth_pbkdf2_iterations', '700000.5'], ['auth_account_throttle_max', '0'], ['auth_account_throttle_max', '-5']]) {
    const r = await put(k, v);
    assert.strictEqual(r.status, 400, `${k}=${v}: ${JSON.stringify(r.j)}`);
  }
  let c = await cfg();
  assert.strictEqual(c.auth_pbkdf2_iterations, '600000'); assert.strictEqual(c.auth_account_throttle_max, '3');
  assert.strictEqual(rdb._pbkdf2Target(c.auth_pbkdf2_iterations), 600000);
  assert.strictEqual(require('../services/accountThrottle').settings(c).max, 3);
  // a genuinely stricter value inside the range stays immediate
  const ok = await put('auth_account_throttle_max', '2');
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.j));
  // the import dry run marks the same values invalid (never 'apply')
  const dry = await send('POST', '/api/policy-center/import', T.super, { profile: { name: 'r7', values: { auth_pbkdf2_iterations: '10000000', auth_account_throttle_max: '0' } } });
  assert.strictEqual(dry.status, 200, JSON.stringify(dry.j));
  for (const row of dry.j.plan) assert.strictEqual(row.action, 'invalid', JSON.stringify(row));
  // the generic config PUT refuses it too (400, not a silent store)
  const legacy = await send('PUT', '/api/reports/config', T.super, { auth_account_throttle_max: '0', reason: 'tighten it alone' });
  assert.strictEqual(legacy.status, 400, JSON.stringify(legacy.j));
  c = await cfg();
  assert.strictEqual(c.auth_account_throttle_max, '2');
  await RC.setConfig(rdb.db, { policy_center_enabled: '0' }, 'test');
});

test('P3: a switch sent as "" through the generic config PUT is "not sent"; garbage still 400; four-eyes still applies', async () => {
  await RC.setConfig(rdb.db, { policy_center_enabled: '0', hygiene_send_enabled: '1', hygiene_recipients: 'old@example.invalid' }, 'test');
  const r = await send('PUT', '/api/reports/config', T.super, { hygiene_send_enabled: '', hygiene_recipients: 'new@example.invalid' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.j));
  let c = await cfg();
  assert.strictEqual(c.hygiene_send_enabled, '1', 'the blank switch did not change'); assert.strictEqual(c.hygiene_recipients, 'new@example.invalid', 'the rest of the form saved');
  assert.strictEqual(RC.canonicalValue('hygiene_send_enabled', '  '), undefined);
  for (const g of [null, 'maybe', [], {}]) {
    const bad = await send('PUT', '/api/reports/config', T.super, { hygiene_send_enabled: g });
    assert.strictEqual(bad.status, 400, JSON.stringify(g));
  }
  await RC.setConfig(rdb.db, { policy_center_enabled: '1', export_policy_strict: '1' }, 'test');
  const blank = await send('PUT', '/api/reports/config', T.super, { export_policy_strict: '', reason: 'blank box on a strict control' });
  assert.strictEqual(blank.status, 200, 'blank = not sent, not a weakening');
  assert.strictEqual((await cfg()).export_policy_strict, '1');
  const off = await send('PUT', '/api/reports/config', T.super, { export_policy_strict: '0', reason: 'turn it off alone now' });
  assert.strictEqual(off.status, 409);
  assert.strictEqual((await cfg()).export_policy_strict, '1');
  await RC.setConfig(rdb.db, { policy_center_enabled: '0' }, 'test');
});
