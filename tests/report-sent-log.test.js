'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const log = require('../services/reportSentLog');

function freshDb() { const db = new Database(':memory:'); log._initSchema(db); return db; }

test('record then alreadySentToday true for same (type,site,period)', () => {
  const db = freshDb();
  log.record(db, { report_type: 'coordinator', site_code: 'HGO', period: '2026-07', recipients: 'a@x', result: 'ok' });
  assert.strictEqual(log.alreadySentToday(db, 'coordinator', 'HGO', '2026-07'), true);
});

test('alreadySentToday false for a different period', () => {
  const db = freshDb();
  log.record(db, { report_type: 'coordinator', site_code: 'HGO', period: '2026-07', recipients: 'a@x', result: 'ok' });
  assert.strictEqual(log.alreadySentToday(db, 'coordinator', 'HGO', '2026-08'), false);
});

test('alreadySentToday false when nothing recorded', () => {
  assert.strictEqual(log.alreadySentToday(freshDb(), 'coordinator', 'HGO', '2026-07'), false);
});
