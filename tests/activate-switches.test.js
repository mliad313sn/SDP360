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
    await rc.setConfig(rdb.db, { ui_role_landing: '0' }, 'someone');
    await rc.setConfig(rdb.db, { ui_role_landing: '2' }, 'someone');
    const back = await A.main([`--rollback=${res.rollback_file}`, `--db-url=${url}`], { ...quiet, ...(await liveDeps(url)) });
    assert.ok(back.conflicts.some((c) => c.key === 'ui_role_landing'));
    cfg = await rc.getConfig(rdb.db);
    assert.equal(cfg.commitments_enabled, '0'); assert.equal(cfg.mywork_awaiting_me_enabled, '0'); assert.equal(cfg.ui_role_landing, '2');
    // a second apply of an already-on lot writes nothing new
    await A.main(['--apply', `--db-url=${url}`, '--lots=L01', `--rollback-dir=${dir}`, '--reason=second activation run'], { ...quiet, ...(await liveDeps(url)) });
    const again = await A.main(['--apply', `--db-url=${url}`, '--lots=L01', `--rollback-dir=${dir}`, '--dry-run'], { ...quiet, ...(await liveDeps(url)) });
    assert.equal(again.steps.filter((s) => s.key !== 'ui_role_landing').length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

async function liveDeps() {
  const rdb = require('../reports-db');
  const rc = require('../services/reportConfig');
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
