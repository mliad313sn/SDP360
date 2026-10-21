'use strict';
// E11 — restore drill: pure comparison / schema rewrite / report (sqlite-shaped counts), then the
// real thing against PostgreSQL (fresh dump → disposable database AND disposable schema → compare),
// which skips cleanly when no PG is reachable (PG_TESTS_REQUIRED=1 makes the skip an error).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const D = require('../services/restoreDrill');

test('compareCounts: equal → ok; a one-row drift or a table missing on one side is a mismatch; missing on both is n/a', () => {
  const live = { users: 3, weekly_reports: 10, action_items: 7, md_meetings: 2, md_issues: 5, md_actions: 4, insp_inspections: 1, request_records: 1000, assets: null, system_log: 42 };
  const same = D.compareCounts(live, { ...live });
  assert.equal(same.ok, true); assert.equal(same.mismatches, 0);
  assert.equal(same.rows.find((r) => r.table === 'assets').status, 'n/a');
  assert.equal(same.rows.length, D.MAIN_TABLES.length);
  const drift = D.compareCounts(live, { ...live, request_records: 999, system_log: null });
  assert.equal(drift.ok, false); assert.equal(drift.mismatches, 2);
  assert.deepEqual(drift.rows.find((r) => r.table === 'request_records'), { table: 'request_records', live: 1000, restored: 999, diff: -1, status: 'mismatch' });
  assert.equal(drift.rows.find((r) => r.table === 'system_log').status, 'missing');
  assert.equal(D.compareCounts({ a: 0 }, { a: 0 }, ['a']).ok, true, 'zero on both sides is a measured match');
});

test('compareCounts on real sqlite-shaped databases (two in-memory copies, generic counter)', () => {
  const Database = require('better-sqlite3');
  const mk = (n) => { const db = new Database(':memory:'); db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY); CREATE TABLE action_items(id INTEGER PRIMARY KEY)'); for (let i = 0; i < n; i++) db.prepare('INSERT INTO users DEFAULT VALUES').run(); return db; };
  const count = (db) => Object.fromEntries(D.MAIN_TABLES.map((t) => {
    const has = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
    return [t, has ? db.prepare(`SELECT count(*) AS n FROM ${t}`).get().n : null];
  }));
  const live = mk(5), restored = mk(5), bad = mk(4);
  assert.equal(D.compareCounts(count(live), count(restored)).ok, true);
  const c = D.compareCounts(count(live), count(bad));
  assert.equal(c.ok, false); assert.equal(c.rows.find((r) => r.table === 'users').diff, -1);
  assert.equal(c.rows.find((r) => r.table === 'md_meetings').status, 'n/a');
});

test('rewriteSchema moves every public. object to the drill schema without touching values or other identifiers', () => {
  const sql = `SET search_path = '';\nCREATE TABLE public.users (id integer, note text);\nALTER TABLE public.users OWNER TO sdp_app;\nCOPY public.users (id, note) FROM stdin;\n1\tsee republic.html\n2\tmypublic.x\n\\.\nCREATE INDEX idx ON public.users USING btree (id);\nALTER TABLE ONLY public.action_items ADD CONSTRAINT fk FOREIGN KEY (report_id) REFERENCES public.weekly_reports(id);\n`;
  const out = D.rewriteSchema(sql, 'sdp_drill_ab12');
  assert.ok(!/(^|[^A-Za-z0-9_."])public\./m.test(out), 'no qualified public. left');
  assert.ok(out.includes('CREATE TABLE sdp_drill_ab12.users'));
  assert.ok(out.includes('REFERENCES sdp_drill_ab12.weekly_reports(id)'));
  assert.ok(out.includes('see republic.html') && out.includes('mypublic.x'), 'values inside words untouched');
  assert.throws(() => D.rewriteSchema(sql, 'bad name; drop'), /invalid schema name/);
});

test('summarizePsqlErrors + renderReport: PASS/FAIL verdict, counts table, notes, no connection string leaks', () => {
  const psql = D.summarizePsqlErrors('psql:-:12: ERROR:  role "sdp_app" does not exist\nNOTICE: x\nERROR:  relation "foo" already exists\n');
  assert.deepEqual([psql.count, psql.owner_role_errors], [2, 1]);
  const cmp = D.compareCounts({ users: 3, assets: null }, { users: 3, assets: null }, ['users', 'assets']);
  const md = D.renderReport({ date: '2026-10-21', dumpFile: '/b/sdp_dashboard_20261021T030000Z.sql.gz.enc', dumpBytes: 123456, storedBytes: 20000, encrypted: true,
    target: { kind: 'database', name: 'sdp_drill_x' }, comparison: cmp, durationMs: 1234, psql: { ...psql, sample: ['ERROR at postgres://u:pw@h/db'] }, notes: ['a note'], actor: 'test' });
  assert.match(md, /^# Restore drill — 2026-10-21/);
  assert.match(md, /\*\*Result: PASS\*\*/);
  assert.match(md, /\| users \| 3 \| 3 \| 0 \| ok \|/);
  assert.match(md, /\| assets \| — \| — \| — \| n\/a \|/);
  assert.match(md, /AES-256-GCM/); assert.match(md, /- a note/); assert.match(md, /1\.2 s/);
  assert.ok(!md.includes('u:pw@'), 'connection strings are redacted in the psql sample');
  const fail = D.renderReport({ date: '2026-11-01', comparison: D.compareCounts({ users: 3 }, { users: 2 }, ['users']), encrypted: false });
  assert.match(fail, /\*\*Result: FAIL\*\* — 1 table\(s\) differ/); assert.match(fail, /NO — plaintext gzip/);
  const det = D.logDetails({ date: '2026-11-01', comparison: D.compareCounts({ users: 3 }, { users: 2 }, ['users']), dumpFile: '/x/y.sql.gz', reportFile: '/r/2026-11-01.md' });
  assert.deepEqual([det.ok, det.mismatches, det.dump, det.report, det.counts.users.status], [false, 1, 'y.sql.gz', '2026-11-01.md', 'mismatch']);
});

// ── PostgreSQL: the real drill, end to end, on a throwaway database ────────────────────────
const { provisionTestDb, dropTestDb } = require('./pg-helpers');
test('PG: fresh dump → restore into a disposable database → counts match; then the schema fallback; a doctored dump FAILS', async (t) => {
  const ctx = await provisionTestDb();
  if (!ctx || ctx.schema) { t.skip(ctx ? 'needs a throwaway DATABASE (PG_ADMIN_URL with CREATEDB) to dump cleanly' : 'PostgreSQL unreachable'); return; }
  const { Client } = require('pg');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drill-'));
  try {
    const c = new Client({ connectionString: ctx.url }); await c.connect();
    await c.query('CREATE TABLE users (id serial primary key, name text); CREATE TABLE weekly_reports (id serial primary key, site text); CREATE TABLE system_log (id bigserial primary key, ts text, category text, action text, actor text, actor_id int, target text, details text, ip text, risk int)');
    await c.query("INSERT INTO users (name) SELECT 'u' || g FROM generate_series(1, 37) g");
    await c.query("INSERT INTO weekly_reports (site) SELECT 'HGO' FROM generate_series(1, 5)");
    await c.end();

    const drill = require('../tools/pg/restore-drill');
    const env = { ...process.env, PG_URL: ctx.url, PG_ADMIN_URL: ctx.adminUrl, SDP_BACKUP_KEY: 'drill-test-backup-passphrase-2026' };
    const logged = [];
    const out = await drill.run({ env, dir: tmp, reportDir: path.join(tmp, 'reports'), backupFirst: true, logEvent: (ev) => logged.push(ev), log: () => {}, actor: 'test' });
    assert.equal(out.ok, true);
    assert.ok(out.dumpFile.endsWith('.sql.gz.enc'), 'the fresh dump is encrypted');
    assert.equal(out.target.kind, 'database');
    const byT = Object.fromEntries(out.comparison.rows.map((r) => [r.table, r]));
    assert.deepEqual([byT.users.live, byT.users.restored, byT.users.status], [37, 37, 'ok']);
    assert.deepEqual([byT.weekly_reports.restored, byT.assets.status], [5, 'n/a']);
    assert.ok(fs.existsSync(out.reportFile) && fs.readFileSync(out.reportFile, 'utf8').includes('**Result: PASS**'));
    assert.equal(logged.length, 1); assert.deepEqual([logged[0].category, logged[0].action, logged[0].details.ok], ['ops', 'restore_drill', true]);
    // the disposable database is gone
    const a = new Client({ connectionString: ctx.adminUrl }); await a.connect();
    const left = await a.query("SELECT datname FROM pg_database WHERE datname LIKE 'sdp_drill_%'");
    await a.end();
    assert.equal(left.rows.length, 0, 'target dropped');

    // schema fallback (no admin URL): rewrite public. → schema in the live db, still PASS
    const env2 = { ...env }; delete env2.PG_ADMIN_URL;
    const out2 = await drill.run({ env: env2, dir: tmp, reportDir: path.join(tmp, 'reports2'), logEvent: () => {}, log: () => {}, actor: 'test' });
    assert.equal(out2.ok, true); assert.equal(out2.target.kind, 'schema');
    const c2 = new Client({ connectionString: ctx.url }); await c2.connect();
    const sch = await c2.query("SELECT nspname FROM pg_namespace WHERE nspname LIKE 'sdp_drill_%'");
    await c2.end();
    assert.equal(sch.rows.length, 0, 'drill schema dropped');

    // a dump missing rows → FAIL (non-zero) and a FAIL report
    const B = require('../services/backup');
    const key = B.deriveKey(env.SDP_BACKUP_KEY);
    const sql = B.openDump(out.dumpFile, { key }).toString('utf8').replace(/^(COPY public\.users[^\n]*\n)1\tu1\n/m, '$1');
    const doctored = path.join(tmp, 'sdp_dashboard_20991231T000000Z.sql'); fs.writeFileSync(doctored, sql);
    const p = B.packDump(doctored, { key });
    await assert.rejects(() => drill.run({ env, dir: tmp, dumpFile: p.file, reportDir: path.join(tmp, 'reports3'), logEvent: (ev) => logged.push(ev), log: () => {}, actor: 'test' }),
      (e) => /restore drill FAILED: 1 table/.test(e.message) && e.result && e.result.ok === false);
    assert.equal(logged[logged.length - 1].details.ok, false);
  } finally { await dropTestDb(ctx); }
});
