// tests/assets-db-init.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');

// point the module at a throwaway data dir BEFORE requiring it
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-'));
process.env.SDP_DATA_DIR = TMP;
const db = require('../assets-db');

test('init creates the 5 tables', async () => {
  const h = db.getDB();
  const names = (await h.prepare("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY table_name").all()).map(r => r.name);
  for (const t of ['assets','asset_memory','asset_logical_drives','asset_monitors',
                   'software_licenses']) {
    assert.ok(names.includes(t), `missing table ${t}`);
  }
});

test('asset_monitors has a composite PK (workstation_id, monitor_id)', async () => {
  const h = db.getDB();
  const pk = (await h.prepare(`SELECT a.attname AS name FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    WHERE i.indrelid = 'asset_monitors'::regclass AND i.indisprimary`).all()).map(c => c.name).sort();
  assert.deepStrictEqual(pk, ['monitor_id','workstation_id']);
});

test('purchase_cost is TEXT (no currency coercion into a numeric type)', async () => {
  const h = db.getDB();
  const col = (await h.prepare(`SELECT column_name AS name, data_type AS type FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'assets'`).all()).find(c => c.name === 'purchase_cost');
  assert.strictEqual(String(col.type).toUpperCase(), 'TEXT');
});
