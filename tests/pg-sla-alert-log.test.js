'use strict';
// Teams SLA alerts — anti-duplicate log, PostgreSQL parity (013_sla_alert_log.sql).
process.env.REPORTS_BACKEND = 'postgres';
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'slalog-'));
process.env.DASH_USER = process.env.DASH_USER || 'pgtest-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'pgtest-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');

test('pg: filterUnsent / record / purge', async (t) => {
  const ctx = await provisionTestDb(); if (!ctx) return t.skip('no pg');
  process.env.PG_URL = ctx.url;
  const rdb = require('../reports-db');
  await rdb.initPgReports();
  const log = require('../services/slaAlertLog');
  try {
    const A = (id, kind) => ({ request_id: id, kind, group: 'G' });
    await log.record(null, [A('1', 'fr_soon'), A('1', 'fr_soon')]);
    const left = await log.filterUnsent(null, [A('1', 'fr_soon'), A('2', 'res_soon')]);
    assert.deepEqual(left.map(a => a.request_id + ':' + a.kind), ['2:res_soon']);
    await rdb.pgHandle().prepare(`UPDATE sla_alert_log SET sent_at = now() - interval '100 days'`).run();
    assert.equal(await log.purge(null, 90), 1);
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});
