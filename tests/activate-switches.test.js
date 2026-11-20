'use strict';
// tools/ops/activate-switches.js — plan / apply / rollback / refusals, on this file's throwaway database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const A = require('../tools/ops/activate-switches');

const quiet = { log: () => {} };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'act-sw-'));

test('plan: lots, keep groups and refused groups', () => {
  const plan = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'ops', 'switch-lots.json'), 'utf8'));
  assert.equal(A.selectLots(plan, 'all').length, plan.lots.length);
  assert.deepEqual(A.selectLots(plan, 'L01,L01').map((l) => l.id), ['L01']);
  assert.ok(A.selectLots(plan, 'K:outbound')[0].keep);
  for (const g of ['source_system_write', 'kill_switch', 'not_a_switch']) assert.throws(() => A.selectLots(plan, `K:${g}`), /refused/);
  assert.throws(() => A.selectLots(plan, 'L99'), /unknown lot/);
});

test('plan: dependency order, outbound skipped, prerequisite refuses the lot', () => {
  const { buildActivation } = A;
  const plan = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'ops', 'switch-lots.json'), 'utf8'));
  const register = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'ops', 'FLAG-REGISTER.json'), 'utf8'));
  // the register's defaults (not the in-memory DEFAULTS, which tools/test/force-switches.js may have changed)
  const cfg = Object.fromEntries(register.report_config.map((r) => [r.key, r.default]));
  // L05 alone: ppm_evm_enabled needs ppm_baseline_versions (L03) → the whole lot is refused
  let act = buildActivation({ plan, register, lots: A.selectLots(plan, 'L05'), cfg });
  assert.equal(act.lots[0].status, 'refused');
  assert.equal(act.steps.length, 0);
  // L03+L05 together: baseline written before EVM
  act = buildActivation({ plan, register, lots: A.selectLots(plan, 'L03,L05'), cfg });
  const keys = act.steps.map((s) => s.key);
  assert.ok(keys.indexOf('ppm_baseline_versions') < keys.indexOf('ppm_evm_enabled'));
  assert.ok(keys.indexOf('ppm_budget_periods_enabled') < keys.indexOf('actuals_import_enabled'));
  // L13: outbound skipped unless asked
  act = buildActivation({ plan, register, lots: A.selectLots(plan, 'L13'), cfg });
  assert.ok(act.skipped_outbound.includes('sync_drift_alerts'));
  assert.ok(!act.steps.some((s) => s.key === 'sync_drift_alerts'));
  act = buildActivation({ plan, register, lots: A.selectLots(plan, 'L13'), cfg, includeOutbound: true });
  assert.ok(act.steps.some((s) => s.key === 'sync_drift_alerts'));
  // an already-satisfied prerequisite in the database unblocks the lot
  act = buildActivation({ plan, register, lots: A.selectLots(plan, 'L05'), cfg: { ...cfg, ppm_baseline_versions: '1' } });
  assert.equal(act.lots[0].status, 'ok');
  // classification
  const row = A.classify('portfolio_editor_plan_writes', register, {}, () => null);
  assert.equal(row.access, 'widens');
  assert.equal(A.classify('ppm_evm_enabled', register, {}, () => null).money, true);
});

test('nested key patch keeps the rest of the JSON', () => {
  const cfg = { sla_wan_config: JSON.stringify({ notify: { enabled: false, trigger_minutes: 15 }, x: 1 }) };
  const p = A.patchFor(cfg, 'sla_wan_config.notify.enabled', true);
  const o = JSON.parse(p.sla_wan_config);
  assert.equal(o.notify.enabled, true); assert.equal(o.notify.trigger_minutes, 15); assert.equal(o.x, 1);
  assert.equal(A.isOn({ sla_wan_config: p.sla_wan_config }, 'sla_wan_config.notify.enabled'), true);
});

test('refusals: no db url, production without operator flag', async () => {
  assert.match(A.writeRefusal({}, {}), /--db-url/);
  assert.match(A.writeRefusal({ dbUrl: 'x' }, { NODE_ENV: 'production' }), /operator/);
  assert.equal(A.writeRefusal({ dbUrl: 'x', operator: true }, { NODE_ENV: 'production' }), null);
  const saved0 = process.env.PG_URL; process.env.PG_URL = 'postgres://u:p@h/db';
  try { assert.equal(A.parseArgs(['--db-url=env']).dbUrl, 'postgres://u:p@h/db', '--db-url=env reads PG_URL'); } finally { if (saved0 === undefined) delete process.env.PG_URL; else process.env.PG_URL = saved0; }
  const saved = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
  try { await assert.rejects(A.main(['--apply', '--db-url=postgres://x', '--lots=L01', '--reason=production refusal test'], quiet), /operator/); }
  finally { if (saved === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = saved; }
});

test('apply + journal + rollback on the throwaway database', async () => {
  const url = process.env.PG_URL;
  const dir = tmp();
  try {
    const rdb = require('../reports-db');
    const rc = require('../services/reportConfig');
    // every L01 + L13 switch at its shipped value (written, so a forced in-memory default cannot leak in)
    const reg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'ops', 'FLAG-REGISTER.json'), 'utf8'));
    const plan = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'ops', 'switch-lots.json'), 'utf8'));
    const keys = A.selectLots(plan, 'L01,L13').flatMap((l) => l.switches);
    await rc.setConfig(rdb.db, Object.fromEntries(keys.map((k) => [k, (reg.report_config.find((r) => r.key === k) || {}).default || '0'])), 'test');
    const res = await A.main(['--apply', `--db-url=${url}`, '--lots=L01,L13', `--rollback-dir=${dir}`, '--reason=test activation CAB-0001', '--operator=jdoe'], { ...quiet, ...(await liveDeps(url)) });
    assert.ok(res.applied.includes('commitments_enabled'));
    assert.ok(res.applied.indexOf('commitments_enabled') < res.applied.indexOf('mywork_awaiting_me_enabled'));
    assert.ok(!res.applied.includes('sync_drift_alerts'), 'outbound skipped by default');
    let cfg = await rc.getConfig(rdb.db);
    assert.equal(cfg.commitments_enabled, '1'); assert.equal(cfg.site_code_shared_block, '1'); assert.equal(cfg.sync_drift_alerts, '0');
    const { rows } = await rdb.listSystemLog({ category: 'config', action: 'config_changed' }, { limit: 500 });
    assert.ok(rows.some((r) => r.target === 'commitments_enabled' && r.actor === 'cli:activate-switches:jdoe'), 'the operator is named on the journal row');
    const rb = JSON.parse(fs.readFileSync(res.rollback_file, 'utf8'));
    assert.ok(rb.entries.find((e) => e.key === 'ui_role_landing'));
    assert.ok(!/sdptest-local-only/.test(fs.readFileSync(res.rollback_file, 'utf8')), 'password never in the rollback file');
    // someone changes one switch after the activation: rollback leaves it alone unless --force
    // (N-R6-1: a switch only stores 1/0 now, so the outside change is the switch turned back off)
    await rc.setConfig(rdb.db, { ui_role_landing: '0' }, 'someone');
    // N-15 / R6-A1: L13 turned policy_center_enabled on; rolling it back to '0' is the weaker side → never written by the
    // tool: a Policy Center request filed by the AUTHENTICATED operator (token), another super_admin decides
    await assert.rejects(A.main([`--rollback=${res.rollback_file}`, `--db-url=${url}`, '--operator=jdoe'], { ...quiet, ...(await liveDeps(url)) }), /policy_center_enabled[^]*operator-token[^]*nothing restored/);
    await assert.rejects(A.main([`--rollback=${res.rollback_file}`, `--db-url=${url}`, '--operator=jdoe', '--second-operator=asmith'], { ...quiet, ...(await liveDeps(url)) }), /--second-operator is no longer accepted/);
    const tokSmith = await issueToken('asmith');
    const ldeps = { ...quiet, ...(await liveDeps(url)) };
    const back = await withToken(tokSmith, () => A.main([`--rollback=${res.rollback_file}`, `--db-url=${url}`, '--operator-token=env'], ldeps));
    assert.ok(back.conflicts.some((c) => c.key === 'ui_role_landing'));
    assert.ok(back.requested.some((r) => r.key === 'policy_center_enabled'), JSON.stringify(back.requested));
    assert.ok(back.requested.every((r) => r.requested_by === 'asmith'));
    assert.ok(!back.restored.some((k) => back.requested.some((r) => r.key === k)), 'a four-eyes key is requested, never written back');
    assert.equal((await rc.getConfig(rdb.db)).policy_center_enabled, '1', 'the four-eyes key awaits a second super_admin');
    await rc.setConfig(rdb.db, { policy_center_enabled: '0' }, 'test');
    cfg = await rc.getConfig(rdb.db);
    assert.equal(cfg.commitments_enabled, '0'); assert.equal(cfg.mywork_awaiting_me_enabled, '0'); assert.equal(cfg.ui_role_landing, '0');
    // a second apply of an already-on lot writes nothing new
    await A.main(['--apply', `--db-url=${url}`, '--lots=L01', `--rollback-dir=${dir}`, '--reason=second activation run'], { ...quiet, ...(await liveDeps(url)) });
    const again = await A.main(['--apply', `--db-url=${url}`, '--lots=L01', `--rollback-dir=${dir}`, '--dry-run'], { ...quiet, ...(await liveDeps(url)) });
    assert.equal(again.steps.filter((s) => s.key !== 'ui_role_landing').length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// P11 r6 O-4 — the second operator must be a real active super_admin account: the live tests create one.
async function ensureAccount(username, { role = 'super_admin', active = 1 } = {}) {
  const H = require('../reports-db').pgHandle();
  let u = await H.prepare('SELECT id FROM users WHERE lower(username) = lower(?)').get(username);
  if (!u) u = await H.prepare("INSERT INTO users (username, full_name, password_hash, salt, active) VALUES (?, ?, 'x', 'y', ?) RETURNING id").get(username, username.toUpperCase(), active);
  if (role) await H.prepare('INSERT INTO user_roles (user_id, role) VALUES (?, ?) ON CONFLICT DO NOTHING').run(u.id, role);
  return Number(u.id);
}

// P11 r6 R6-A1 — an operator token issued for an account (what /policy-center.html does for the logged-in user)
async function issueToken(username) {
  const id = await ensureAccount(username);
  return (await require('../services/operatorTokens').issue(require('../reports-db').pgHandle(), { id, username })).token;
}
async function withToken(token, fn) {
  const prev = process.env.SDP_OPERATOR_TOKEN; process.env.SDP_OPERATOR_TOKEN = token;
  try { return await fn(); } finally { if (prev === undefined) delete process.env.SDP_OPERATOR_TOKEN; else process.env.SDP_OPERATOR_TOKEN = prev; }
}

async function liveDeps() {
  const rdb = require('../reports-db');
  const rc = require('../services/reportConfig');
  await ensureAccount('asmith');
  return {
    getConfig: () => rc.getConfig(rdb.db),
    setConfig: (patch) => rc.setConfig(rdb.db, patch, 'cli:activate-switches'),
    logEvent: (ev) => rdb.logEvent(ev),
    ...A.storedDeps(rdb),
  };
}

// P11 r4 R4-A4 — `--apply` with no --lots armed all 14 lots, with no reason and no named operator.
test('r4 A4: --apply needs explicit --lots and a real --reason; dry run does not', async () => {
  assert.match(A.applyRefusal({ apply: true }), /explicit --lots/);
  assert.match(A.applyRefusal({ apply: true, lots: 'L01' }), /--reason/);
  assert.match(A.applyRefusal({ apply: true, lots: 'L01', reason: ' ok   ' }), /--reason/);
  assert.equal(A.applyRefusal({ apply: true, lots: 'L01', reason: 'pilot of L01, CAB-123' }), null);
  assert.equal(A.applyRefusal({ apply: true, dryRun: true }), null);
  let wrote = 0;
  const fake = { log: () => {}, getConfig: async () => ({}), setConfig: async () => { wrote++; } };
  await assert.rejects(A.main(['--apply', '--db-url=postgres://x'], fake), /explicit --lots/);
  await assert.rejects(A.main(['--apply', '--db-url=postgres://x', '--lots=L01'], fake), /--reason/);
  assert.equal(wrote, 0);
  assert.equal(A.actorOf('j doe;x'), 'cli:activate-switches:j_doe_x');
});

// P11 r4 R4-A3 — a hand-written rollback file armed refused / boundary keys and arbitrary settings.
test('r4 A3: rollback refuses a hand-written, edited or unrecorded file and any key outside its lots', async () => {
  const plan = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'ops', 'switch-lots.json'), 'utf8'));
  const dir = tmp();
  let wrote = 0;
  const fake = (known) => ({ log: () => {}, getConfig: async () => ({ sdp_api_write_enabled: '0', smtp_host: 'mail.corp' }),
    setConfig: async () => { wrote++; }, rollbackKnown: async (sha) => known.has(sha) });
  try {
    const evil = { entries: [{ key: 'sdp_api_write_enabled', from: '1', to: '0' }, { key: 'smtp_host', from: 'evil.example', to: 'mail.corp' }], lots: ['L01'] };
    const f1 = path.join(dir, 'evil.json'); fs.writeFileSync(f1, JSON.stringify(evil));
    await assert.rejects(A.main([`--rollback=${f1}`, '--db-url=postgres://x', '--force'], fake(new Set())), /rollback file refused/);
    const probs = A.validateRollback({ ...evil, created_at: 'x', actor: 'y', sha256: A.rollbackHash({ ...evil, created_at: 'x', actor: 'y' }) }, plan);
    assert.ok(probs.some((p) => /sdp_api_write_enabled: in a refused keep group/.test(p)), probs.join('|'));
    assert.ok(probs.some((p) => /smtp_host: not a switch/.test(p)));
    // a well-formed file of the tool: valid content, but refused until its hash is recorded
    const l01 = A.selectLots(plan, 'L01')[0].switches[0];
    const good = { created_at: '2026-11-20T00:00:00Z', actor: 'cli:activate-switches', operator: 'jdoe', lots: ['L01'], entries: [{ key: l01, from: '0', to: '1' }] };
    good.sha256 = A.rollbackHash(good);
    assert.deepEqual(A.validateRollback(good, plan), []);
    const f2 = path.join(dir, 'good.json'); fs.writeFileSync(f2, JSON.stringify(good));
    await assert.rejects(A.main([`--rollback=${f2}`, '--db-url=postgres://x'], fake(new Set())), /never recorded/);
    // edited after writing: hash mismatch
    const edited = { ...good, entries: [{ key: l01, from: 'zz', to: '1' }] };
    const f3 = path.join(dir, 'edited.json'); fs.writeFileSync(f3, JSON.stringify(edited));
    await assert.rejects(A.main([`--rollback=${f3}`, '--db-url=postgres://x'], fake(new Set([good.sha256]))), /does not match/);
    // a non-flag "from" value is refused even with a matching hash
    const odd = { ...good, entries: [{ key: l01, from: 'evil host with spaces', to: '1' }] }; odd.sha256 = A.rollbackHash(odd);
    assert.ok(A.validateRollback(odd, plan).some((p) => /not a switch value/.test(p)));
    assert.equal(wrote, 0, 'nothing was written');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// P11 r4 (ops) — a key absent before the activation returns to absent on rollback (follows its default), instead of
// being pinned to a literal '0' row.
test('r4: rollback of a key that had no report_config row deletes the row again', async () => {
  const url = process.env.PG_URL;
  const dir = tmp();
  try {
    const rdb = require('../reports-db');
    const rc = require('../services/reportConfig');
    const reg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'ops', 'FLAG-REGISTER.json'), 'utf8'));
    const plan = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'ops', 'switch-lots.json'), 'utf8'));
    const keys = A.selectLots(plan, 'L01').flatMap((l) => l.switches).filter((k) => !k.includes('.'));
    await rc.setConfig(rdb.db, Object.fromEntries(keys.map((k) => [k, (reg.report_config.find((r) => r.key === k) || {}).default || '0'])), 'test');
    await rdb.pgHandle().prepare('DELETE FROM report_config WHERE key = ?').run('commitments_enabled');
    const res = await A.main(['--apply', `--db-url=${url}`, '--lots=L01', `--rollback-dir=${dir}`, '--reason=absent-key rollback test'], { ...quiet, ...(await liveDeps(url)) });
    assert.ok(res.applied.includes('commitments_enabled'));
    const rb = JSON.parse(fs.readFileSync(res.rollback_file, 'utf8'));
    assert.equal(rb.entries.find((e) => e.key === 'commitments_enabled').absent, true);
    await A.main([`--rollback=${res.rollback_file}`, `--db-url=${url}`, '--force'], { ...quiet, ...(await liveDeps(url)) });
    const row = await rdb.pgHandle().prepare('SELECT value FROM report_config WHERE key = ?').get('commitments_enabled');
    assert.equal(row, undefined, 'returned to absent, not pinned to a literal value');
    assert.equal((await rc.getConfig(rdb.db)).commitments_enabled, rc.DEFAULTS.commitments_enabled);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// P11 r5 N-15 — --apply wrote four-eyes switches (emergency_access_enabled, portfolio_editor_plan_writes…) with ONE
// operator, bypassing the second-super_admin rule the Policy Center enforces in the UI. Now: a four-eyes step needs
// --second-operator (a different person, both recorded), or — Policy Center on — becomes a center request, never a write.
test('r5 N-15: four-eyes detection follows the Policy Center rule; the second operator must be another person', () => {
  const plan = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'ops', 'switch-lots.json'), 'utf8'));
  const register = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'ops', 'FLAG-REGISTER.json'), 'utf8'));
  const cfg = Object.fromEntries(register.report_config.map((r) => [r.key, r.default]));
  assert.equal(A.needsFourEyes(cfg, 'emergency_access_enabled', '1'), true);
  assert.equal(A.needsFourEyes(cfg, 'portfolio_editor_plan_writes', '1'), true);
  assert.equal(A.needsFourEyes(cfg, 'policy_center_enabled', '1'), false, 'towards the strict side: no second person');
  assert.equal(A.needsFourEyes(cfg, 'commitments_enabled', '1'), false, 'not a four-eyes key');
  const act = A.markFourEyes(A.buildActivation({ plan, register, lots: A.selectLots(plan, 'L12'), cfg }), cfg);
  const fe = act.steps.filter((s) => s.four_eyes).map((s) => s.key).sort();
  assert.deepEqual(fe, ['access_grant_expiry_job', 'access_recert_enabled', 'emergency_access_enabled', 'login_limit_failures_only']);
  assert.match(A.renderPlan(act, { source: 'x' }), /emergency_access_enabled[^\n]*4EYES/);
  assert.match(A.renderPlan(act, { source: 'x' }), /Four-eyes \(second super_admin required\): /);
  // L01 has no four-eyes step: unchanged behaviour
  const a1 = A.markFourEyes(A.buildActivation({ plan, register, lots: A.selectLots(plan, 'L01'), cfg }), cfg);
  assert.equal(a1.steps.filter((s) => s.four_eyes).length, 0);
  assert.equal(A.secondOperatorRefusal('jdoe', ''), 'missing');
  assert.match(A.secondOperatorRefusal('J.Doe', ' j.doe '), /same person/);
  assert.match(A.secondOperatorRefusal('', 'asmith'), /first operator is unknown/);
  assert.equal(A.secondOperatorRefusal('jdoe', 'asmith'), null);
  assert.equal(A.parseArgs(['--second-operator=asmith']).secondOperator, 'asmith');
});

async function resetLot(lotIds) {
  const rdb = require('../reports-db');
  const rc = require('../services/reportConfig');
  const reg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'ops', 'FLAG-REGISTER.json'), 'utf8'));
  const plan = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'ops', 'switch-lots.json'), 'utf8'));
  const keys = A.selectLots(plan, lotIds).flatMap((l) => l.switches).filter((k) => !k.includes('.'));
  await rc.setConfig(rdb.db, Object.fromEntries(keys.map((k) => [k, (reg.report_config.find((r) => r.key === k) || {}).default || '0'])), 'test');
  return keys;
}

test('r6 R6-A1 (pg): center OFF — four-eyes steps are refused and NOTHING is written; --second-operator is refused', async () => {
  const url = process.env.PG_URL;
  const dir = tmp();
  try {
    const rdb = require('../reports-db');
    const rc = require('../services/reportConfig');
    await rc.setConfig(rdb.db, { policy_center_enabled: '0' }, 'test');
    const keys = await resetLot('L12');
    const before = await rc.getConfig(rdb.db);
    await assert.rejects(A.main(['--apply', `--db-url=${url}`, '--lots=L12', `--rollback-dir=${dir}`, '--reason=L12 activation CAB-0042', '--operator=jdoe'], { ...quiet, ...(await liveDeps(url)) }),
      /emergency_access_enabled[^]*second super_admin[^]*Policy Center on[^]*nothing written/);
    await assert.rejects(A.main(['--apply', `--db-url=${url}`, '--lots=L12', `--rollback-dir=${dir}`, '--reason=L12 activation CAB-0042', '--operator=jdoe', '--second-operator=asmith'], { ...quiet, ...(await liveDeps(url)) }),
      /--second-operator is no longer accepted[^]*nothing written/);
    // even an authenticated operator cannot apply a four-eyes change alone while the center is off
    const tok = await issueToken('asmith');
    const ldeps = { ...quiet, ...(await liveDeps(url)) };
    await assert.rejects(withToken(tok, () => A.main(['--apply', `--db-url=${url}`, '--lots=L12', `--rollback-dir=${dir}`, '--reason=L12 activation CAB-0042', '--operator-token=env'], ldeps)),
      /Policy Center on[^]*nothing written/);
    const mid = await rc.getConfig(rdb.db);
    for (const k of keys) assert.equal(mid[k], before[k], `${k} untouched after the refusals`);
    assert.equal(fs.readdirSync(dir).length, 0, 'no rollback file written');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('r6 R6-A1 (pg): Policy Center on — requests are filed as the AUTHENTICATED account only; the rest is written', async () => {
  const url = process.env.PG_URL;
  const dir = tmp();
  const rdb = require('../reports-db');
  const rc = require('../services/reportConfig');
  try {
    await resetLot('L12');
    await rc.setConfig(rdb.db, { policy_center_enabled: '1' }, 'test');
    const deps = { ...quiet, ...(await liveDeps(url)) };
    const go = (extra) => A.main(['--apply', `--db-url=${url}`, '--lots=L12', `--rollback-dir=${dir}`, '--reason=L12 via policy center', ...extra], deps);
    // a typed name is not enough any more (the round-6 impersonation): no token → refused, nothing written
    await assert.rejects(go(['--operator=pc-super']), /operator-token[^]*nothing written/);
    // a literal token on the command line is refused (process listings)
    await assert.rejects(go(['--operator-token=sdpop_' + 'a'.repeat(43)]), /never the token itself/);
    const H = rdb.pgHandle();
    const uid = await ensureAccount('pc-super');
    await ensureAccount('pc-other');
    const tok = await issueToken('pc-super');
    // --operator naming ANOTHER account than the token's → refused (the token was consumed by that check: issue a new one)
    await assert.rejects(withToken(tok, () => go(['--operator-token=env', '--operator=pc-other'])), /not the account that issued the operator token/);
    await assert.rejects(withToken(tok, () => go(['--operator-token=env'])), /already used or expired/, 'a token works once');
    const tok2 = await issueToken('pc-super');
    // dry run checks the token without burning it
    const dry = await withToken(tok2, () => go(['--operator-token=env', '--dry-run']));
    assert.deepEqual(dry.requested, []);
    const res = await withToken(tok2, () => go(['--operator-token=env']));
    const fe = ['access_grant_expiry_job', 'access_recert_enabled', 'emergency_access_enabled', 'login_limit_failures_only'];
    assert.deepEqual(res.requested.map((r) => r.key).sort(), fe);
    assert.ok(res.requested.every((r) => r.requested_by === 'pc-super'));
    const cfg = await rc.getConfig(rdb.db);
    for (const k of fe) assert.equal(cfg[k], rc.DEFAULTS[k], `${k} NOT written — awaiting a second super_admin`);
    assert.equal(cfg.access_require_approval, '1', 'a non-four-eyes switch of the same lot is written');
    const reqs = (await H.prepare("SELECT key, new_value, requested_by, reason, status FROM policy_change_requests WHERE status = 'pending' ORDER BY key").all()).filter((r) => fe.includes(r.key));
    assert.deepEqual(reqs.map((r) => r.key), fe);
    assert.ok(reqs.every((r) => Number(r.requested_by) === uid && r.new_value === '1'));
    assert.ok(reqs.every((r) => /authenticated by operator token #\d+; os /.test(r.reason)), 'the request records the token and the OS identity');
    const rb = JSON.parse(fs.readFileSync(res.rollback_file, 'utf8'));
    assert.ok(!rb.entries.some((e) => fe.includes(e.key)), 'the rollback file lists only what was written');
    assert.equal(rb.operator, 'pc-super', 'the authenticated account is the operator of record');
  } finally {
    await rc.setConfig(rdb.db, { policy_center_enabled: '0' }, 'test');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('r6 R6-A1: readOperatorToken accepts env / env:VAR / file:PATH and refuses a literal', () => {
  assert.equal(A.readOperatorToken(undefined).refusal, 'missing');
  assert.equal(A.readOperatorToken('env', { SDP_OPERATOR_TOKEN: ' sdpop_x ' }).token, 'sdpop_x');
  assert.equal(A.readOperatorToken('env:MY_TOK', { MY_TOK: 'sdpop_y' }).token, 'sdpop_y');
  assert.match(A.readOperatorToken('env', {}).refusal, /empty/);
  assert.match(A.readOperatorToken('env:bad name', {}).refusal, /not an environment variable/);
  assert.match(A.readOperatorToken('sdpop_zzz').refusal, /never the token itself/);
  const f = path.join(tmp(), 'tok'); fs.writeFileSync(f, 'sdpop_file\n');
  assert.equal(A.readOperatorToken('file:' + f).token, 'sdpop_file');
  assert.equal(A.parseArgs(['--operator-token=env']).operatorToken, 'env');
});

// P11 r5 R5-A4/A6 — the rollback "signature" was an unkeyed sha256: now an HMAC seal under SDP_CONFIG_KEY / SDP_BACKUP_KEY
// when one is set (checksum only otherwise, labelled honestly); the OS user + host are recorded beside the declared name.
test('r5: rollback files are HMAC-sealed when a key is configured; unsealed / forged files are refused', () => {
  const plan = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'ops', 'switch-lots.json'), 'utf8'));
  const l01 = A.selectLots(plan, 'L01')[0].switches[0];
  const env = { SDP_CONFIG_KEY: 'a-long-enough-config-key-1234' };
  const rb = { created_at: '2026-11-20T00:00:00Z', actor: 'cli:activate-switches', operator: 'jdoe', os_user: 'svc_ops', host: 'SRV01', lots: ['L01'], entries: [{ key: l01, from: '0', to: '1' }] };
  rb.sha256 = A.rollbackHash(rb);
  // unsealed while a key exists → refused unless explicitly accepted (then a warning, never "signed")
  assert.match(A.sealCheck(rb, env).problems.join('|'), /no HMAC seal/);
  const acc = A.sealCheck(rb, env, { acceptUnsealed: true });
  assert.deepEqual(acc.problems, []); assert.match(acc.warnings[0], /NOT signed/);
  // no key at all → checksum only, warned
  const nok = A.sealCheck(rb, {}); assert.deepEqual(nok.problems, []); assert.match(nok.warnings[0], /checksummed only/);
  // sealed: verifies under the same key, not under another, and an edit with a recomputed checksum breaks it
  const sealed = { ...rb, hmac: A.rollbackHmac(rb, A.rollbackKey(env)) };
  assert.deepEqual(A.sealCheck(sealed, env), { problems: [], warnings: [] });
  assert.match(A.sealCheck(sealed, { SDP_CONFIG_KEY: 'another-long-key-0000000' }).problems[0], /does not match/);
  assert.match(A.sealCheck(sealed, {}).problems[0], /cannot verify/);
  const forged = { ...sealed, entries: [{ key: l01, from: '1', to: '1' }] }; forged.sha256 = A.rollbackHash(forged);
  assert.match(A.sealCheck(forged, env).problems[0], /does not match/);
  // the OS identity is inside the checksummed content
  assert.notEqual(A.rollbackHash({ ...rb, os_user: 'someone_else' }), rb.sha256);
  // SDP_BACKUP_KEY is the fallback key; a short key is not a key
  assert.equal(A.rollbackKey({ SDP_BACKUP_KEY: 'backup-key-long-enough-xx' }).name, 'SDP_BACKUP_KEY');
  assert.equal(A.rollbackKey({ SDP_CONFIG_KEY: 'short' }), null);
  const id = A.osIdentity(); assert.ok('os_user' in id && 'host' in id);
});

test('r5: --apply writes os_user + host and the HMAC seal into the rollback file and the journal event', async () => {
  const dir = tmp(); const events = []; const cfg = {};
  const prev = process.env.SDP_CONFIG_KEY; process.env.SDP_CONFIG_KEY = 'a-long-enough-config-key-1234';
  try {
    const plan = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'ops', 'switch-lots.json'), 'utf8'));
    const lot = plan.lots.find((l) => l.id === 'L15') || plan.lots[0];
    const d = { log: () => {}, getConfig: async () => ({ ...cfg }), setConfig: async (p) => Object.assign(cfg, p), logEvent: async (e) => events.push(e),
      storedKeys: async () => new Set(Object.keys(cfg)), osIdentity: { os_user: 'svc_ops', host: 'SRV01' }, rollbackKnown: async () => true,
      operatorAccount: async (n) => ({ asmith: { id: 7, username: 'asmith', name: 'A Smith' }, jdoe: { id: 3, username: 'jdoe', name: 'J Doe' } })[String(n).toLowerCase()] || null };
    const r = await A.main(['--apply', '--db-url=postgres://x', `--lots=${lot.id}`, '--reason=pilot wave test CAB-0', `--rollback-dir=${dir}`, '--operator=jdoe', '--include-outbound', '--second-operator=asmith'], d);
    assert.ok(r.rollback_file, 'a rollback file was written: ' + JSON.stringify(r).slice(0, 300));
    const rb = JSON.parse(fs.readFileSync(r.rollback_file, 'utf8'));
    assert.equal(rb.os_user, 'svc_ops'); assert.equal(rb.host, 'SRV01'); assert.equal(rb.operator, 'jdoe');
    assert.match(rb.hmac, /^[0-9a-f]{64}$/); assert.match(rb.integrity, /hmac-sha256 \(SDP_CONFIG_KEY\)/);
    const ev = events.find((e) => e.action === 'switch_rollback_file');
    assert.equal(ev.details.os_user, 'svc_ops'); assert.equal(ev.details.host, 'SRV01'); assert.equal(ev.details.sealed, true);
  } finally { if (prev === undefined) delete process.env.SDP_CONFIG_KEY; else process.env.SDP_CONFIG_KEY = prev; fs.rmSync(dir, { recursive: true, force: true }); }
});

// P11 r6 O-4 → superseded by R6-A1: the second operator is no longer a CLI input at all (see the tests above and
// tests/activate-switches-r6-impersonation.smoke.test.js).
