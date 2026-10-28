'use strict';
// V1a Task 6 — OPManager probe → site_id mapping (site_module_codes module='opmanager').
// Each probe resolves to the id of the correctly-named site (resolve by NAME, not by
// borrowing another module's code).
const os = require('os'), fs = require('fs'), path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'opm-probe-'));
process.env.DASH_USER = process.env.DASH_USER || 'opm-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'opm-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const rdb = require('../reports-db');

test('each probe resolves to the id of its correctly-named site', async () => {
  const sites = (await rdb.listSites({ includeInactive: true }));
  const idOf = name => (sites.find(s => s.name.toLowerCase() === name.toLowerCase()) || {}).id;
  const maps = { Sabodala: 'Sabodala', LAFIGUE: 'Lafigue', HOUNDE: 'Hounde', Mana: 'MANA',
                 Ity: 'Ity', Ouagadougou: 'Ouagadougou', ABJ: 'Abidjan', Tanda: 'Tanda' };
  for (const [probe, siteName] of Object.entries(maps)) {
    const r = (await rdb.getSiteIdByModuleCode('opmanager', probe));
    assert.ok(r && r.site_id === idOf(siteName), `${probe} → site "${siteName}" (got ${JSON.stringify(r)})`);
  }
});

test('case-insensitive + unmapped probe → null', async () => {
  assert.ok((await rdb.getSiteIdByModuleCode('opmanager', 'tanda')));   // case-insensitive
  assert.equal((await rdb.getSiteIdByModuleCode('opmanager', 'NoSuchProbe')), null);
});
