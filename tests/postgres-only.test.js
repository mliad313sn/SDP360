'use strict';
// PostgreSQL-only server (user decision 2026-10-28). (1) the boot guard refuses SQLite unless
// SDP_ALLOW_SQLITE=1; (2) with REPORTS_BACKEND=postgres no reports.db file is created, the default admin
// is seeded in PostgreSQL, and any sqlite use after load throws SQLITE_DISABLED.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const G = require('../services/backendGuard');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');

const ALL_PG = { REPORTS_BACKEND: 'postgres', TRACKER_BACKEND: 'postgres', MEETINGS_BACKEND: 'postgres', INSPECTION_BACKEND: 'postgres', ASSETS_BACKEND: 'postgres' };

test('guard: all modules on PostgreSQL → allowed', () => {
  assert.equal(G.assertBootAllowed({ ...ALL_PG }).sqlite.length, 0);
});
test('guard: one module on SQLite → refused by default, naming the variable', () => {
  assert.throws(() => G.assertBootAllowed({ ...ALL_PG, ASSETS_BACKEND: '' }), (e) => e.code === 'SQLITE_NOT_ALLOWED' && /ASSETS_BACKEND=postgres/.test(e.message));
});
test('guard: SDP_ALLOW_SQLITE=1 (tests/dev) → allowed with the list', () => {
  assert.deepEqual(G.assertBootAllowed({ SDP_ALLOW_SQLITE: '1' }).sqlite, ['reports', 'tracker', 'meetings', 'inspection', 'assets']);
});
test('guard: explicit production without a secrets key → refused', () => {
  assert.throws(() => G.assertBootAllowed({ ...ALL_PG, REQUIRE_POSTGRES: '1' }), (e) => e.code === 'CONFIG_KEY_REQUIRED');
  assert.ok(G.assertBootAllowed({ ...ALL_PG, REQUIRE_POSTGRES: '1', SDP_CONFIG_KEY: 'x'.repeat(16) }));
});

test('reports-db on PostgreSQL: no reports.db file, admin seeded in PG, sqlite locked', async (t) => {
  const ctx = await provisionTestDb(); if (!ctx) return t.skip('no pg');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgonly-'));
  try {
    const out = execFileSync(process.execPath, ['-e', `
      const rdb = require(${JSON.stringify(path.join(__dirname, '..', 'reports-db'))});
      (async () => {
        await rdb.initPgReports();
        const u = await rdb.pgHandle().prepare("SELECT username, role FROM users WHERE username = 'pg-only-admin'").get();
        let locked = null; try { rdb.db.prepare('SELECT 1').get(); } catch (e) { locked = e.code; }
        console.log(JSON.stringify({ admin: u, locked }));
        process.exit(0);
      })().catch((e) => { console.error(e.message); process.exit(1); });`],
    { env: { ...process.env, ...ALL_PG, PG_URL: ctx.url, SDP_DATA_DIR: dir, DASH_USER: 'pg-only-admin', DASH_PASS: 'pg-only-pass-0000' }, encoding: 'utf8' });
    const r = JSON.parse(out.trim().split('\n').pop());
    assert.deepEqual(r.admin, { username: 'pg-only-admin', role: 'admin' }, 'default admin seeded in PostgreSQL');
    assert.equal(r.locked, 'SQLITE_DISABLED', 'sqlite use after load throws');
    assert.ok(!fs.existsSync(path.join(dir, 'reports.db')), 'no reports.db file created');
  } finally { await dropTestDb(ctx); }
});
