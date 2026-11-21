'use strict';
// P11 round 8 — audit / operations fixes (fix 36, AI-written; ADR docs/ai-decisions/ADR-P11-R8-anchor-rotation-resume.md):
//  R8-A2 / O-11 / R8-4  the nightly key-rotation resume never turns a truncated ledger into ok, and never resumes to an
//                       anchor signed under a key id this deployment never signed with ("unknown key id");
//  O-12                 a database hardened before migration 137 (no kid column) names the remedy;
//  R8-A1                a Policy Center request filed as source='cli' needs verifiable operator-token evidence;
//  O-13                 the restore drill only trusts a counts file that belongs to the dump (sha256 + size);
//  O-5 residual         a blocking performance-budget check needs a minimum sample count per class.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');

const KEY_A = 'r8-fix36-config-key-A-0123456789abcdef';
const KEY_B = 'r8-fix36-config-key-B-fedcba9876543210';

async function reset(n) {
  const rdb = require('../reports-db'); const db = rdb.pgHandle(); const AC = require('../services/auditChain');
  await db.exec('ALTER TABLE audit_chain_anchors DISABLE TRIGGER audit_chain_anchors_no_truncate');
  try { await require('./_pg-fresh').truncate(['minutes_history', 'audit_chain_anchors', 'system_log']); }
  finally { await db.exec('ALTER TABLE audit_chain_anchors ENABLE TRIGGER audit_chain_anchors_no_truncate'); }
  for (let i = 1; i <= n; i++) await db.prepare("INSERT INTO minutes_history (session_id, action, actor_id, at, reason) VALUES (1, 'accepted', 1, ?, ?)").run(`2026-11-0${i}T10:00:00Z`, 'x' + i);
  return { rdb, db, AC, real: (await db.prepare('SELECT current_schema() AS s').get()).s };
}
const mh = (v) => v.tables.find((x) => x.table === 'minutes_history');
async function withEnv(vars, fn) {
  const saved = {}; for (const k of Object.keys(vars)) { saved[k] = process.env[k]; if (vars[k] == null) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return await fn(); } finally { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}
async function deleteTail(db) {
  await db.exec('ALTER TABLE minutes_history DISABLE TRIGGER minutes_history_append_only');
  try { await db.exec('DELETE FROM minutes_history WHERE id = (SELECT max(id) FROM minutes_history)'); }
  finally { await db.exec('ALTER TABLE minutes_history ENABLE TRIGGER minutes_history_append_only'); }
}
async function deleteAllAnchors(db) {
  await db.exec('ALTER TABLE audit_chain_anchors DISABLE TRIGGER audit_chain_anchors_append_only');
  try { await db.exec('DELETE FROM audit_chain_anchors'); }
  finally { await db.exec('ALTER TABLE audit_chain_anchors ENABLE TRIGGER audit_chain_anchors_append_only'); }
}
async function insertAnchorsFor(db, real, v, kid) {
  for (const x of v.tables) {
    if (x.rows == null) continue;
    await db.prepare('INSERT INTO audit_chain_anchors (table_name, schema_name, last_id, head, row_count, sig, kid) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(x.table, real, x.last_id, x.head, x.rows, 'f'.repeat(64), kid);
  }
}
const rotEvents = async (db) => Number((await db.prepare("SELECT COUNT(*) AS n FROM system_log WHERE action = 'audit_chain_key_rotated'").get()).n);

// ── R8-A2 / O-11 / R8-4 ─────────────────────────────────────────────────────────────────────────────────────────────
test('R8-A2: tail delete + ALL anchors deleted + made-up-kid anchors → never resumed, never ok (broken from the logged position)', async () => {
  const { rdb, db, AC, real } = await reset(3);
  await withEnv({ SDP_CONFIG_KEY: KEY_A, SDP_LEDGER_SCHEMA: null }, async () => {
    await AC.nightly(rdb);
    await deleteTail(db);
    await deleteAllAnchors(db);
    await insertAnchorsFor(db, real, await AC.verify(db, { anchors: false }), 'deadbeefdeadbeef');
    const v = await AC.verify(db);
    assert.equal(v.ok, false);
    assert.equal(v.status, 'broken', 'the position logged by the nightly job (3 rows) still constrains the 2-row ledger');
    assert.match(mh(v).anchor_error, /row count shrank from 3 .* to 2/);
    assert.equal(v.key_rotated, undefined);
    await assert.rejects(AC.nightly(rdb), /audit chain broken/);
    assert.equal(await rotEvents(db), 0, 'no rotation event, no re-anchor');
    assert.equal((await AC.verify(db)).ok, false);
  });
});

test('R8-A2: same attack with system_log scrubbed too → "unknown key id", unverifiable, the job does not resume', async () => {
  const { rdb, db, AC, real } = await reset(3);
  await withEnv({ SDP_CONFIG_KEY: KEY_A, SDP_LEDGER_SCHEMA: null }, async () => {
    await AC.nightly(rdb);
    await deleteTail(db);
    await deleteAllAnchors(db);
    await db.exec('DELETE FROM system_log');
    await insertAnchorsFor(db, real, await AC.verify(db, { anchors: false }), 'deadbeefdeadbeef');
    const v = await AC.verify(db);
    assert.equal(v.ok, false); assert.equal(v.status, 'unverifiable');
    assert.equal(v.key_rotated, undefined, 'an unknown kid is not a rotation');
    assert.match(mh(v).error, /unknown key id/);
    assert.deepEqual(mh(v).unknown_kids, ['deadbeefdeadbeef']);
    await assert.rejects(AC.nightly(rdb), /audit chain unverifiable: .*unknown key id/);
    assert.equal(await rotEvents(db), 0);
    assert.equal((await AC.verify(db)).ok, false, 'still never ok');
  });
});

test('O-11: a genuine rotation A→B with an app-written invented-kid row → unverifiable, no resume', async () => {
  const { rdb, db, AC, real } = await reset(3);
  await withEnv({ SDP_CONFIG_KEY: KEY_A, SDP_LEDGER_SCHEMA: null }, () => AC.nightly(rdb));
  await withEnv({ SDP_CONFIG_KEY: KEY_B, SDP_LEDGER_SCHEMA: null }, async () => {
    const live = mh(await AC.verify(db, { anchors: false }));
    await db.prepare('INSERT INTO audit_chain_anchors (table_name, schema_name, last_id, head, row_count, sig, kid) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('minutes_history', real, live.last_id, live.head, live.rows, 'e'.repeat(64), 'ffffffffffffffff');
    const v = await AC.verify(db);
    assert.equal(v.status, 'unverifiable'); assert.equal(v.key_rotated, undefined);
    assert.deepEqual(mh(v).unknown_kids, ['ffffffffffffffff']);
    await assert.rejects(AC.nightly(rdb), /unknown key id/);
    assert.equal(await rotEvents(db), 0);
  });
});

test('R8-A2 control: a genuine rotation (job signed under kid A, now key B) still resumes, and kid A is in the kid history', async () => {
  const { rdb, db, AC } = await reset(3);
  await withEnv({ SDP_CONFIG_KEY: KEY_A, SDP_LEDGER_SCHEMA: null }, () => AC.nightly(rdb));
  const kidA = AC.anchorKid(AC.anchorKey({ SDP_CONFIG_KEY: KEY_A }));
  assert.ok(await db.prepare('SELECT 1 AS ok FROM audit_chain_meta WHERE k = ?').get('kid:' + kidA), 'the job records the kid it signs with');
  const ev = await db.prepare("SELECT details FROM system_log WHERE action = 'audit_chain_anchor' ORDER BY id DESC LIMIT 1").get();
  assert.equal(JSON.parse(ev.details).kid, kidA);
  await withEnv({ SDP_CONFIG_KEY: KEY_B, SDP_LEDGER_SCHEMA: null }, async () => {
    const n = await AC.nightly(rdb);
    assert.ok(n.key_rotated && n.key_rotated.anchored >= 1);
    assert.equal(await rotEvents(db), 1);
    assert.equal((await AC.verify(db)).ok, true);
  });
});

test('R8-A2: a known prior kid cannot launder a truncation either (logged position constrains)', async () => {
  const { rdb, db, AC, real } = await reset(3);
  await withEnv({ SDP_CONFIG_KEY: KEY_A, SDP_LEDGER_SCHEMA: null }, () => AC.nightly(rdb));
  const kidA = AC.anchorKid(AC.anchorKey({ SDP_CONFIG_KEY: KEY_A }));
  await withEnv({ SDP_CONFIG_KEY: KEY_B, SDP_LEDGER_SCHEMA: null }, async () => {
    await deleteTail(db); await deleteAllAnchors(db);
    await insertAnchorsFor(db, real, await AC.verify(db, { anchors: false }), kidA);
    const v = await AC.verify(db);
    assert.equal(v.status, 'broken'); assert.match(mh(v).anchor_error, /row count shrank from 3/);
    await assert.rejects(AC.nightly(rdb), /audit chain broken/);
    assert.equal(await rotEvents(db), 0);
  });
});

// ── O-12 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('O-12: no kid column (hardened before migration 137) + rotation → unverifiable naming the hardening-script remedy', async () => {
  const { rdb, db, AC } = await reset(2);
  await withEnv({ SDP_CONFIG_KEY: KEY_A, SDP_LEDGER_SCHEMA: null }, () => AC.nightly(rdb));
  await db.exec('ALTER TABLE audit_chain_anchors RENAME COLUMN kid TO kid_r8_hidden');
  try {
    await withEnv({ SDP_CONFIG_KEY: KEY_B, SDP_LEDGER_SCHEMA: null }, async () => {
      const v = await AC.verify(db);
      assert.equal(v.status, 'unverifiable');
      assert.match(v.anchor_error, /no kid column .*re-run tools\/pg\/harden-audit-grants\.sql/);
      await assert.rejects(AC.nightly(rdb), /harden-audit-grants\.sql/);
    });
  } finally { await db.exec('ALTER TABLE audit_chain_anchors RENAME COLUMN kid_r8_hidden TO kid'); }
});

// ── O-13 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('O-13 pure: a counts file is trusted only for ITS dump (name, sha256, size); otherwise ignored with the reason', async () => {
  const B = require('../services/backup');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r8counts-'));
  try {
    const dump = path.join(dir, 'sdp_dashboard_20260105T000000Z.sql.gz.enc');
    fs.writeFileSync(dump, Buffer.alloc(4096, 7));
    const dg = await B.fileDigest(dump);
    const write = (o) => fs.writeFileSync(B.countsFileFor(dump), JSON.stringify({ snapshot: true, counts: { users: 1 }, ...o }));
    write({ dump: path.basename(dump), dump_sha256: dg.sha256, dump_bytes: dg.bytes });
    let r = await B.dumpCountsFor(dump); assert.equal(r.problem, null); assert.deepEqual(r.counts.counts, { users: 1 });
    write({ dump: 'sdp_dashboard_20260101T000000Z.sql.gz.enc', dump_sha256: dg.sha256, dump_bytes: dg.bytes });
    r = await B.dumpCountsFor(dump); assert.equal(r.counts, null); assert.match(r.problem, /names dump sdp_dashboard_20260101/);
    write({ dump: path.basename(dump), dump_sha256: dg.sha256, dump_bytes: dg.bytes + 1 });
    r = await B.dumpCountsFor(dump); assert.equal(r.counts, null); assert.match(r.problem, /bytes/);
    write({ dump: path.basename(dump), dump_sha256: '0'.repeat(64), dump_bytes: dg.bytes });
    r = await B.dumpCountsFor(dump); assert.equal(r.counts, null); assert.match(r.problem, /another sha256/);
    write({ dump: path.basename(dump) });
    r = await B.dumpCountsFor(dump); assert.ok(r.counts); assert.equal(r.unbound, true, 'a pre-fix counts file is flagged as unbound');
    fs.unlinkSync(B.countsFileFor(dump));
    r = await B.dumpCountsFor(dump); assert.deepEqual([r.counts, r.problem], [null, null]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const { provisionTestDb, dropTestDb } = require('./pg-helpers');
test('O-13: the backup binds the counts file to its dump and copies it off-site with the dump; a mismatched one is ignored by the drill', async (t) => {
  const ctx = await provisionTestDb();
  if (!ctx || ctx.schema) { t.skip(ctx ? 'needs a throwaway DATABASE (PG_ADMIN_URL with CREATEDB) to dump cleanly' : 'PostgreSQL unreachable'); return; }
  const { Client } = require('pg');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r8bk-'));
  const c = new Client({ connectionString: ctx.url }); await c.connect();
  try {
    await c.query('CREATE TABLE system_log (id bigserial primary key, ts text, category text, action text, actor text, actor_id int, target text, details text, ip text, risk int); CREATE TABLE users (id serial primary key, name text)');
    await c.query("INSERT INTO users (name) VALUES ('a'), ('b')");
    const B = require('../services/backup');
    const env = { ...process.env, PG_URL: ctx.url, PG_ADMIN_URL: ctx.adminUrl, SDP_BACKUP_KEY: 'r8-offsite-backup-passphrase-2026' };
    const off = path.join(tmp, 'offsite');
    const out = await B.runBackup({ dir: path.join(tmp, 'local'), env, offsitePath: off, blobs: false, log: () => {} });
    const side = JSON.parse(fs.readFileSync(B.countsFileFor(out.file), 'utf8'));
    const dg = await B.fileDigest(out.file);
    assert.deepEqual([side.dump_sha256, side.dump_bytes], [dg.sha256, dg.bytes], 'the counts file names the dump it was taken for');
    const offDump = path.join(off, path.basename(out.file));
    assert.ok(fs.existsSync(B.countsFileFor(offDump)), 'the counts file is copied off-site with its dump');
    assert.equal((await B.dumpCountsFor(offDump)).problem, null, 'a drill on the off-site copy uses the dump-time counts');
    // a counts file that belongs to another dump is ignored by the drill, which says so
    const other = JSON.parse(fs.readFileSync(B.countsFileFor(out.file), 'utf8'));
    fs.writeFileSync(B.countsFileFor(out.file), JSON.stringify({ ...other, dump_sha256: 'f'.repeat(64) }));
    const drill = require('../tools/pg/restore-drill');
    const res = await drill.run({ env, dir: path.join(tmp, 'local'), dumpFile: out.file, blobRoot: path.join(tmp, 'noblobs'), reportDir: path.join(tmp, 'r'), noLog: true, log: () => {}, actor: 'test' });
    const rep = fs.readFileSync(res.reportFile, 'utf8');
    assert.match(rep, /counts file next to this dump was IGNORED: the counts file was written for a dump with another sha256/);
    assert.match(rep, /live counts/);
  } finally { await c.end(); await dropTestDb(ctx); fs.rmSync(tmp, { recursive: true, force: true }); }
});

// ── O-5 residual ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('O-5 residual: blocking budget check refuses classes measured with fewer than the minimum samples (n = 1 is not evidence)', () => {
  const P = require('../tools/test/perf-budget-check');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r8perf-'));
  try {
    const budgets = { status: 'PROPOSED', api_route_classes: { page_data: { p95_ms: 1000 }, sync: { p95_ms: 1000 } } };
    fs.writeFileSync(path.join(dir, 'b.json'), JSON.stringify(budgets));
    fs.writeFileSync(path.join(dir, 'l.json'), JSON.stringify({ classes: { page_data: { n: 1, p95: 1 }, sync: { n: 1, p95: 1 } } }));
    const out = []; const args = ['--budgets=' + path.join(dir, 'b.json'), '--load=' + path.join(dir, 'l.json')];
    assert.equal(P.main(args, { PERF_BUDGETS_BLOCKING: '1' }, (s) => out.push(s)), 1, 'one sample per class is not a pass');
    assert.ok(out.some((s) => /fewer samples than the minimum .*page_data n=1 < 5/.test(s)));
    assert.equal(P.main(args, {}, () => {}), 0, 'warn mode stays a warning');
    assert.equal(P.check({ a: { n: 2, p95: 9 } }, { a: { p95_ms: 5 } })[0].status, 'over', 'an over-budget row stays over whatever n');
    fs.writeFileSync(path.join(dir, 'l.json'), JSON.stringify({ classes: { page_data: { n: 5, p95: 1 }, sync: { n: 7, p95: 1 } } }));
    assert.equal(P.main(args, { PERF_BUDGETS_BLOCKING: '1' }, () => {}), 0);
    assert.equal(JSON.parse(fs.readFileSync(P.BUDGETS, 'utf8')).min_samples_per_class, 5, 'the shipped figure is recorded (PROPOSED)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
