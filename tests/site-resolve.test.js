'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { resolveSite, listAuthorizedSites } = require('../services/siteResolve');

const SITES = [
  { id: 1, name: 'Hounde', zoho_group: 'Hounde IT Agents' },
  { id: 2, name: 'Mana', zoho_group: 'Mana IT Agent' },
  { id: 3, name: 'Exploration', zoho_group: 'Exploration BF Support,Exploration CI Support' },
];
const MEETINGS_CODES = [{ site_id: 1, code: 'HGO' }, { site_id: 2, code: 'MGO' }];
const deps = {
  listSites: () => SITES,
  listSiteModuleCodes: (m) => (m === 'meetings' ? MEETINGS_CODES : []),
  userHasRole: (u, r) => (u.roles || []).includes(r),
  inspectionSiteCode: (name) => ({ Hounde: 'HGO', Mana: 'MGO' }[name] || null),
  trackerSiteCode: (name) => ({ Hounde: 'HGO', Mana: 'MGO' }[name] || null),
};

test('resolveSite maps a canonical site_id to every module code', () => {
  const r = resolveSite(deps, 1);
  assert.equal(r.site_id, 1);
  assert.equal(r.site_name, 'Hounde');
  assert.equal(r.helpdesk_group, 'Hounde IT Agents');
  assert.equal(r.meetings_code, 'HGO');
  assert.equal(r.inspection_code, 'HGO');
  assert.equal(r.tracker_code, 'HGO');
});

test('a missing module code stays null — never guessed (Exploration has no meetings code)', () => {
  const r = resolveSite(deps, 3);
  assert.equal(r.helpdesk_group, 'Exploration BF Support,Exploration CI Support');
  assert.strictEqual(r.meetings_code, null, 'no meetings code → null, not borrowed');
});

test('resolveSite returns null for an unknown site_id', () => {
  assert.strictEqual(resolveSite(deps, 999), null);
});

test('listAuthorizedSites: site-business sees only their site_id', () => {
  const got = listAuthorizedSites(deps, { roles: ['site-business'], site_id: 2 });
  assert.deepEqual(got, [{ site_id: 2, site_name: 'Mana' }]);
});

test('listAuthorizedSites: group-business (and executive) see all sites', () => {
  const all = listAuthorizedSites(deps, { roles: ['group-business'] });
  assert.equal(all.length, 3);
  assert.deepEqual(listAuthorizedSites(deps, { roles: ['executive'] }).map(s => s.site_id), [1, 2, 3]);
});

test('listAuthorizedSites: site-business with no site_id sees nothing (fails safe)', () => {
  assert.deepEqual(listAuthorizedSites(deps, { roles: ['site-business'] }), []);
});
