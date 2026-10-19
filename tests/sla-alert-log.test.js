'use strict';
// Teams SLA alerts — anti-duplicate log: one alert per (ticket, kind), ever. sqlite.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'slalog-'));
process.env.REPORTS_BACKEND = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'slalog-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'slalog-pass-0000';
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const log = require('../services/slaAlertLog');

const A = (id, kind) => ({ request_id: id, kind, group: 'G' });

test('unsent filters what was already recorded; record is idempotent', async () => {
  const db = new Database(':memory:');
  assert.deepEqual((await log.filterUnsent(db, [A('1', 'fr_soon'), A('2', 'fr_soon')])).length, 2);
  await log.record(db, [A('1', 'fr_soon')]);
  await log.record(db, [A('1', 'fr_soon')]);   // no throw on a duplicate
  const left = await log.filterUnsent(db, [A('1', 'fr_soon'), A('1', 'fr_breach'), A('2', 'fr_soon')]);
  assert.deepEqual(left.map(a => a.request_id + ':' + a.kind), ['1:fr_breach', '2:fr_soon']);
});

test('empty input is a no-op', async () => {
  const db = new Database(':memory:');
  assert.deepEqual(await log.filterUnsent(db, []), []);
  await log.record(db, []);
});

test('purge drops rows older than N days', async () => {
  const db = new Database(':memory:');
  await log.record(db, [A('1', 'fr_soon')]);
  db.prepare(`UPDATE sla_alert_log SET sent_at = datetime('now','-100 days')`).run();
  await log.record(db, [A('2', 'fr_soon')]);
  assert.equal(await log.purge(db, 90), 1);
  assert.equal((await log.filterUnsent(db, [A('1', 'fr_soon')])).length, 1, 'purged → could alert again (ticket long gone anyway)');
});
