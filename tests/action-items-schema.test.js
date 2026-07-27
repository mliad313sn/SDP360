'use strict';
// SP1b Task 1 — action_items gains a stable uid; existing NULL-uid rows are
// backfilled at boot. Tests the backfill logic in isolation (own in-memory db).
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'ai-schema-'));
process.env.REPORTS_BACKEND = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'ai-schema-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'ai-schema-pass-0000';

const { test } = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const rdb = require('../reports-db');

test('_backfillActionUids fills NULL uids only, distinct, preserving set ones', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE action_items (id INTEGER PRIMARY KEY AUTOINCREMENT, report_id INTEGER, task TEXT, uid TEXT)');
  db.prepare("INSERT INTO action_items (report_id,task,uid) VALUES (1,'a',NULL),(1,'b','keep-me'),(1,'c',NULL)").run();
  const n = rdb._backfillActionUids(db);
  assert.equal(n, 2, 'two NULL rows backfilled');
  const rows = db.prepare('SELECT task,uid FROM action_items ORDER BY task').all();
  assert.ok(rows[0].uid && rows[0].uid.length >= 8, 'a got a uid');
  assert.equal(rows[1].uid, 'keep-me', 'b preserved');
  assert.ok(rows[2].uid && rows[2].uid !== rows[0].uid, 'c got a distinct uid');
  assert.equal(rdb._backfillActionUids(db), 0, 'idempotent — no NULLs remain');
});
