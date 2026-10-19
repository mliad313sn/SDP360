'use strict';
// Chunk 4E — reporting suite tables under PostgreSQL. TDD suite. Runs the
// postgres backend against a throwaway DB; skips cleanly when PG is unreachable.
process.env.REPORTS_BACKEND = 'postgres';
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'rrep-'));
process.env.DASH_USER = process.env.DASH_USER || 'pgtest-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'pgtest-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');

async function boot() {
  const ctx = await provisionTestDb();
  if (!ctx) return null;
  process.env.PG_URL = ctx.url;
  const rdb = require('../reports-db');
  await rdb.initPgReports();      // applies 001..005 (005_reporting.sql included)
  return { ctx, rdb };
}

test('reporting pg: 4 tables exist after initPgReports', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb } = b;
  try {
    const h = rdb.pgHandle();
    for (const tbl of ['report_recipients', 'report_config', 'report_schedules', 'report_sent_log']) {
      const r = await h.prepare(`SELECT to_regclass(?) AS reg`).get('public.' + tbl);
      assert.ok(r.reg, `table ${tbl} exists`);
    }
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

test('reporting pg: reportConfig set/get round-trip', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb } = b;
  const rc = require('../services/reportConfig');
  try {
    await rc.setConfig(null, { smtp_host: 'mail.edv-ops.com', smtp_port: '25' }, 'tester');
    const cfg = await rc.getConfig(null);
    assert.equal(cfg.smtp_host, 'mail.edv-ops.com');
    assert.equal(cfg.smtp_port, '25');
    assert.equal(cfg.default_email_domain, 'edv-ops.com'); // default preserved
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

test('reporting pg: reportDirectory upsert/list round-trip', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb } = b;
  const rd = require('../services/reportDirectory');
  try {
    await rd.upsertRecipient(null, 'HGO', { site_name: 'Hounde', coordinator_email: 'coord@x', coordinator_email_confirmed: 1 }, 'tester');
    const rows = await rd.listRecipients(null);
    const row = rows.find(r => r.site_code === 'HGO');
    assert.ok(row, 'HGO recipient present');
    assert.equal(row.coordinator_email, 'coord@x');
    assert.equal(Number(row.coordinator_email_confirmed), 1);
    // update-in-place via ON CONFLICT
    await rd.upsertRecipient(null, 'HGO', { fm_email: 'fm@x' }, 'tester');
    const after = (await rd.listRecipients(null)).find(r => r.site_code === 'HGO');
    assert.equal(after.fm_email, 'fm@x');
    assert.equal(after.coordinator_email, 'coord@x'); // untouched
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});
