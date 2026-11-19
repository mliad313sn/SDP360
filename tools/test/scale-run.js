#!/usr/bin/env node
'use strict';
// P05 — rehearsal dataset, plans and restore drill on ONE throwaway database (never a live one).
//
//   PG_ADMIN_URL=<CREATEDB role on a disposable cluster> node tools/test/scale-run.js <command> [--db=sdp_test_p05perf] [--rows=100000]
//     prepare  create the database, run the migrations, seed --rows tickets (tools/pg/explain-hot.js seed),
//              create a throwaway sign-in account (credentials in <tmpdir>/<db>.cred, mode 0600)
//     env      print the environment for booting server.js against it in a SEPARATE process
//     plans    EXPLAIN (ANALYZE, BUFFERS) every hot reader of tools/pg/explain-hot.js
//     restore  time a backup → restore → reconcile drill into <db>_restored (dropped afterwards)
//     drop     drop the database (only a sdp_test_* name) and the credentials file
//
// The owner has not declared a scale: the 100 000-ticket rehearsal set is the default, and it is said so
// in every result. Every database name passes the throwaway guard ^sdp_test_[a-z0-9_]+$.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const EH = require('../pg/explain-hot');

const ROOT = path.join(__dirname, '..', '..');
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const DB = arg('db', 'sdp_test_p05perf');
const ROWS = Math.max(1000, Number(arg('rows', '100000')) || 100000);
const credFile = () => path.join(os.tmpdir(), DB + '.cred');

function urlFor(name) {
  const admin = process.env.PG_ADMIN_URL;
  if (!admin) throw new Error('PG_ADMIN_URL (a CREATEDB role on a disposable cluster) is required');
  const u = new URL(admin); u.pathname = '/' + name; const s = u.toString();
  EH.assertThrowaway(s); return s;
}
async function q(url, sql, params) {
  const { Client } = require('pg'); const c = new Client({ connectionString: url }); await c.connect();
  try { return await c.query(sql, params); } finally { await c.end(); }
}
const ms = (t0) => Math.round(Number(process.hrtime.bigint() - t0) / 1e6);

async function counts(url) {
  const t = await q(url, `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1`);
  const out = {};
  for (const r of t.rows) out[r.table_name] = Number((await q(url, `SELECT count(*)::bigint AS n FROM "${r.table_name}"`)).rows[0].n);
  return out;
}

async function prepare() {
  const url = urlFor(DB);
  const admin = process.env.PG_ADMIN_URL;
  const exists = (await q(admin, 'SELECT 1 FROM pg_database WHERE datname=$1', [DB])).rowCount;
  if (exists) throw new Error(`${DB} already exists — run "drop" first`);
  const t0 = process.hrtime.bigint();
  await q(admin, `CREATE DATABASE ${DB}`);
  const mig = spawnSync(process.execPath, [path.join(ROOT, 'db', 'migrate.js')], { env: { ...process.env, PG_URL: url }, encoding: 'utf8' });
  if (mig.status !== 0) throw new Error('migrations failed: ' + String(mig.stderr).slice(-400));
  const tMig = ms(t0);
  const { Client } = require('pg');
  await EH.seed(Client, url, ROWS);
  const tSeed = ms(t0) - tMig;
  const user = 'p05_load'; const pass = 'P5-' + crypto.randomBytes(12).toString('hex');
  const child = `(async () => { const r = require(${JSON.stringify(path.join(ROOT, 'reports-db.js'))}); await r.initPgReports();
    await r.createUser({ username: ${JSON.stringify(user)}, full_name: 'P05 load harness', password: ${JSON.stringify(pass)}, site_id: null, role: 'admin', roles: ['admin'] });
    process.exit(0); })().catch((e) => { console.error(e.message); process.exit(1); });`;
  const env = { ...process.env, PG_URL: url, DASH_USER: 'p05-seed-admin', DASH_PASS: 'S' + crypto.randomBytes(12).toString('hex') };
  for (const m of ['REPORTS', 'TRACKER', 'MEETINGS', 'INSPECTION', 'ASSETS']) env[m + '_BACKEND'] = 'postgres';
  const cu = spawnSync(process.execPath, ['-e', child], { env, encoding: 'utf8', cwd: ROOT });
  if (cu.status !== 0) throw new Error('account creation failed: ' + String(cu.stderr).slice(-400));
  // submitted weekly reports are frozen for everyone but super_admin — the write scenario needs it
  await q(url, `INSERT INTO user_roles (user_id, role) SELECT id, 'super_admin' FROM users WHERE username=$1 ON CONFLICT DO NOTHING`, [user]);
  await q(url, `UPDATE users SET role='super_admin' WHERE username=$1`, [user]);
  fs.writeFileSync(credFile(), JSON.stringify({ user, pass }), { mode: 0o600 });
  const size = Number((await q(url, 'SELECT pg_database_size(current_database()) AS b')).rows[0].b);
  const c = await counts(url);
  console.log(JSON.stringify({ db: DB, rows_requested: ROWS, migrate_ms: tMig, seed_ms: tSeed, db_bytes: size,
    request_records: c.request_records, weekly_reports: c.weekly_reports, field_outbox: c.field_outbox, system_log: c.system_log, sites: c.sites, cred: credFile() }, null, 1));
}

function printEnv() {
  const url = urlFor(DB); const r = (n) => crypto.randomBytes(n).toString('hex');
  const env = { PG_URL: url, REPORTS_BACKEND: 'postgres', TRACKER_BACKEND: 'postgres', MEETINGS_BACKEND: 'postgres', INSPECTION_BACKEND: 'postgres', ASSETS_BACKEND: 'postgres',
    DASH_USER: 'p05-' + r(4), DASH_PASS: r(16), DASHBOARD_API_KEY: r(24), ZOHO_CLIENT_ID: '', ZOHO_CLIENT_SECRET: '', ZOHO_REFRESH_TOKEN: '',
    SDP_TEST_NO_RATE_LIMIT: '1', TZ: 'UTC', BIND_HOST: '127.0.0.1' };
  for (const [k, v] of Object.entries(env)) console.log(`export ${k}=${JSON.stringify(v)}`);
}

async function plans() {
  const { Client } = require('pg'); const res = await EH.explainAll(Client, urlFor(DB));
  console.log(EH.renderMarkdown(res, { at: new Date().toISOString(), server: (await q(urlFor(DB), 'SELECT version() AS v')).rows[0].v.split(' on ')[0], commit: 'see git', rows: ROWS,
    reports: Number((await q(urlFor(DB), 'SELECT count(*)::int AS n FROM weekly_reports')).rows[0].n) }));
}

async function restore() {
  const B = require('../../services/backup'); const R = require('../../services/dbRestore');
  const src = urlFor(DB); const dstName = DB + '_restored'; const dst = urlFor(dstName); const admin = process.env.PG_ADMIN_URL;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p05-restore-'));
  const key = crypto.randomBytes(24).toString('hex'); const steps = {};
  try {
    let t = process.hrtime.bigint(); const before = await counts(src); steps.count_source_ms = ms(t);
    t = process.hrtime.bigint(); const b = await B.runBackup({ dir, env: { ...process.env, PG_URL: src, SDP_BACKUP_KEY: key } }); steps.backup_ms = ms(t);
    t = process.hrtime.bigint(); await q(admin, `DROP DATABASE IF EXISTS ${dstName} WITH (FORCE)`); await q(admin, `CREATE DATABASE ${dstName}`); steps.create_target_ms = ms(t);
    t = process.hrtime.bigint(); R.restoreDatabase({ file: b.file, confirm: R.confirmPhrase(b.file), env: { ...process.env, PG_URL: dst, SDP_BACKUP_KEY: key } }); steps.restore_ms = ms(t);
    t = process.hrtime.bigint(); const after = await counts(dst); steps.reconcile_ms = ms(t);
    const diff = Object.keys(before).filter((k) => before[k] !== after[k]).map((k) => ({ table: k, source: before[k], restored: after[k] }));
    steps.total_ms = Object.values(steps).reduce((a, v) => a + v, 0);
    console.log(JSON.stringify({ db: DB, tables: Object.keys(before).length, rows_total: Object.values(before).reduce((a, v) => a + v, 0),
      dump_bytes: b.bytes, stored_bytes: b.stored_bytes, encrypted: b.encrypted, steps, mismatches: diff }, null, 1));
  } finally {
    await q(admin, `DROP DATABASE IF EXISTS ${dstName} WITH (FORCE)`).catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function drop() {
  const url = urlFor(DB); EH.assertThrowaway(url);
  await q(process.env.PG_ADMIN_URL, `DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  fs.rmSync(credFile(), { force: true });
  console.log('dropped ' + DB);
}

const CMDS = { prepare, env: printEnv, plans, restore, drop };
module.exports = { CMDS, urlFor, counts };
if (require.main === module) {
  const c = CMDS[process.argv[2]];
  if (!c) { console.error('usage: scale-run.js prepare|env|plans|restore|drop [--db=sdp_test_…] [--rows=N]'); process.exit(2); }
  Promise.resolve(c()).catch((e) => { console.error('[scale-run] ' + e.message); process.exit(1); });
}
