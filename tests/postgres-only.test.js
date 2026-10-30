'use strict';
// PostgreSQL is the only database (PO-08, 2026-10-28 — SQLite removed from the code base).
// (1) the boot guard refuses to start without PG_URL; (2) a fresh database gets its default
// admin and default sites from PostgreSQL, and no SQLite file is ever created; (3) nothing in
// the shipped code (outside tests/vendor) still loads better-sqlite3.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const G = require('../services/backendGuard');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');

test('guard: PG_URL set → allowed', () => {
  assert.equal(G.assertBootAllowed({ PG_URL: 'postgres://x@h/db' }).ok, true);
  assert.equal(G.assertBootAllowed({ DATABASE_URL: 'postgres://x@h/db' }).ok, true);
});
test('guard: no PG_URL → refused, whatever the old *_BACKEND variables say', () => {
  assert.throws(() => G.assertBootAllowed({ REPORTS_BACKEND: 'sqlite' }), (e) => e.code === 'PG_URL_REQUIRED');
  assert.throws(() => G.assertBootAllowed({}), (e) => e.code === 'PG_URL_REQUIRED');
});
test('guard: explicit production without a secrets key → refused', () => {
  assert.throws(() => G.assertBootAllowed({ PG_URL: 'postgres://x@h/db', REQUIRE_POSTGRES: '1' }), (e) => e.code === 'CONFIG_KEY_REQUIRED');
  assert.ok(G.assertBootAllowed({ PG_URL: 'postgres://x@h/db', REQUIRE_POSTGRES: '1', SDP_CONFIG_KEY: 'x'.repeat(16) }));
});

test('fresh PostgreSQL database: admin + default sites seeded, no .db file anywhere', async (t) => {
  const ctx = await provisionTestDb(); if (!ctx) return t.skip('no pg');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgonly-'));
  try {
    const out = execFileSync(process.execPath, ['-e', `
      const rdb = require(${JSON.stringify(path.join(__dirname, '..', 'reports-db'))});
      (async () => {
        await rdb.initPgReports();
        const u = await rdb.pgHandle().prepare("SELECT username, role FROM users WHERE username = 'pg-only-admin'").get();
        const sites = (await rdb.listSites()).map((s) => s.name);
        console.log(JSON.stringify({ admin: u, sites }));
        process.exit(0);
      })().catch((e) => { console.error(e.message); process.exit(1); });`],
    { env: { ...process.env, PG_URL: ctx.url, SDP_DATA_DIR: dir, DASH_USER: 'pg-only-admin', DASH_PASS: 'pg-only-pass-0000', NODE_OPTIONS: '' }, encoding: 'utf8' });
    const r = JSON.parse(out.trim().split('\n').pop());
    assert.deepEqual(r.admin, { username: 'pg-only-admin', role: 'admin' }, 'default admin seeded in PostgreSQL');
    for (const n of ['Sabodala', 'MANA', 'Hounde']) assert.ok(r.sites.includes(n), 'default site ' + n);
    assert.deepEqual(fs.readdirSync(dir).filter((f) => /\.db$/.test(f)), [], 'no SQLite file created');
  } finally { await dropTestDb(ctx); }
});

test('no shipped code loads better-sqlite3, and the dependency is gone', () => {
  const root = path.join(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal((pkg.dependencies || {})['better-sqlite3'], undefined, 'package.json dependency');
  const hits = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', '.git', 'vendor', 'tests', 'docs'].includes(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(c?js|mjs)$/.test(e.name) && /require\(['"]better-sqlite3['"]\)/.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(root, p));
  } };
  walk(root);
  assert.deepEqual(hits, []);
});
