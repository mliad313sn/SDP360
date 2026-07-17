// tests/assets-db-init.test.js
'use strict';
process.env.ASSETS_BACKEND = 'sqlite';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');

// point the module at a throwaway data dir BEFORE requiring it
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-'));
process.env.SDP_DATA_DIR = TMP;
const db = require('../assets-db');

test('init creates the 5 tables', () => {
  const h = db.getDB();
  const names = h.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
  for (const t of ['assets','asset_memory','asset_logical_drives','asset_monitors',
                   'software_licenses']) {
    assert.ok(names.includes(t), `missing table ${t}`);
  }
});

test('asset_monitors has a composite PK (workstation_id, monitor_id)', () => {
  const h = db.getDB();
  const pk = h.prepare("PRAGMA table_info(asset_monitors)").all().filter(c => c.pk > 0).map(c => c.name).sort();
  assert.deepStrictEqual(pk, ['monitor_id','workstation_id']);
});

test('purchase_cost is TEXT (no currency coercion into a numeric type)', () => {
  const h = db.getDB();
  const col = h.prepare("PRAGMA table_info(assets)").all().find(c => c.name === 'purchase_cost');
  assert.strictEqual(String(col.type).toUpperCase(), 'TEXT');
});
