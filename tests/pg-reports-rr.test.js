'use strict';
// Chunk 4B-RR — risk-register rr_site_aliases + export readers → PostgreSQL. Skips when PG down.
process.env.REPORTS_BACKEND = 'postgres';
const _os=require('os'),_fs=require('fs'),_path=require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(),'rr-'));
process.env.DASH_USER = process.env.DASH_USER || 'pgtest-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'pgtest-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');
const _req = o => ({ request_id:null, display_id:null, subject:null, request_status:null,
  pending_status:1, overdue_status:0, request_type:null, service_request:0, is_escalated:0,
  reopen_count:0, due_by_time:null, time_elapsed_ms:null, created_time:null, resolved_time:null,
  completed_time:null, responded_time:null, assigned_time:null, last_updated_time:null,
  first_response_overdue:null, technician:null, requester:null, category:null, sub_category:null,
  // `template` (Major-Incident detection, 2026-07) never reached this fixture because
  // the suite was being skipped — every @named column must be present.
  site:null, tech_group:null, mode:null, impact:null, template:null, ...o });

async function boot() {
  const ctx = await provisionTestDb(); if (!ctx) return null;
  process.env.PG_URL = ctx.url;
  const rdb = require('../reports-db'); await rdb.initPgReports();
  const rr = require('../risk-register-export');
  return { ctx, rdb, rr };
}

test('rr pg: seed + listAliases (from _seedConfigPg)', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb, rr } = b;
  try {
    const aliases = await rr.listAliases(rdb.db);
    assert.ok(aliases.length >= Object.keys(rr.DEFAULT_SITE_ALIASES).length - 1, 'seeded defaults present');
    assert.ok(aliases.find(a => a.sdp_label === 'HOUNDE' && a.code === 'HGO'), 'HOUNDE→HGO seeded');
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

test('rr pg: upsert + delete', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb, rr } = b;
  try {
    await rr.upsertAlias(rdb.db, 'NEWSITE', 'HGO', 'tester');
    let aliases = await rr.listAliases(rdb.db);
    assert.equal(aliases.find(a => a.sdp_label === 'NEWSITE').code, 'HGO', 'inserted');
    await rr.upsertAlias(rdb.db, 'NEWSITE', 'MGO', 'tester2');
    aliases = await rr.listAliases(rdb.db);
    assert.equal(aliases.filter(a => a.sdp_label === 'NEWSITE').length, 1, 'no dup');
    assert.equal(aliases.find(a => a.sdp_label === 'NEWSITE').code, 'MGO', 'updated');
    const del = await rr.deleteAlias(rdb.db, 'NEWSITE');
    assert.equal(del.deleted, 1, 'deleted (rowCount)');
    assert.ok(!(await rr.listAliases(rdb.db)).find(a => a.sdp_label === 'NEWSITE'), 'gone');
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

test('rr pg: loadOccurrencesFromDB + listUnmappedSites', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb, rr } = b;
  try {
    await rdb.upsertRequestBatch([
      _req({request_id:'I1', site:'HOUNDE', request_type:'Incident', category:'Network & Internet Access', sub_category:'Network issues', created_time:'2026-05-10 09:00:00'}),
      _req({request_id:'I2', site:'ZZZ-OFFGRID', request_type:'Incident', category:'Network & Internet Access', sub_category:'Network issues', created_time:'2026-05-11 09:00:00'}),
    ]);
    const { occurrences, diagnostics } = await rr.loadOccurrencesFromDB(rdb.db, '2026-05');
    assert.ok(diagnostics.total_incident_rows >= 2, 'both incident rows read');
    assert.ok(diagnostics.classified >= 1, 'mapped+classified ≥ 1');
    assert.ok(occurrences['HGO'], 'HGO bucket present');
    const unmapped = await rr.listUnmappedSites(rdb.db, '2026-05');
    assert.ok(unmapped.find(u => u.sdp_label === 'ZZZ-OFFGRID'), 'unmapped site surfaced');
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});
