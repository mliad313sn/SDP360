// tests/site-resolve.test.js
'use strict';
process.env.REPORTS_BACKEND = 'sqlite';   // before any require
// Isolate from the developer's real data/reports.db — point at a throwaway dir
// (sites + site_module_codes are seeded at boot by INSERT OR IGNORE).
const os = require('os'); const path = require('path'); const fs = require('fs');
process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sdp-siteresolve-'));
// A fresh data dir means a first boot — reports-db refuses to mint its default
// admin without these. Same harness convention as tests/db-schema-smoke.test.js.
process.env.DASH_USER = process.env.DASH_USER || 'smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'smoke-pass-0000';
const test = require('node:test');
const assert = require('node:assert');
const rdb = require('../reports-db');

test('getSiteIdByModuleCode resolves a meetings code to a site row', () => {
  // reports.db seeds sites + site_module_codes at boot.
  const r = rdb.getSiteIdByModuleCode('meetings', 'HGO');
  assert.ok(r, 'expected a row for meetings/HGO');
  assert.strictEqual(typeof r.site_id, 'number');
  assert.strictEqual(r.name, 'Hounde');
  assert.ok(typeof r.zoho_group === 'string' || r.zoho_group === null);
});

test('is case-insensitive on the code', () => {
  assert.strictEqual(rdb.getSiteIdByModuleCode('meetings', 'hgo')?.site_id,
                     rdb.getSiteIdByModuleCode('meetings', 'HGO')?.site_id);
});

test('returns null for an unknown code', () => {
  assert.strictEqual(rdb.getSiteIdByModuleCode('meetings', 'NOPE'), null);
});

test('Ity uses SMI in the meetings namespace (not the tracker ITY)', () => {
  assert.strictEqual(rdb.getSiteIdByModuleCode('meetings', 'SMI')?.name, 'Ity');
  assert.strictEqual(rdb.getSiteIdByModuleCode('meetings', 'ITY'), null);
});

// ── listSiteModuleCodes (Task 9's reader — same table, implemented alongside) ──

test('listSiteModuleCodes returns the meetings codes ordered by site name', () => {
  const rows = rdb.listSiteModuleCodes('meetings');
  assert.ok(Array.isArray(rows));
  assert.ok(rows.length > 0, 'expected meetings codes to be seeded');
  for (const r of rows) {
    assert.strictEqual(typeof r.site_id, 'number');
    assert.strictEqual(typeof r.code, 'string');
    assert.strictEqual(typeof r.name, 'string');
  }
  const hgo = rows.find(r => r.code === 'HGO');
  assert.ok(hgo, 'expected HGO among the meetings codes');
  assert.strictEqual(hgo.name, 'Hounde');
  // Ity is SMI in the meetings namespace — the tracker ITY must not appear.
  assert.ok(rows.some(r => r.code === 'SMI'));
  assert.ok(!rows.some(r => r.code === 'ITY'));
  // ordered by site name
  const names = rows.map(r => r.name);
  assert.deepStrictEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
});

test('listSiteModuleCodes returns [] for an unknown module', () => {
  assert.deepStrictEqual(rdb.listSiteModuleCodes('nope'), []);
});
