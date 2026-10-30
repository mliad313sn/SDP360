'use strict';
const test = require('node:test');
const assert = require('node:assert');
const log = require('../services/reportSentLog');

async function freshDb() { return require('./_pg-fresh').fresh(['report_sent_log']); }

test('record then alreadySentToday true for same (type,site,period)', async () => {
  const db = (await freshDb());
  (await log.record(db, { report_type: 'coordinator', site_code: 'HGO', period: '2026-07', recipients: 'a@x', result: 'ok' }));
  assert.strictEqual((await log.alreadySentToday(db, 'coordinator', 'HGO', '2026-07')), true);
});

test('alreadySentToday false for a different period', async () => {
  const db = (await freshDb());
  (await log.record(db, { report_type: 'coordinator', site_code: 'HGO', period: '2026-07', recipients: 'a@x', result: 'ok' }));
  assert.strictEqual((await log.alreadySentToday(db, 'coordinator', 'HGO', '2026-08')), false);
});

test('alreadySentToday false when nothing recorded', async () => {
  assert.strictEqual((await log.alreadySentToday((await freshDb()), 'coordinator', 'HGO', '2026-07')), false);
});
