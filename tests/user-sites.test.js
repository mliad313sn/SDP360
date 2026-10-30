'use strict';
// Multi-site editors (2026-10-05) — a user keeps ONE primary site (users.site_id) and may get
// extra sites (user_sites). The session carries site_ids = [primary, ...extras]; every site
// check asks "is this one of the user's sites?". Pure helpers + the sqlite store.
const fs = require('fs'), path = require('path'), os = require('os');
process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'user-sites-'));
process.env.DASH_USER = process.env.DASH_USER || 'us-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'us-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const U = require('../services/userSites');

test('siteIds: primary first, extras de-duplicated, junk dropped', () => {
  assert.deepEqual(U.siteIds({ site_id: 3, site_ids: [3, 5, '7', null, 0, 'x'] }), [3, 5, 7]);
  assert.deepEqual(U.siteIds({ site_id: 4 }), [4], 'a session from before the change still works');
  assert.deepEqual(U.siteIds({ site_id: null, site_ids: [] }), []);
  assert.deepEqual(U.siteIds(null), []);
});

test('hasSite / codesFor / pickCode', () => {
  const u = { site_id: 1, site_ids: [1, 2] };
  assert.equal(U.hasSite(u, 2), true);
  assert.equal(U.hasSite(u, '1'), true);
  assert.equal(U.hasSite(u, 9), false);
  const sites = [{ id: 1, name: 'Ity' }, { id: 2, name: 'Hounde' }, { id: 3, name: 'Mana' }];
  const toCode = (s) => ({ Ity: 'SMI', Hounde: 'HGO', Mana: 'MGO' }[s && s.name] || null);
  assert.deepEqual(U.codesFor(u, sites, toCode), ['SMI', 'HGO']);
  assert.deepEqual(U.codesFor({ site_id: 3, site_ids: [3, 99] }, sites, toCode), ['MGO'], 'unknown site id ignored');
  // pickCode: the object's code when the user holds it, else the primary code; null when none
  assert.equal(U.pickCode(['SMI', 'HGO'], 'hgo'), 'HGO');
  assert.equal(U.pickCode(['SMI', 'HGO'], 'MGO'), 'SMI');
  assert.equal(U.pickCode(['SMI', 'HGO'], null), 'SMI');
  assert.equal(U.pickCode([], 'SMI'), null);
  // inScope: a string or a list of codes, case-insensitive
  assert.equal(U.inScope('hgo', ['SMI', 'HGO']), true);
  assert.equal(U.inScope('MGO', 'SMI'), false);
  assert.equal(U.inScope('SMI', 'smi'), true);
});


test('meetings + inspection guards accept a LIST of site codes', async () => {
  const mdb = require('../meetings-db');
  const hdr = (site) => ({ header: { site_code: site, department: 'Mining', meeting_date: '2026-09-10', status: 'draft' } });
  await mdb.saveMeeting(hdr('HGO'), ['SMI', 'HGO'], null);
  await mdb.saveMeeting(hdr('SMI'), ['SMI', 'HGO'], null);
  await assert.rejects(async () => Promise.resolve().then(async () => (await mdb.saveMeeting(hdr('MGO'), ['SMI', 'HGO'], null))), /Cross-site/);
  await assert.rejects(async () => Promise.resolve().then(async () => (await mdb.saveMeeting(hdr('SMI'), [], null))), /Cross-site/, 'an empty list is not global');
  const idb = require('../inspection-db');
  const st = (id, site) => ({ meta: { f_id: id, f_site: site, f_date: '2026-09-10', f_area: 'Server room', f_lead: 'T' }, items: {}, actions: [] });
  await idb.saveInspection(st('EM-MS-1', 'Hounde (HGO)'), ['SMI', 'HGO'], null);
  await assert.rejects(async () => Promise.resolve().then(async () => (await idb.saveInspection(st('EM-MS-2', 'Mana (MGO)'), ['SMI', 'HGO'], null))), /Cross-site/);
});
