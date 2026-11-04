'use strict';
// Teams SLA alerts — anti-duplicate log: one alert per (ticket, kind), ever. PostgreSQL.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'slalog-'));
process.env.DASH_USER = process.env.DASH_USER || 'slalog-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'slalog-pass-0000';
const test = require('node:test');
const assert = require('node:assert');
const log = require('../services/slaAlertLog');

const A = (id, kind) => ({ request_id: id, kind, group: 'G' });

test('unsent filters what was already recorded; record is idempotent', async () => {
  const db = await require('./_pg-fresh').fresh(['sla_alert_log']);
  assert.deepEqual((await log.filterUnsent(db, [A('1', 'fr_soon'), A('2', 'fr_soon')])).length, 2);
  await log.record(db, [A('1', 'fr_soon')]);
  await log.record(db, [A('1', 'fr_soon')]);   // no throw on a duplicate
  const left = await log.filterUnsent(db, [A('1', 'fr_soon'), A('1', 'fr_breach'), A('2', 'fr_soon')]);
  assert.deepEqual(left.map(a => a.request_id + ':' + a.kind), ['1:fr_breach', '2:fr_soon']);
});

test('empty input is a no-op', async () => {
  const db = await require('./_pg-fresh').fresh(['sla_alert_log']);
  assert.deepEqual(await log.filterUnsent(db, []), []);
  await log.record(db, []);
});

test('purge drops rows older than N days', async () => {
  const db = await require('./_pg-fresh').fresh(['sla_alert_log']);
  await log.record(db, [A('1', 'fr_soon')]);
  await require('../reports-db').pgHandle().prepare(`UPDATE sla_alert_log SET sent_at = now() - interval '100 days'`).run();
  await log.record(db, [A('2', 'fr_soon')]);
  assert.equal(await log.purge(db, 90), 1);
  assert.equal((await log.filterUnsent(db, [A('1', 'fr_soon')])).length, 1, 'purged → could alert again (ticket long gone anyway)');
});

// A-23 — due_ms + dedup_mode (once = today; per_due re-alerts a re-planned deadline)
const D = (id, kind, due_ms) => ({ request_id: id, kind, group: 'G', due_ms });

test('mode once: same (ticket, kind) with a new due_ms stays filtered (today)', async () => {
  const db = await require('./_pg-fresh').fresh(['sla_alert_log']);
  await log.record(db, [D('1', 'res_soon', 1000)]);
  assert.equal((await log.filterUnsent(db, [D('1', 'res_soon', 2000)])).length, 0);
  assert.equal((await log.filterUnsent(db, [D('1', 'res_soon', 2000)], { mode: 'once' })).length, 0);
  const row = await require('../reports-db').pgHandle().prepare('SELECT due_ms FROM sla_alert_log WHERE request_id = ?').get('1');
  assert.equal(Number(row.due_ms), 1000, 'the column is filled even in mode once');
});

test('mode per_due: a new due_ms is unsent, recording updates it, the same due_ms is then filtered', async () => {
  const db = await require('./_pg-fresh').fresh(['sla_alert_log']);
  const o = { mode: 'per_due' };
  await log.record(db, [D('1', 'res_soon', 1000)], o);
  assert.equal((await log.filterUnsent(db, [D('1', 'res_soon', 1000)], o)).length, 0);
  assert.equal((await log.filterUnsent(db, [D('1', 'res_soon', 2000)], o)).length, 1, 're-planned deadline');
  await log.record(db, [D('1', 'res_soon', 2000)], o);
  assert.equal((await log.filterUnsent(db, [D('1', 'res_soon', 2000)], o)).length, 0);
  assert.equal((await log.filterUnsent(db, [D('1', 'unassigned', null)], o)).length, 1);
  await log.record(db, [D('1', 'unassigned', null)], o);
  assert.equal((await log.filterUnsent(db, [D('1', 'unassigned', null)], o)).length, 0, 'null due_ms → sent once');
});

test('per_due: a legacy row with NULL due_ms counts as sent (no flood after deploy)', async () => {
  const db = await require('./_pg-fresh').fresh(['sla_alert_log']);
  await log.record(db, [A('1', 'fr_soon')]);   // legacy shape, no due_ms
  assert.equal((await log.filterUnsent(db, [D('1', 'fr_soon', 5000)], { mode: 'per_due' })).length, 0);
});
