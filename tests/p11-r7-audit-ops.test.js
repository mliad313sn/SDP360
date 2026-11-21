'use strict';
// P11 round 7 — audit / operations fixes (fix 33, AI-written; ADR docs/ai-decisions/ADR-P11-R7-anchor-kid-token-binding.md):
//  O-8 / F-32  signed anchors survive an SDP_CONFIG_KEY rotation or a restore onto another key (key identifier per row:
//              unverifiable "key rotated", never "forged"; the nightly job resumes the chain), and signed anchors with no
//              key configured are "unverifiable", never ok;
//  R7-A2       a shadow schema with an empty anchor table, or a dropped sig column after signed anchors, no longer
//              verifies ok;
//  R7-A1       an operator token INSERTed with the application database login (no server-side binding) is refused,
//              and so is a token with no issuance event; no SDP_CONFIG_KEY → the token flow is refused (fail closed);
//  O-7         the restore drill compares the restored copy with counts taken IN THE DUMP'S OWN SNAPSHOT, so writes
//              during the drill no longer make a healthy backup fail;
//  R6-A3 gap   the gate-dossier check also hashes the local require() closure of each cited script;
//  O-5         a blocking performance-budget check fails when some budget classes have no sample.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');

const KEY_A = 'r7-fix33-config-key-A-0123456789abcdef';
const KEY_B = 'r7-fix33-config-key-B-fedcba9876543210';

async function reset(n) {
  const rdb = require('../reports-db'); const db = rdb.pgHandle(); const AC = require('../services/auditChain');
  await db.exec('ALTER TABLE audit_chain_anchors DISABLE TRIGGER audit_chain_anchors_no_truncate');
  try { await require('./_pg-fresh').truncate(['minutes_history', 'audit_chain_anchors', 'system_log']); }
  finally { await db.exec('ALTER TABLE audit_chain_anchors ENABLE TRIGGER audit_chain_anchors_no_truncate'); }
  await db.exec('ALTER TABLE audit_chain_meta DISABLE TRIGGER audit_chain_meta_append_only');
  try { await db.exec("DELETE FROM audit_chain_meta WHERE k = 'signed_anchors'"); } finally { await db.exec('ALTER TABLE audit_chain_meta ENABLE TRIGGER audit_chain_meta_append_only'); }
  for (let i = 1; i <= n; i++) await db.prepare("INSERT INTO minutes_history (session_id, action, actor_id, at, reason) VALUES (1, 'accepted', 1, ?, ?)").run(`2026-11-0${i}T10:00:00Z`, 'x' + i);
  return { rdb, db, AC, real: (await db.prepare('SELECT current_schema() AS s').get()).s };
}
const mh = (v) => v.tables.find((x) => x.table === 'minutes_history');
async function withEnv(vars, fn) {
  const saved = {}; for (const k of Object.keys(vars)) { saved[k] = process.env[k]; if (vars[k] == null) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return await fn(); } finally { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}
const clientDb = (c) => ({ prepare: (sql) => { let i = 0; const q = sql.replace(/\?/g, () => '$' + (++i)); return {
  get: async (...p) => (await c.query(q, p)).rows[0], all: async (...p) => (await c.query(q, p)).rows, run: async (...p) => c.query(q, p) }; } });

// ── O-8 / F-32 ───────────────────────────────────────────────────────────────────────────────────────────────────────
test('O-8: after an SDP_CONFIG_KEY rotation the nightly job records the rotation and resumes the chain (never "forged")', async () => {
  const { rdb, db, AC } = await reset(3);
  await withEnv({ SDP_CONFIG_KEY: KEY_A, SDP_LEDGER_SCHEMA: null }, async () => {
    await AC.nightly(rdb); await AC.nightly(rdb);
    assert.equal((await AC.verify(db)).ok, true);
  });
  const kidA = (await db.prepare("SELECT kid FROM audit_chain_anchors WHERE table_name = 'minutes_history' ORDER BY id DESC LIMIT 1").get()).kid;
  assert.match(String(kidA), /^[0-9a-f]{16}$/, 'each anchor records the key identifier, never the key');
  await withEnv({ SDP_CONFIG_KEY: KEY_B, SDP_LEDGER_SCHEMA: null }, async () => {
    const before = await AC.verify(db);
    assert.equal(before.ok, false, 'old-key anchors cannot be verified with the new key');
    assert.equal(before.status, 'unverifiable', 'unverifiable, not broken');
    assert.ok(!/forged or altered|"forged":\[\d/.test(JSON.stringify(before)), 'never reported as forged');
    assert.equal(before.key_rotated, true);
    assert.match(mh(before).error, /key rotated/);
    const night3 = await AC.nightly(rdb);                                 // does not throw any more
    assert.ok(night3.key_rotated && night3.key_rotated.anchored >= 1);
    const ev = await db.prepare("SELECT details FROM system_log WHERE action = 'audit_chain_key_rotated' ORDER BY id DESC LIMIT 1").get();
    assert.ok(ev, 'the rotation is recorded in system_log');
    const d = JSON.parse(ev.details); assert.deepEqual(d.from_kids, [kidA]); assert.equal(d.to_kid, AC.anchorKid(AC.anchorKey()));
    const night4 = await AC.nightly(rdb);
    assert.equal(night4.key_rotated, undefined, 'the next night is an ordinary ok run');
    const after = await AC.verify(db);
    assert.equal(after.ok, true); assert.equal(after.anchor_integrity, 'signed');
  });
});

test('O-8: a tail delete hidden behind a "rotation" is still caught — old-key anchors keep constraining the chain', async () => {
  const { rdb, db, AC } = await reset(3);
  await withEnv({ SDP_CONFIG_KEY: KEY_A, SDP_LEDGER_SCHEMA: null }, () => AC.nightly(rdb));
  await db.exec('ALTER TABLE minutes_history DISABLE TRIGGER minutes_history_append_only');
  try { await db.exec('DELETE FROM minutes_history WHERE id = (SELECT max(id) FROM minutes_history)'); }
  finally { await db.exec('ALTER TABLE minutes_history ENABLE TRIGGER minutes_history_append_only'); }
  await withEnv({ SDP_CONFIG_KEY: KEY_B, SDP_LEDGER_SCHEMA: null }, async () => {
    const v = await AC.verify(db);
    assert.equal(v.status, 'broken'); assert.equal(v.key_rotated, undefined);
    assert.match(mh(v).anchor_error, /row count shrank|is gone/);
    await assert.rejects(AC.nightly(rdb), /audit chain broken/);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM system_log WHERE action = 'audit_chain_key_rotated'").get()).n, 0, 'no re-anchor over a shortened chain');
  });
  // a forged anchor under a made-up key identifier cannot lower the baseline either
  const { db: db2, AC: AC2, real } = await reset(3);
  const key = AC2.anchorKey({ SDP_CONFIG_KEY: KEY_A });
  await AC2.recordAnchors(db2, await AC2.verify(db2, { key }), { key });
  await db2.exec('ALTER TABLE minutes_history DISABLE TRIGGER minutes_history_append_only');
  try { await db2.exec('DELETE FROM minutes_history WHERE id = (SELECT max(id) FROM minutes_history)'); }
  finally { await db2.exec('ALTER TABLE minutes_history ENABLE TRIGGER minutes_history_append_only'); }
  const live = mh(await AC2.verify(db2, { key, anchors: false }));
  await db2.prepare('INSERT INTO audit_chain_anchors (table_name, schema_name, last_id, head, row_count, sig, kid) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('minutes_history', real, live.last_id, live.head, live.rows, 'a'.repeat(64), '0123456789abcdef');
  assert.equal((await AC2.verify(db2, { key })).status, 'broken');
});

test('F-32: restored onto a server with ANOTHER key → unverifiable "key rotated" (not forged); NO key → unverifiable, never ok', async () => {
  const { db, AC } = await reset(2);
  const kA = AC.anchorKey({ SDP_CONFIG_KEY: KEY_A }); const kB = AC.anchorKey({ SDP_CONFIG_KEY: KEY_B });
  await AC.recordAnchors(db, await AC.verify(db, { key: kA }), { key: kA });
  const other = await AC.verify(db, { key: kB });
  assert.equal(other.status, 'unverifiable'); assert.equal(other.key_rotated, true);
  assert.ok(!/forged or altered/.test(JSON.stringify(other)));
  const none = await AC.verify(db, { key: null });
  assert.equal(none.ok, false); assert.equal(none.status, 'unverifiable');
  assert.match(none.anchor_integrity, /signed anchors present, no SDP_CONFIG_KEY/);
  assert.equal(none.key_rotated, undefined, 'no key is not a rotation: the nightly job must not re-anchor unsigned');
  assert.equal((await AC.verify(db, { key: kA })).ok, true, 'the original key still verifies');
});

test('O-8 pure: another kid = foreign (key rotated), the current kid with a bad signature = forged', () => {
  const AC = require('../services/auditChain');
  const kA = AC.anchorKey({ SDP_CONFIG_KEY: KEY_A }); const kB = AC.anchorKey({ SDP_CONFIG_KEY: KEY_B });
  const row = (id, n, key, extra = {}) => { const r = { id, table_name: 't', schema_name: 's', last_id: n, head: 'h' + n, row_count: n }; r.sig = AC.anchorSig(key, r); r.kid = AC.anchorKid(key); return { ...r, ...extra }; };
  let c = AC.chooseAnchor([row(1, 1, kA), row(2, 2, kA)], { key: kB, sigColumn: true, kidColumn: true });
  assert.deepEqual(c.forged, []); assert.equal(c.keyRotated, true); assert.equal(c.anchor, null, 'no row signed by the current key: no verified baseline'); assert.match(c.unverifiable, /key rotated/);
  c = AC.chooseAnchor([row(1, 1, kA), row(2, 2, kB), row(3, 3, kB)], { key: kB, sigColumn: true, kidColumn: true });
  assert.equal(c.keyRotated, false, 'resumed under the current key'); assert.equal(c.anchor.id, 3); assert.equal(c.integrity, 'signed');
  assert.deepEqual(c.foreign, [1]);
  c = AC.chooseAnchor([row(1, 1, kB), row(2, 2, kB, { sig: 'f'.repeat(64) })], { key: kB, sigColumn: true, kidColumn: true });
  assert.deepEqual(c.forged, [2]);
  assert.notEqual(AC.anchorKid(kA), AC.anchorKid(kB));
  assert.ok(!AC.anchorKid(kA).includes(KEY_A));
});

// ── R7-A2 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('R7-A2 (a): a search-path shadow WITH an empty anchor table is unverifiable, and an empty anchor table is not "signed"', async () => {
  const { db, AC, real } = await reset(3);
  const key = AC.anchorKey({ SDP_CONFIG_KEY: KEY_A });
  await AC.recordAnchors(db, await AC.verify(db, { key }), { key });
  const { Client } = require('pg');
  const sh = 'r7a2fix_' + process.pid;
  await db.exec(`CREATE SCHEMA ${sh}`);
  for (const t of AC.TABLES) await db.exec(`CREATE TABLE ${sh}.${t} (LIKE "${real}".${t} INCLUDING ALL)`);
  await db.exec(`CREATE TABLE ${sh}.audit_chain_anchors (LIKE "${real}".audit_chain_anchors INCLUDING ALL)`);
  const c = new Client({ connectionString: process.env.PG_URL, options: `-c search_path=${sh},${real}` }); await c.connect();
  try {
    await withEnv({ SDP_LEDGER_SCHEMA: null }, async () => {
      const v = await AC.verify(clientDb(c), { key });
      assert.equal(v.ok, false); assert.equal(v.status, 'unverifiable');
      assert.match(v.anchor_error, /several schemas of the search path/);
      assert.notEqual(v.anchor_integrity, 'signed', 'an empty anchor table is never labelled signed');
      // a fake migration marker in the shadow does not help: two schemas still hold the ledgers
      await db.exec(`CREATE TABLE ${sh}.audit_chain_meta (LIKE "${real}".audit_chain_meta INCLUDING ALL)`);
      await db.exec(`INSERT INTO ${sh}.audit_chain_meta (k, v) VALUES ('ledger_schema', '${sh}')`);
      assert.equal((await AC.verify(clientDb(c), { key })).ok, false);
    });
    // the shadow ALONE on the search path: the migration-time marker names another schema
    const c2 = new Client({ connectionString: process.env.PG_URL, options: `-c search_path=${sh}` }); await c2.connect();
    try {
      await db.exec(`DROP TABLE ${sh}.audit_chain_meta`);
      const v2 = await withEnv({ SDP_LEDGER_SCHEMA: null }, () => AC.verify(clientDb(c2), { key }));
      assert.equal(v2.ok, false); assert.match(v2.anchor_error, /audit_chain_meta .* missing/);
    } finally { await c2.end(); }
    // the operator pin still works
    const v3 = await withEnv({ SDP_LEDGER_SCHEMA: real }, () => AC.verify(db, { key }));
    assert.equal(v3.ok, true);
  } finally { await c.end(); await db.exec(`DROP SCHEMA ${sh} CASCADE`); }
});

test('R7-A2 (b): sig column dropped after signed anchors were written + a matching forged anchor → unverifiable, never ok', async () => {
  const { db, AC, real } = await reset(3);
  const key = AC.anchorKey({ SDP_CONFIG_KEY: KEY_A });
  await AC.recordAnchors(db, await AC.verify(db, { key }), { key });
  await db.exec('ALTER TABLE minutes_history DISABLE TRIGGER minutes_history_append_only');
  try { await db.exec('DELETE FROM minutes_history WHERE id = (SELECT max(id) FROM minutes_history)'); }
  finally { await db.exec('ALTER TABLE minutes_history ENABLE TRIGGER minutes_history_append_only'); }
  await db.exec('ALTER TABLE audit_chain_anchors DROP COLUMN sig');
  try {
    const live = mh(await AC.verify(db, { key, anchors: false }));
    await db.prepare('INSERT INTO audit_chain_anchors (table_name, schema_name, last_id, head, row_count) VALUES (?, ?, ?, ?, ?)').run('minutes_history', real, live.last_id, live.head, live.rows);
    const v = await AC.verify(db, { key });
    assert.equal(v.ok, false); assert.notEqual(v.status, 'ok');
    assert.match(v.anchor_integrity, /signature column removed/);
  } finally { await db.exec('ALTER TABLE audit_chain_anchors ADD COLUMN sig TEXT'); }
});

// ── R7-A1 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('R7-A1: a token INSERTed with the app database login (no binding) is refused; an issued one works once; no key → refused', async () => {
  const rdb = require('../reports-db'); const db = rdb.pgHandle(); const OT = require('../services/operatorTokens');
  const uname = 'r7a1_' + process.pid;
  try { await rdb.createUser({ username: uname, full_name: 'R7 A1', password: uname + 'pass1234', roles: ['super_admin'] }); } catch (_) { /* exists */ }
  const u = await db.prepare('SELECT id FROM users WHERE username = ?').get(uname);
  const user = { id: u.id, username: uname };
  await withEnv({ SDP_CONFIG_KEY: KEY_A }, async () => {
    // the round-7 forgery: a raw INSERT with a well-formed token
    const tok = OT.PREFIX + require('crypto').randomBytes(32).toString('base64url');
    await db.prepare("INSERT INTO operator_tokens (token_hash, user_id, username, purpose, expires_at) VALUES (?, ?, ?, 'activate-switches', now() + interval '10 minutes')").run(OT.hash(tok), user.id, user.username);
    const forged = await OT.check(db, tok);
    assert.ok(forged.refusal, 'forged token refused'); assert.match(forged.refusal, /not issued by the server/);
    // a forged binding (made-up HMAC) is refused too
    const tok2 = OT.PREFIX + require('crypto').randomBytes(32).toString('base64url');
    await db.prepare("INSERT INTO operator_tokens (token_hash, user_id, username, purpose, expires_at, binding) VALUES (?, ?, ?, 'activate-switches', now() + interval '10 minutes', ?)").run(OT.hash(tok2), user.id, user.username, 'b'.repeat(64));
    assert.match((await OT.check(db, tok2)).refusal, /not issued by the server/);
    // issued by the server but no issuance event in system_log → refused
    const iss = await OT.issue(db, user);
    assert.match((await OT.check(db, iss.token, { consume: false })).refusal, /no operator_token_issued event/);
    await rdb.logEvent({ category: 'config', action: 'operator_token_issued', target: user.username, details: { token_id: iss.id, expires_at: iss.expires_at, purpose: 'activate-switches' }, risk: 1 });
    const ok = await OT.check(db, iss.token);
    assert.equal(ok.user_id, Number(user.id)); assert.equal(ok.id, iss.id);
    assert.ok((await OT.check(db, iss.token)).refusal, 'a token works once');
    // the binding covers the account: re-pointing a bound row at another user breaks it
    const iss2 = await OT.issue(db, user);
    await rdb.logEvent({ category: 'config', action: 'operator_token_issued', target: user.username, details: { token_id: iss2.id }, risk: 1 });
    await db.prepare('UPDATE operator_tokens SET user_id = user_id + 1000 WHERE id = ?').run(iss2.id);
    assert.match((await OT.check(db, iss2.token)).refusal, /not issued by the server/);
  });
  await withEnv({ SDP_CONFIG_KEY: null }, async () => {
    await assert.rejects(OT.issue(db, user), /SDP_CONFIG_KEY/);
    const tok = OT.PREFIX + require('crypto').randomBytes(32).toString('base64url');
    assert.match((await OT.check(db, tok)).refusal, /SDP_CONFIG_KEY/);
  });
});

// ── O-7 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const { provisionTestDb, dropTestDb } = require('./pg-helpers');
test('O-7: writes during the restore drill do not fail a healthy backup (counts taken in the dump\'s snapshot)', async (t) => {
  const ctx = await provisionTestDb();
  if (!ctx || ctx.schema) { t.skip(ctx ? 'needs a throwaway DATABASE (PG_ADMIN_URL with CREATEDB) to dump cleanly' : 'PostgreSQL unreachable'); return; }
  const { Client } = require('pg');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r7drill-'));
  const blobRoot = path.join(tmp, 'blobs');
  fs.mkdirSync(path.join(blobRoot, 'inspection', 'EM-1'), { recursive: true });
  for (let i = 0; i < 40; i++) fs.writeFileSync(path.join(blobRoot, 'inspection', 'EM-1', `p${i}.jpg`), Buffer.alloc(64 * 1024, i));
  const c = new Client({ connectionString: ctx.url }); await c.connect();
  let writer = null; let writes = 0; let stop = false;
  try {
    await c.query('CREATE TABLE system_log (id bigserial primary key, ts text, category text, action text, actor text, actor_id int, target text, details text, ip text, risk int); CREATE TABLE users (id serial primary key, name text)');
    await c.query("INSERT INTO users (name) VALUES ('a')");
    // a live server keeps writing audit rows while the drill runs
    writer = (async () => { while (!stop) { await c.query("INSERT INTO system_log (ts, category, action) VALUES (now()::text, 'auth', 'login_failed')"); writes++; await new Promise((r) => setTimeout(r, 2)); } })();
    const drill = require('../tools/pg/restore-drill');
    const env = { ...process.env, PG_URL: ctx.url, PG_ADMIN_URL: ctx.adminUrl, SDP_BACKUP_KEY: 'r7-drill-backup-passphrase-2026' };
    const out = await drill.run({ env, dir: tmp, backupFirst: true, blobRoot, reportDir: path.join(tmp, 'r'), noLog: true, log: () => {}, actor: 'test' });
    assert.equal(out.ok, true, 'a healthy backup passes even though the server wrote during the drill');
    const row = out.comparison.rows.find((r) => r.table === 'system_log');
    assert.equal(row.status, 'ok'); assert.equal(row.live, row.restored);
    assert.ok(writes > 0);
    assert.match(fs.readFileSync(out.reportFile, 'utf8'), /dump's own snapshot/);
    // the counts sidecar sits next to the dump and is pruned with it
    const side = fs.readdirSync(tmp).filter((n) => n.endsWith('.counts.json'));
    assert.equal(side.length, 1);
    const live = Number((await c.query('SELECT count(*) AS n FROM system_log')).rows[0].n);
    assert.ok(live > row.live, 'rows were written after the dump — the old comparison would have failed');
  } finally { stop = true; if (writer) await writer.catch(() => {}); await c.end(); await dropTestDb(ctx); fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('O-7: the counts sidecar is pruned with its dump', () => {
  const B = require('../services/backup');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r7prune-'));
  try {
    for (const s of ['20260101T000000Z', '20260102T000000Z', '20260103T000000Z']) {
      fs.writeFileSync(path.join(dir, `sdp_dashboard_${s}.sql.gz.enc`), 'x');
      fs.writeFileSync(path.join(dir, `sdp_dashboard_${s}.counts.json`), '{}');
    }
    B.prune(dir, { keep: 2 });
    assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.counts.json')).sort(), ['sdp_dashboard_20260102T000000Z.counts.json', 'sdp_dashboard_20260103T000000Z.counts.json']);
    assert.equal(B.latestDump(dir), path.join(dir, 'sdp_dashboard_20260103T000000Z.sql.gz.enc'), 'a sidecar is never taken for a dump');
    assert.equal(B.countsFileFor(path.join(dir, 'sdp_dashboard_20260103T000000Z.sql.gz.enc')), path.join(dir, 'sdp_dashboard_20260103T000000Z.counts.json'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── R6-A3 gap: transitive dependencies of a cited script ────────────────────────────────────────────────────────────
test('R6-A3 gap: a change in a local require() dependency of a cited script marks the dossiers stale', () => {
  const GD = require('../tools/release/gate-dossiers');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'r7gd-'));
  try {
    fs.mkdirSync(path.join(root, 'tools', 'x'), { recursive: true }); fs.mkdirSync(path.join(root, 'services'), { recursive: true });
    fs.writeFileSync(path.join(root, 'tools', 'x', 'run.js'), "const a = require('../../services/a'); const p = require('path'); require(p.join(__dirname, '..', '..', 'services', 'c'));\n");
    fs.writeFileSync(path.join(root, 'services', 'a.js'), "module.exports = require('./b');\n");
    fs.writeFileSync(path.join(root, 'services', 'b.js'), "module.exports = 1; require('pg'); require('./missing-optional');\n");
    fs.writeFileSync(path.join(root, 'services', 'c.js'), 'module.exports = 3;\n');
    const deps = GD.scriptDependencies(root, 'tools/x/run.js');
    assert.deepEqual(deps.sort(), ['services/a.js', 'services/b.js', 'services/c.js']);
    const before = GD.dependencyHashes(root, ['tools/x/run.js']);
    fs.appendFileSync(path.join(root, 'services', 'b.js'), '// changed\n');
    const after = GD.dependencyHashes(root, ['tools/x/run.js']);
    assert.notEqual(before['services/b.js'].sha256, after['services/b.js'].sha256);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  // on the real tree: the committed manifest records the dependency closure, and changing one is detected
  const c = GD.collect(path.join(__dirname, '..'), { withGit: false });
  assert.ok(c.scriptDeps && Object.keys(c.scriptDeps).includes('services/auditChain.js'), 'restore-rehearsal.js → services/auditChain.js is hashed');
  const man = { script_deps: { ...c.scriptDeps, 'services/auditChain.js': { sha256: '0'.repeat(64) } } };
  assert.ok(GD.staleScriptDeps(c, man).some((r) => /services\/auditChain\.js/.test(r)));
});

// ── O-5 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('O-5: blocking budget check fails when only some budget classes have samples', () => {
  const P = require('../tools/test/perf-budget-check');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r7perf-'));
  try {
    const budgets = { status: 'PROPOSED', api_route_classes: { page_data: { p95_ms: 1000 }, sync: { p95_ms: 1000 }, write: { p95_ms: 1000 } } };
    fs.writeFileSync(path.join(dir, 'b.json'), JSON.stringify(budgets));
    fs.writeFileSync(path.join(dir, 'l.json'), JSON.stringify({ classes: { page_data: { n: 10, p95: 100 } } }));
    const out = []; const args = ['--budgets=' + path.join(dir, 'b.json'), '--load=' + path.join(dir, 'l.json')];
    assert.equal(P.main(args, { PERF_BUDGETS_BLOCKING: '1' }, (s) => out.push(s)), 1, 'no data ≠ pass');
    assert.ok(out.some((s) => /2 of 3 budget class\(es\) have no sample/.test(s)));
    assert.equal(P.main(args, {}, () => {}), 0, 'warn mode stays a warning');
    fs.writeFileSync(path.join(dir, 'l.json'), JSON.stringify({ classes: { page_data: { n: 10, p95: 100 }, sync: { n: 5, p95: 10 }, write: { n: 5, p95: 10 } } }));
    assert.equal(P.main(args, { PERF_BUDGETS_BLOCKING: '1' }, () => {}), 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
