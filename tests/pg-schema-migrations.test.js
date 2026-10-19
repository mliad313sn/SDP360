'use strict';
// Step 2 (SDP-DASH-2.0) — schema migrator on a real PostgreSQL schema: a fresh database gets every
// script and a full journal; a second run changes nothing; an edited script is re-applied once.
const _os = require('os'), _fs = require('fs'), _path = require('path');
const { test } = require('node:test');
const assert = require('node:assert');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');

test('pg: migrate all modules, replay is a no-op, an edit is reapplied', async (t) => {
  const ctx = await provisionTestDb(); if (!ctx) return t.skip('no pg');
  const M = require('../db/migrate');
  const pg = require('../services/pgDb').makePgDb(ctx.url);
  await pg.connect();
  try {
    const first = await M.migrateAll(pg, { log: () => {} });
    const total = M.MODULES.reduce((n, m) => n + M.listScripts(m).length, 0);
    assert.equal(first.reduce((n, r) => n + r.applied.length, 0), total, 'every script applied once');
    const rows = await pg.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get();
    assert.equal(Number(rows.n), total);
    for (const tbl of ['request_records', 'sync_runs', 'tracker_config', 'md_meetings', 'insp_inspections', 'assets', 'wan_subsite_networks']) {
      const r = await pg.prepare(`SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ?`).get(tbl);
      assert.equal(Number(r.n), 1, tbl);
    }
    const col = await pg.prepare(`SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'md_issues' AND column_name = 'helpdesk_ticket'`).get();
    assert.equal(Number(col.n), 1, 'meetings/002 applied');

    const second = await M.migrateAll(pg, { log: () => {} });
    assert.equal(second.reduce((n, r) => n + r.applied.length + r.reapplied.length, 0), 0, 'replay changes nothing');

    // Production's first boot with the migrator: an EXISTING, populated database with no journal.
    // Every script is re-run on top of live data and must succeed and keep the rows.
    await pg.prepare(`INSERT INTO sites (name) VALUES ('Drill site')`).run();
    await pg.prepare(`INSERT INTO wan_link_snapshots (site_id, sub_site, uplink, period_type, period_start)
      VALUES (1, '', 'wan1', 'week', '2026-10-12')`).run();
    await pg.exec('DROP TABLE schema_migrations');
    const adopt = await M.migrateAll(pg, { log: () => {} });
    assert.equal(adopt.reduce((n, r) => n + r.applied.length, 0), total, 'existing database adopted: every script journaled');
    assert.equal(Number((await pg.prepare('SELECT COUNT(*) AS n FROM wan_link_snapshots').get()).n), 1, 'data kept');
    assert.equal(Number((await pg.prepare(`SELECT COUNT(*) AS n FROM sites WHERE name = 'Drill site'`).get()).n), 1, 'data kept');

    // An edited script (other root) is re-applied once and its checksum updated.
    const root = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'mig-'));
    _fs.mkdirSync(_path.join(root, 'demo'));
    const f = _path.join(root, 'demo', '001_demo.sql');
    _fs.writeFileSync(f, 'CREATE TABLE IF NOT EXISTS mig_demo (a INTEGER);');
    assert.deepEqual((await M.migrateModule(pg, 'demo', { root, log: () => {} })).applied, ['001_demo.sql']);
    _fs.writeFileSync(f, 'CREATE TABLE IF NOT EXISTS mig_demo (a INTEGER);\nALTER TABLE mig_demo ADD COLUMN IF NOT EXISTS b TEXT;');
    assert.deepEqual((await M.migrateModule(pg, 'demo', { root, log: () => {} })).reapplied, ['001_demo.sql']);
    assert.equal((await M.migrateModule(pg, 'demo', { root, log: () => {} })).skipped, 1);
    const st = await M.status(pg);
    assert.ok(st.every(m => m.plan.every(p => p.action === 'skip')), 'status: nothing pending');
  } finally { try { await pg.close(); } catch {} await dropTestDb(ctx); }
});
