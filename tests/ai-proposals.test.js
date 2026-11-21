'use strict';
// AI proposals (docs/business-readiness/PROPOSITIONS-IA.md) and the final-test profile
// (docs/business-readiness/PROFIL-TEST-FINAL.json). A proposal decides nothing: the human decision cells of the register
// stay empty, no text claims an approval, and the profile is only ever written to a TEST database, never through the
// four-eyes guard.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ap = require('../tools/release/ai-proposals-check.js');
const ftp = require('../tools/release/final-test-profile.js');
const br = require('../tools/release/business-readiness-check.js');
const { items } = require('../tools/release/business-readiness.source.js');
const { proposals } = require('../tools/release/ai-proposals.source.js');
const { DEFAULTS } = require('../services/reportConfig.js');

test('one proposal per pending decision — no missing, no extra, no duplicate', () => {
  const ids = proposals.map((p) => p.id).sort();
  assert.deepStrictEqual(ids, items.map((i) => i.id).sort());
  assert.strictEqual(new Set(ids).size, ids.length);
});

test('every choix_propose is an option of its item, word for word, or the explicit "Option recommandée : …" form', () => {
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const p of proposals) {
    const ok = byId.get(p.id).options.includes(p.choix_propose) || p.choix_propose.startsWith(ap.RECO_PREFIX);
    assert.ok(ok, `${p.id}: ${p.choix_propose}`);
  }
});

test('every proposed configuration key exists in reportConfig DEFAULTS', () => {
  for (const p of proposals) for (const k of Object.keys(p.valeurs_proposees || {})) assert.ok(Object.prototype.hasOwnProperty.call(DEFAULTS, k), `${p.id}: ${k}`);
});

test('no proposal claims an approval, a signature or a validation', () => {
  for (const p of proposals) {
    const t = [p.choix_propose, p.justification, p.verification_test_final, p.risque_si_accepte, p.acte_humain || ''].join(' ');
    assert.ok(!/approuv|\bsign[ée]e?s?\b|validé par/i.test(t), `${p.id}: ${t}`);
  }
  // the checker itself refuses such a text
  assert.ok(ap.CLAIM.test('Décision approuvée par le comité'));
});

test('the source validates and PROPOSITIONS-IA.md is fresh', () => {
  assert.deepStrictEqual(ap.check(ROOT), []);
  const md = ap.render(ROOT);
  assert.ok(md.includes('PROPOSITIONS IA — non approuvées'));
  assert.ok(md.includes('Aucune case de décision humaine n\'est remplie'));
});

test('the register still has every human decision cell empty (business-readiness check stays green)', () => {
  const problems = br.check(br.ROOT);
  assert.deepStrictEqual(problems, [], problems.join('\n'));
});

test('the final-test profile merges without conflict, turns on no outbound or money switch, and is fresh', () => {
  const b = ftp.build(ROOT);
  assert.deepStrictEqual(b.errors, []);
  assert.deepStrictEqual(ftp.stale(ROOT), []);
  const m = ftp.merge([{ id: 'A', valeurs_proposees: { x: '1' } }, { id: 'B', valeurs_proposees: { x: '0' } }]);
  assert.strictEqual(m.errors.length, 1);
  const c = ftp.classify({ weekly_report_send_enabled: '1', actuals_import_enabled: '1' }, DEFAULTS, ROOT);
  assert.ok(c.errors.some((e) => e.includes('weekly_report_send_enabled')), c.errors.join('\n'));
  assert.ok(c.errors.some((e) => e.includes('actuals_import_enabled')), c.errors.join('\n'));
});

test('four-eyes keys are classified as four_eyes and never in the direct patch', () => {
  const b = ftp.build(ROOT);
  const fe = b.rows.filter((r) => r.action === 'four_eyes').map((r) => r.key);
  assert.ok(fe.includes('dashkey_scope_mode') && fe.includes('authz_capability_mode'), fe.join(','));
});

test('--apply is refused on a production-looking name, without the confirm flag, without a URL and under NODE_ENV=production', () => {
  const base = { apply: true, confirm: true, dbUrl: 'postgres://u:p@localhost:5432/sdp_dashboard' };
  assert.match(ftp.refusal(base, {}), /does not look like a TEST database/);
  assert.match(ftp.refusal({ ...base, dbUrl: 'postgres://u:p@localhost/sdp_test_x', confirm: false }, {}), /i-confirm-test-database/);
  assert.match(ftp.refusal({ ...base, dbUrl: '' }, {}), /needs --db-url/);
  assert.match(ftp.refusal({ ...base, dbUrl: 'postgres://u:p@localhost/sdp_test_x' }, { NODE_ENV: 'production' }), /production/);
  assert.strictEqual(ftp.refusal({ ...base, dbUrl: 'postgres://u:p@localhost/sdp_test_x' }, {}), null);
  assert.strictEqual(ftp.refusal({ apply: false }, {}), null);
});

function runCli(args, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  delete env.NODE_OPTIONS;   // the child must not provision a second throwaway database
  return spawnSync(process.execPath, [path.join(ROOT, 'tools', 'release', 'final-test-profile.js'), ...args], { env, encoding: 'utf8', timeout: 120000 });
}

test('the CLI is a dry run by default and refuses --apply on a production-looking database before connecting', () => {
  const dry = runCli([]);
  assert.strictEqual(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /dry run/);
  const prod = runCli(['--apply', '--db-url=postgres://u:p@127.0.0.1:1/sdp_dashboard', '--i-confirm-test-database']);
  assert.strictEqual(prod.status, 2);
  assert.match(prod.stderr, /does not look like a TEST database/);
  const noFlag = runCli(['--apply', '--db-url=postgres://u:p@127.0.0.1:1/sdp_test_x']);
  assert.strictEqual(noFlag.status, 2);
  assert.match(noFlag.stderr, /i-confirm-test-database/);
});

test('on a throwaway TEST database, --apply writes the direct keys, leaves four-eyes keys alone and logs one audit row', async (t) => {
  const url = process.env.PG_URL;
  if (!url || !ftp.TEST_DB.test(ftp.dbNameOf(url))) { t.skip('no throwaway TEST database'); return; }
  const r = runCli(['--apply', `--db-url=${url}`, '--i-confirm-test-database']);
  assert.strictEqual(r.status, 0, r.stderr + r.stdout);
  const { Client } = require('pg');
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const rows = (await c.query("SELECT key, value FROM report_config WHERE key IN ('commitments_enabled','wan_timeup_loss_pct','dashkey_scope_mode','authz_capability_mode')")).rows;
    const v = Object.fromEntries(rows.map((x) => [x.key, x.value]));
    assert.strictEqual(v.commitments_enabled, '1');
    assert.strictEqual(v.wan_timeup_loss_pct, '5');
    assert.notStrictEqual(v.dashkey_scope_mode, 'shadow');
    assert.notStrictEqual(v.authz_capability_mode, 'shadow');
    const log = (await c.query("SELECT details FROM system_log WHERE action = 'ai_proposal_test_profile_applied'")).rows;
    assert.strictEqual(log.length, 1);
    assert.match(String(log[0].details), /AI proposal applied for final test/);
  } finally { await c.end(); }
});
