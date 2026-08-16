'use strict';
// V1b-A Task 5 — Meraki network→site seed in site_module_codes (module='meraki'),
// resolved by site NAME (not probe). Fresh sqlite DB seeds DEFAULT_SITES + the map.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_p.join(_os.tmpdir(), 'mrkseed-'));
process.env.REPORTS_BACKEND = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'mrkseed-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'mrkseed-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const rdb = require('../reports-db');

test('Ity Meraki network name resolves to a site_id via module=meraki', async () => {
  const r = await rdb.getSiteIdByModuleCode('meraki', 'Ity Gold Operations');
  assert.ok(r && r.site_id, 'meraki network name resolves to a site');
});

test('resolution is case-insensitive (network names with spaces store fine — no CHECK on code)', async () => {
  const r = await rdb.getSiteIdByModuleCode('meraki', 'ity gold operations');
  assert.ok(r && r.site_id, 'case-insensitive match');
});
