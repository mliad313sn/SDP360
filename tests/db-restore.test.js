'use strict';
// services/dbRestore.js + `sdp-manager restore` — restore one of the server's own backups in place,
// on a real PostgreSQL: typed phrase required, pre-restore backup first, one transaction (a broken dump
// leaves the database exactly as it was), the service is stopped and started around it.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('pg');
const R = require('../services/dbRestore');
const B = require('../services/backup');

test('listBackups / confirmPhrase read the backup file names', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'));
  for (const n of ['sdp_dashboard_20261027T010203Z.sql.gz', 'sdp_dashboard_20261028T010203Z.sql.gz.enc', 'notes.txt']) fs.writeFileSync(path.join(dir, n), 'x');
  const l = R.listBackups(dir);
  assert.deepEqual(l.map((b) => b.name), ['sdp_dashboard_20261028T010203Z.sql.gz.enc', 'sdp_dashboard_20261027T010203Z.sql.gz']);
  assert.equal(l[0].at, '2026-10-28T01:02:03Z'); assert.equal(l[0].encrypted, true);
  assert.equal(R.confirmPhrase(l[1].file), 'RESTORE 20261027');
  assert.throws(() => R.confirmPhrase('/x/other.sql'), /not a dashboard backup/);
  assert.throws(() => R.restoreDatabase({ file: l[1].file, confirm: 'RESTORE 20261028', env: { PG_URL: 'postgres://x@h/d' } }), /type exactly: RESTORE 20261027/);
});

test('backup → change → restore brings the data back; a broken dump changes nothing', async (t) => {
  const url = process.env.PG_URL;
  if (/[?&]options=/.test(url)) { t.skip('the test database is a schema in a shared database (no CREATEDB): restore replaces schema public'); return; }
  const c = new Client({ connectionString: url }); await c.connect();
  try {
    await c.query('CREATE TABLE IF NOT EXISTS restore_probe (id int primary key, v text)');
    await c.query("INSERT INTO restore_probe VALUES (1, 'before') ON CONFLICT (id) DO UPDATE SET v = 'before'");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'));
    const env = { PG_URL: url, SDP_BACKUP_DIR: dir, SDP_SERVICE: 'pm2' };
    const b = await B.runBackup({ dir, env: { ...process.env, ...env }, log: () => {} });
    await c.query("UPDATE restore_probe SET v = 'after'");
    const svc = []; const service = { stop: () => svc.push('stop'), start: () => svc.push('start') };
    const M = require('../tools/sdp-manager');
    const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inst-'));
    await assert.rejects(M.restore(b.file, { dir: installDir, env, confirm: 'RESTORE 19990101', service, out: () => {} }), /type exactly/);
    assert.deepEqual(svc, [], 'nothing stopped without the phrase');
    const phrase = R.confirmPhrase(b.file);
    const r = await M.restore(b.file, { dir: installDir, env, confirm: phrase, service, out: () => {}, url: 'http://127.0.0.1:9' });
    assert.ok(fs.existsSync(r.pre_restore), 'a pre-restore point is taken first');
    assert.deepEqual(svc, ['stop', 'start']);
    await c.end();
    const c2 = new Client({ connectionString: url }); await c2.connect();
    assert.equal((await c2.query('SELECT v FROM restore_probe WHERE id=1')).rows[0].v, 'before');
    // a dump that fails half-way: PostgreSQL rolls the whole restore back
    const bad = path.join(dir, 'sdp_dashboard_20261029T000000Z.sql');
    fs.writeFileSync(bad, 'CREATE TABLE restore_should_vanish (x int);\nTHIS IS NOT SQL;\n' + B.TRAILER + '\n');
    await c2.query("UPDATE restore_probe SET v = 'kept'");
    assert.throws(() => R.restoreDatabase({ file: bad, confirm: 'RESTORE 20261029', env, out: () => {} }), /rolled back by PostgreSQL — the database is unchanged/);
    assert.equal((await c2.query('SELECT v FROM restore_probe WHERE id=1')).rows[0].v, 'kept');
    assert.equal((await c2.query("SELECT to_regclass('restore_should_vanish') AS t")).rows[0].t, null);
    await c2.end();
  } finally { try { await c.end(); } catch (_) {} }
});
