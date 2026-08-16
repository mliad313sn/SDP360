'use strict';
// V1b-E Task 2 — wan_subsite_networks store: dual-backend reader/writer (sqlite here).
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_p.join(_os.tmpdir(), 'wansub-'));
process.env.REPORTS_BACKEND = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'wansub-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'wansub-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const rdb = require('../reports-db');

test('setWanSubsiteNetworks upserts + deletes (replace-all for the given set)', async () => {
  // The reader JOINs sites, so the target site must exist.
  const site = await rdb.createSite({ name: 'ExploSubTest1', zoho_group: 'ExploSubTest1 IT' });
  const sid = site.id;

  await rdb.setWanSubsiteNetworks([
    { site_id: sid, sub_site: 'FETEKRO', network: 'Exploration Fetekro' },
    { site_id: sid, sub_site: 'TANDA',   network: 'Exploration Tanda' },
  ]);
  let rows = (await rdb.listWanSubsiteNetworks()).filter(r => r.site_id === sid);
  assert.equal(rows.length, 2, 'both sub-sites saved');
  assert.ok(rows.find(r => r.sub_site === 'FETEKRO' && r.network === 'Exploration Fetekro'));
  assert.ok(rows.find(r => r.sub_site === 'TANDA'   && r.network === 'Exploration Tanda'));
  assert.equal(rows[0].site_name, 'ExploSubTest1', 'JOIN returns the site name');

  // Re-save without TANDA (FETEKRO network renamed) → TANDA removed, FETEKRO updated.
  await rdb.setWanSubsiteNetworks([{ site_id: sid, sub_site: 'FETEKRO', network: 'Exploration Fetekro X' }]);
  rows = (await rdb.listWanSubsiteNetworks()).filter(r => r.site_id === sid);
  assert.equal(rows.length, 1, 'replace-all removed TANDA');
  assert.equal(rows[0].sub_site, 'FETEKRO');
  assert.equal(rows[0].network, 'Exploration Fetekro X', 'network updated');
});

test('blank sub_site or network rows are skipped', async () => {
  const site = await rdb.createSite({ name: 'ExploSubTest2', zoho_group: 'ExploSubTest2 IT' });
  const sid = site.id;
  await rdb.setWanSubsiteNetworks([
    { site_id: sid, sub_site: 'FETEKRO', network: 'Net A' },
    { site_id: sid, sub_site: '   ',     network: 'Net B' },   // blank token → skip
    { site_id: sid, sub_site: 'TANDA',   network: '   ' },     // blank network → skip
  ]);
  const rows = (await rdb.listWanSubsiteNetworks()).filter(r => r.site_id === sid);
  assert.equal(rows.length, 1, 'only the well-formed row persists');
  assert.equal(rows[0].sub_site, 'FETEKRO');
});
