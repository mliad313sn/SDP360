'use strict';
// Chunk 4B — reports.db config/sites → PostgreSQL. TDD suite. Runs the postgres
// backend against a throwaway DB; skips cleanly when Postgres is unreachable.
process.env.REPORTS_BACKEND = 'postgres';
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'rcfg-'));
process.env.DASH_USER = process.env.DASH_USER || 'pgtest-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'pgtest-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');
const SCHEMA2 = _fs.readFileSync(_path.join(__dirname, '../db/postgres/reports/002_config.sql'), 'utf8');

async function boot() {
  const ctx = await provisionTestDb();
  if (!ctx) return null;
  process.env.PG_URL = ctx.url;
  const rdb = require('../reports-db');
  await rdb.initPgReports();
  return { ctx, rdb };
}

test('config pg: schema idempotent + depts + presets seeded', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb } = b;
  try {
    await rdb.pgHandle().exec(SCHEMA2);                 // re-apply → idempotent
    const h = rdb.pgHandle();
    // Assert on RAW pg counts — listDepartments isn't forked until Task 2, so calling
    // it now would run the sqlite body and pass off sqlite seeds (false green).
    const dn = Number((await h.prepare('SELECT COUNT(*) AS n FROM action_departments').get()).n);
    assert.equal(dn, 10, 'pg departments seeded');
    const gn = Number((await h.prepare('SELECT COUNT(*) AS n FROM dashboard_preset_groups').get()).n);
    assert.ok(gn > 0, 'pg preset groups seeded');
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

test('config pg: sites CRUD + reactivate', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb } = b;
  try {
    const a = await rdb.createSite({ name: 'TestMine', zoho_group: 'TestMine IT' });
    assert.ok(a.id);
    let list = await rdb.listSites();
    assert.ok(list.find(s => s.id === a.id && s.name === 'TestMine'));
    await rdb.updateSiteGroup(a.id, 'TestMine IT Agents');
    await rdb.updateSite(a.id, { sort_order: 7 });
    const after = (await rdb.listSites()).find(s => s.id === a.id);
    assert.equal(after.zoho_group, 'TestMine IT Agents'); assert.equal(after.sort_order, 7);
    await rdb.setSiteActive(a.id, 0);
    assert.ok(!(await rdb.listSites()).find(s => s.id === a.id), 'inactive hidden by default');
    assert.ok((await rdb.listSites({ includeInactive: true })).find(s => s.id === a.id));
    // reactivate-on-duplicate (case-insensitive)
    const re = await rdb.createSite({ name: 'testmine' });
    assert.equal(re.id, a.id); assert.equal(re.reactivated, true);
    await assert.rejects(rdb.createSite({ name: 'TestMine' }), /already exists/);
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

test('config pg: departments CRUD + ci dedup', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb } = b;
  try {
    const d = await rdb.createDepartment({ name: 'ZetaDept' });
    assert.ok(d.id);
    await assert.rejects(rdb.createDepartment({ name: 'zetadept' }), /already exists/); // active dup
    await rdb.updateDepartment(d.id, { sort_order: 4 });
    await rdb.setDepartmentActive(d.id, 0);
    assert.ok(!(await rdb.listDepartments()).find(x => x.id === d.id), 'inactive hidden');
    assert.ok((await rdb.listDepartments({ includeInactive: true })).find(x => x.id === d.id));
    const re = await rdb.createDepartment({ name: 'ZETADEPT' });  // reactivate (ci)
    assert.equal(re.id, d.id); assert.equal(re.reactivated, true);
    await assert.rejects(rdb.updateDepartment(d.id, { name: '' }), /empty/);
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

test('config pg: logAudit + getReportAuditLog round-trip', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb } = b;
  try {
    await rdb.logAudit({ report_id: 99, user_id: 1, username: 'me', action: 'created', details: { a: 1 } });
    await rdb.logAudit({ report_id: 99, user_id: 1, username: 'me', action: 'edited', details: { b: 2 } });
    const rows = await rdb.getReportAuditLog(99, 10);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].action, 'edited');                 // newest first
    assert.equal(JSON.parse(rows[0].details).b, 2);
    assert.equal((await rdb.getReportAuditLog(99, 1)).length, 1); // limit respected
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});
