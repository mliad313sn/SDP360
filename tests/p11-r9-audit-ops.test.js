'use strict';
// P11 round 9 — audit / operations fixes (fix 39, AI-written; ADR docs/ai-decisions/ADR-P11-R9-signed-kid-history-anchor-events-request-origin.md):
//  O-14 / R9-2   the "known kid" list is no longer a plain audit_chain_meta row: a kid is known only through an
//                attestation signed with SDP_CONFIG_KEY (or the previous key, SDP_CONFIG_KEY_OLD). An app-role INSERT of
//                'kid:<x>' or of a garbage attestation never makes a kid known.
//  O-16          the system_log high-water mark only counts audit_chain_anchor events carrying a valid HMAC written by
//                the nightly job; an unsigned / altered event is ignored (and counted as ignored).
//  R9-A1         system_log audit_chain events: UPDATE refused, DELETE silently kept (migration 140 trigger).
//  R9-A4 / O-15 / R9-3  a counts file without its dump name or sha256 is ignored by the restore drill (live counts).
//  R9-A5         a non-numeric sample count is an insufficient sample, never "within".
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');

const KEY_A = 'r9-fix39-config-key-A-0123456789abcdef';
const KEY_B = 'r9-fix39-config-key-B-fedcba9876543210';
const KEY_C = 'r9-fix39-config-key-C-00112233445566778899';

async function reset(n) {
  const rdb = require('../reports-db'); const db = rdb.pgHandle(); const AC = require('../services/auditChain');
  await db.exec('ALTER TABLE audit_chain_anchors DISABLE TRIGGER audit_chain_anchors_no_truncate');
  try { await require('./_pg-fresh').truncate(['minutes_history', 'audit_chain_anchors', 'system_log']); }
  finally { await db.exec('ALTER TABLE audit_chain_anchors ENABLE TRIGGER audit_chain_anchors_no_truncate'); }
  await db.exec('ALTER TABLE audit_chain_meta DISABLE TRIGGER audit_chain_meta_append_only');
  try { await db.exec("DELETE FROM audit_chain_meta WHERE k LIKE 'kid%'"); }
  finally { await db.exec('ALTER TABLE audit_chain_meta ENABLE TRIGGER audit_chain_meta_append_only'); }
  for (let i = 1; i <= n; i++) await db.prepare("INSERT INTO minutes_history (session_id, action, actor_id, at, reason) VALUES (1, 'accepted', 1, ?, ?)").run(`2026-11-0${i}T10:00:00Z`, 'x' + i);
  return { rdb, db, AC, real: (await db.prepare('SELECT current_schema() AS s').get()).s };
}
const mh = (v) => v.tables.find((x) => x.table === 'minutes_history');
async function withEnv(vars, fn) {
  const saved = {}; for (const k of Object.keys(vars)) { saved[k] = process.env[k]; if (vars[k] == null) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return await fn(); } finally { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}
const rotEvents = async (db) => Number((await db.prepare("SELECT COUNT(*) AS n FROM system_log WHERE action = 'audit_chain_key_rotated'").get()).n);
const kidOf = (AC, secret) => AC.anchorKid(AC.anchorKey({ SDP_CONFIG_KEY: secret }));

// ── O-14 / R9-2 ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('O-14: an app-role INSERT of kid:<forged> (and of a garbage attestation) never makes a forged anchor kid "known"', async () => {
  const { rdb, db, AC, real } = await reset(3);
  await withEnv({ SDP_CONFIG_KEY: KEY_A, SDP_CONFIG_KEY_OLD: null, SDP_LEDGER_SCHEMA: null }, async () => {
    await AC.nightly(rdb);
    const live = mh(await AC.verify(db, { anchors: false }));
    await db.prepare('INSERT INTO audit_chain_anchors (table_name, schema_name, last_id, head, row_count, sig, kid) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('minutes_history', real, live.last_id, live.head, live.rows, 'f'.repeat(64), 'deadbeefdeadbeef');
    await db.prepare("INSERT INTO audit_chain_meta (k, v) VALUES ('kid:deadbeefdeadbeef', 'attacker') ON CONFLICT (k) DO NOTHING").run();
    await db.prepare('INSERT INTO audit_chain_meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO NOTHING').run(`kidatt:deadbeefdeadbeef:${kidOf(AC, KEY_A)}:${'0'.repeat(64)}`, 'attacker');
    const v = await AC.verify(db);
    assert.equal(v.status, 'unverifiable'); assert.equal(v.key_rotated, undefined, 'a meta row written with the database login is not a rotation');
    assert.deepEqual(mh(v).unknown_kids, ['deadbeefdeadbeef']);
    assert.ok(v.evidence_ignored && v.evidence_ignored.kid_rows >= 2, 'the unsigned / invalid kid rows are counted as ignored');
    await assert.rejects(AC.nightly(rdb), /unknown key id/);
    assert.equal(await rotEvents(db), 0);
  });
});

test('O-14: a genuine rotation A→B without the previous key is unverifiable and names the remedy (SDP_CONFIG_KEY_OLD or the accept tool)', async () => {
  const { rdb, db, AC } = await reset(3);
  await withEnv({ SDP_CONFIG_KEY: KEY_A, SDP_CONFIG_KEY_OLD: null, SDP_LEDGER_SCHEMA: null }, () => AC.nightly(rdb));
  const kidA = kidOf(AC, KEY_A);
  const att = await db.prepare("SELECT k FROM audit_chain_meta WHERE k LIKE 'kidatt:%'").all();
  assert.ok(att.some((r) => r.k.startsWith(`kidatt:${kidA}:${kidA}:`)), 'the job writes a SIGNED self-attestation of its kid');
  assert.ok(!att.some((r) => r.k === 'kid:' + kidA) && !(await db.prepare('SELECT 1 AS ok FROM audit_chain_meta WHERE k = ?').get('kid:' + kidA)), 'no unsigned kid: row any more');
  await withEnv({ SDP_CONFIG_KEY: KEY_B, SDP_CONFIG_KEY_OLD: null, SDP_LEDGER_SCHEMA: null }, async () => {
    const v = await AC.verify(db);
    assert.equal(v.status, 'unverifiable'); assert.deepEqual(mh(v).unknown_kids, [kidA]);
    assert.match(mh(v).error, /SDP_CONFIG_KEY_OLD/); assert.match(mh(v).error, /audit-chain-accept-rotation/);
    await assert.rejects(AC.nightly(rdb), /unknown key id/);
    // the documented operator step without the old key: a human decision taken with the CURRENT key
    const tool = require('../tools/pg/audit-chain-accept-rotation');
    await assert.rejects(tool.acceptRotation(db, { kid: kidA, env: process.env }), /--i-confirm-documented-rotation/);
    const out = await tool.acceptRotation(db, { kid: kidA, env: process.env, confirm: true, who: 'test operator' });
    assert.equal(out.attested, kidA);
    const n = await AC.nightly(rdb);
    assert.ok(n.key_rotated && n.key_rotated.anchored >= 1);
    assert.equal((await AC.verify(db)).ok, true);
  });
});

test('O-14: rotation A→B with SDP_CONFIG_KEY_OLD=A resumes (old anchors verified with the old key), and B→C with OLD=B resumes too (chain)', async () => {
  const { rdb, db, AC } = await reset(3);
  await withEnv({ SDP_CONFIG_KEY: KEY_A, SDP_CONFIG_KEY_OLD: null, SDP_LEDGER_SCHEMA: null }, () => AC.nightly(rdb));
  await withEnv({ SDP_CONFIG_KEY: KEY_B, SDP_CONFIG_KEY_OLD: KEY_A, SDP_LEDGER_SCHEMA: null }, async () => {
    const n = await AC.nightly(rdb);
    assert.ok(n.key_rotated && n.key_rotated.anchored >= 1);
    assert.equal((await AC.verify(db)).ok, true);
  });
  const kidA = kidOf(AC, KEY_A); const kidB = kidOf(AC, KEY_B);
  assert.ok(await db.prepare("SELECT 1 AS ok FROM audit_chain_meta WHERE k LIKE ?").get(`kidatt:${kidA}:${kidB}:%`), 'B attests A (rotation entry signed with B)');
  await withEnv({ SDP_CONFIG_KEY: KEY_C, SDP_CONFIG_KEY_OLD: KEY_B, SDP_LEDGER_SCHEMA: null }, async () => {
    const n = await AC.nightly(rdb);
    assert.ok(n.key_rotated);
    assert.equal((await AC.verify(db)).ok, true);
  });
  const kidC = kidOf(AC, KEY_C);
  assert.ok(await db.prepare("SELECT 1 AS ok FROM audit_chain_meta WHERE k LIKE ?").get(`kidatt:${kidA}:${kidC}:%`), 'C re-attests A through B (transitive chain)');
});

test('O-14: with SDP_CONFIG_KEY_OLD set, an anchor row claiming the old kid but carrying a wrong signature is forged (broken)', async () => {
  const { rdb, db, AC, real } = await reset(3);
  await withEnv({ SDP_CONFIG_KEY: KEY_A, SDP_CONFIG_KEY_OLD: null, SDP_LEDGER_SCHEMA: null }, () => AC.nightly(rdb));
  const kidA = kidOf(AC, KEY_A);
  await withEnv({ SDP_CONFIG_KEY: KEY_B, SDP_CONFIG_KEY_OLD: KEY_A, SDP_LEDGER_SCHEMA: null }, async () => {
    const live = mh(await AC.verify(db, { anchors: false }));
    await db.prepare('INSERT INTO audit_chain_anchors (table_name, schema_name, last_id, head, row_count, sig, kid) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('minutes_history', real, live.last_id, live.head, live.rows, 'e'.repeat(64), kidA);
    const v = await AC.verify(db);
    assert.equal(v.status, 'broken'); assert.match(mh(v).anchor_error, /not signed by the nightly job/);
    await assert.rejects(AC.nightly(rdb), /audit chain broken/);
    assert.equal(await rotEvents(db), 0);
  });
});

// ── O-16 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('O-16: one forged (unsigned) audit_chain_anchor event with inflated rows no longer breaks the chain at the next rotation', async () => {
  const { rdb, db, AC } = await reset(3);
  await withEnv({ SDP_CONFIG_KEY: KEY_A, SDP_CONFIG_KEY_OLD: null, SDP_LEDGER_SCHEMA: null }, () => AC.nightly(rdb));
  const live = mh(await AC.verify(db, { anchors: false, key: null }));
  await rdb.logEvent({ category: 'governance', action: 'audit_chain_anchor', target: 'audit', details: { schema: null, anchored: 1, signed_written: 1, status: 'ok',
    tables: [{ table: 'minutes_history', rows: live.rows + 500, ok: true, head: live.head, last_id: live.last_id }] } });
  // a signed event whose figures were altered afterwards is ignored too
  const good = await db.prepare("SELECT details FROM system_log WHERE action = 'audit_chain_anchor' AND details LIKE '%hwm_sig%' ORDER BY id LIMIT 1").get();
  assert.ok(good, 'the job signs its anchor event');
  const altered = JSON.parse(good.details); altered.tables.find((x) => x.table === 'minutes_history').rows += 700;
  await rdb.logEvent({ category: 'governance', action: 'audit_chain_anchor', target: 'audit', details: altered });
  await withEnv({ SDP_CONFIG_KEY: KEY_B, SDP_CONFIG_KEY_OLD: KEY_A, SDP_LEDGER_SCHEMA: null }, async () => {
    const v = await AC.verify(db);
    assert.notEqual(v.status, 'broken', 'the forged figures are not trusted');
    assert.ok(v.evidence_ignored.log_events >= 2, 'the forged / altered events are reported as ignored');
    const n = await AC.nightly(rdb);
    assert.ok(n.key_rotated);
    assert.equal((await AC.verify(db)).ok, true);
  });
});

test('O-16 control: the job\'s own signed event still constrains a truncated ledger after its anchors are deleted', async () => {
  const { rdb, db, AC, real } = await reset(3);
  await withEnv({ SDP_CONFIG_KEY: KEY_A, SDP_CONFIG_KEY_OLD: null, SDP_LEDGER_SCHEMA: null }, async () => {
    await AC.nightly(rdb);
    await db.exec('ALTER TABLE minutes_history DISABLE TRIGGER minutes_history_append_only');
    try { await db.exec('DELETE FROM minutes_history WHERE id = (SELECT max(id) FROM minutes_history)'); } finally { await db.exec('ALTER TABLE minutes_history ENABLE TRIGGER minutes_history_append_only'); }
    await db.exec('ALTER TABLE audit_chain_anchors DISABLE TRIGGER audit_chain_anchors_append_only');
    try { await db.exec('DELETE FROM audit_chain_anchors'); } finally { await db.exec('ALTER TABLE audit_chain_anchors ENABLE TRIGGER audit_chain_anchors_append_only'); }
    const v0 = await AC.verify(db, { anchors: false });
    for (const x of v0.tables) if (x.rows != null) await db.prepare('INSERT INTO audit_chain_anchors (table_name, schema_name, last_id, head, row_count, sig, kid) VALUES (?, ?, ?, ?, ?, ?, ?)').run(x.table, real, x.last_id, x.head, x.rows, 'f'.repeat(64), 'deadbeefdeadbeef');
    const v = await AC.verify(db);
    assert.equal(v.status, 'broken'); assert.match(mh(v).anchor_error, /row count shrank from 3/);
  });
});

// ── R9-A1 (migration 140) ───────────────────────────────────────────────────────────────────────────────────────────
test('R9-A1: system_log audit_chain events cannot be updated; a DELETE leaves them in place (other rows still purge)', async () => {
  const { rdb, db } = await reset(1);
  await rdb.logEvent({ category: 'governance', action: 'audit_chain_anchor', target: 'audit', details: { anchored: 1 } });
  await rdb.logEvent({ category: 'system', action: 'r9_ordinary', target: 'x' });
  await assert.rejects(db.exec("UPDATE system_log SET details = '{}' WHERE action = 'audit_chain_anchor'"), /append-only/);
  await assert.rejects(db.exec("UPDATE system_log SET action = 'audit_chain_anchor' WHERE action = 'r9_ordinary'"), /append-only/);
  await db.exec("DELETE FROM system_log WHERE action LIKE 'audit_chain%' OR action = 'r9_ordinary'");
  assert.equal(Number((await db.prepare("SELECT COUNT(*) AS n FROM system_log WHERE action = 'audit_chain_anchor'").get()).n), 1, 'kept');
  assert.equal(Number((await db.prepare("SELECT COUNT(*) AS n FROM system_log WHERE action = 'r9_ordinary'").get()).n), 0, 'ordinary rows still delete');
});

// ── R9-A4 / O-15 / R9-3 ─────────────────────────────────────────────────────────────────────────────────────────────
test('R9-A4: a counts file without its dump name or without a sha256 is IGNORED (never "unbound"), with the reason', async () => {
  const B = require('../services/backup');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r9counts-'));
  try {
    const dump = path.join(dir, 'sdp_dashboard_20260105T000000Z.sql.gz.enc');
    fs.writeFileSync(dump, Buffer.alloc(2048, 3));
    const dg = await B.fileDigest(dump);
    const write = (o) => fs.writeFileSync(B.countsFileFor(dump), JSON.stringify({ snapshot: true, counts: { users: 999 }, ...o }));
    write({});
    let r = await B.dumpCountsFor(dump); assert.equal(r.counts, null); assert.match(r.problem, /names no dump/); assert.equal(r.unbound, undefined);
    write({ dump: path.basename(dump) });
    r = await B.dumpCountsFor(dump); assert.equal(r.counts, null); assert.match(r.problem, /no sha256/);
    write({ dump: path.basename(dump), dump_sha256: '' });
    r = await B.dumpCountsFor(dump); assert.equal(r.counts, null); assert.match(r.problem, /no sha256/);
    write({ dump: path.basename(dump), dump_sha256: dg.sha256, dump_bytes: dg.bytes });
    r = await B.dumpCountsFor(dump); assert.equal(r.problem, null); assert.deepEqual(r.counts.counts, { users: 999 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  assert.ok(!/only its dump name was checked/.test(fs.readFileSync(path.join(__dirname, '..', 'tools', 'pg', 'restore-drill.js'), 'utf8')), 'the false "name was checked" note is gone');
});

// ── R9-A5 ───────────────────────────────────────────────────────────────────────────────────────────────────────────
test('R9-A5: a non-numeric sample count is insufficient_sample, never within', () => {
  const P = require('../tools/test/perf-budget-check');
  for (const n of ['x', 'NaN', {}, true]) assert.equal(P.check({ c: { p95: 10, n } }, { c: { p95_ms: 100 } })[0].status, 'insufficient_sample', `n=${JSON.stringify(n)}`);
  assert.equal(P.check({ c: { p95: 10, n: 7 } }, { c: { p95_ms: 100 } })[0].status, 'within');
  assert.equal(P.check({ c: { p95: 10, n: 1 } }, { c: { p95_ms: 100 } })[0].status, 'insufficient_sample');
});
