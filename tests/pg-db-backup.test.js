'use strict';
// Step 2 (SDP-DASH-2.0) — the encrypted backup with the REAL pg_dump against PostgreSQL, then the
// restore drill: decrypt and load into a fresh schema, compare a row count.
const _os = require('os'), _fs = require('fs'), _path = require('path');
const { test } = require('node:test');
const assert = require('node:assert');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');

test('pg: backup → decrypt → restore into a throwaway schema', async (t) => {
  const ctx = await provisionTestDb(); if (!ctx) return t.skip('no pg');
  if (!ctx.schema) return t.skip('restore drill test needs the schema fallback');
  const B = require('../services/dbBackup');
  const bin = B.findPgDump(process.env);
  if (bin === 'pg_dump' && process.platform === 'win32') return t.skip('pg_dump not installed');
  const { Client } = require('pg');
  const c = new Client({ connectionString: ctx.url }); await c.connect();
  const restored = ctx.schema + '_r';
  try {
    await c.query('CREATE TABLE drill (id INTEGER PRIMARY KEY, label TEXT)');
    await c.query(`INSERT INTO drill SELECT g, 'row ' || g FROM generate_series(1, 250) g`);
    const dir = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'pgbk-'));
    const base = ctx.url.split('?')[0];
    const r = await B.runBackup({ env: { SDP_BACKUP_DIR: dir, SDP_BACKUP_KEY: 'drill-passphrase-0000', PG_URL: base, PG_DUMP: process.env.PG_DUMP },
      dumpOpts: { schema: ctx.schema } });
    assert.ok(r.bytes > 100, 'encrypted file written');
    const out = _path.join(dir, 'drill.sql');
    await B.decryptFileToFile(_path.join(dir, r.file), out, 'drill-passphrase-0000');
    // Restore drill: load the dump into another schema name and compare.
    // As in docs/ops/RESTORE-DRILL.md: psql loads the decrypted SQL (COPY blocks need psql).
    _fs.writeFileSync(out, _fs.readFileSync(out, 'utf8').split(ctx.schema).join(restored));
    const u = new URL(base);
    const psql = _path.join(_path.dirname(bin), process.platform === 'win32' ? 'psql.exe' : 'psql');
    const run = require('child_process').spawnSync(_fs.existsSync(psql) ? psql : 'psql',
      ['-v', 'ON_ERROR_STOP=1', '-q', '-h', u.hostname, '-p', u.port || '5432', '-U', decodeURIComponent(u.username),
        '-d', u.pathname.slice(1), '-f', out], { env: { ...process.env, PGPASSWORD: decodeURIComponent(u.password) }, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const n = await c.query(`SELECT COUNT(*)::int AS n FROM ${restored}.drill`);
    assert.equal(n.rows[0].n, 250);
  } finally {
    try { await c.query(`DROP SCHEMA IF EXISTS ${restored} CASCADE`); } catch (_) {}
    await c.end(); await dropTestDb(ctx);
  }
});
