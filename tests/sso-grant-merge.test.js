'use strict';
// C-18 — the SSO trap: Entra group provisioning REPLACES the role set on every login. Roles held through an
// ACTIVE access grant (an approved request) must survive it, every feature role the platform knows must be
// mappable, an unreadable grant table must skip provisioning rather than strip an approved access, and a
// role-only patch must not null the account's name/site (updateUser rewrites them from its arguments).
const { test } = require('node:test');
const assert = require('node:assert');
const prov = require('../services/ssoProvisioning');
const { provisionFromGroups } = require('../services/ssoLogin');
const rdb = require('../reports-db');

const MAP = prov.parseGroupMap([{ group: 'g-site', roles: ['editor'], site_id: 3 }]);

test('every feature role of reports-db is mappable from a group (the five newer roles were dropped)', () => {
  for (const r of rdb.FEATURE_ROLES_KNOWN) assert.ok(prov.FEATURE_ROLES.has(r), r);
  const p = prov.planProvisioning({ role: 'viewer', roles: ['viewer'] }, ['g'], prov.parseGroupMap([{ group: 'g', roles: ['field-tech', 'committee-member', 'finance-viewer', 'dashboard-publisher', 'site-business'] }]));
  assert.deepEqual([...p.patch.roles].sort(), ['committee-member', 'dashboard-publisher', 'field-tech', 'finance-viewer', 'site-business']);
});

test('roles held by an active grant are merged back into the group-mapped set', () => {
  const user = { role: 'editor', roles: ['editor', 'finance-viewer'], site_id: 3 };
  const without = prov.planProvisioning(user, ['g-site'], MAP);
  assert.deepEqual(without.patch.roles, ['editor'], 'today: the grant role is stripped');
  const merged = prov.planProvisioning(user, ['g-site'], MAP, { keepRoles: ['finance-viewer'] });
  assert.equal(merged.changed, false, 'nothing to change: the grant keeps finance-viewer');
  const fresh = prov.planProvisioning({ role: 'viewer', roles: ['viewer'] }, ['g-site'], MAP, { keepRoles: ['finance-viewer'] });
  assert.deepEqual([...fresh.patch.roles].sort(), ['editor', 'finance-viewer']); assert.deepEqual(fresh.kept, ['finance-viewer']);
  assert.ok(!prov.planProvisioning({ role: 'viewer' }, ['g-site'], MAP, { keepRoles: ['super_admin'] }).patch.roles.includes('super_admin'));
});

function fakeRdb() {
  const calls = { update: [], log: [] };
  return { calls, async updateUser(id, patch) { calls.update.push({ id, patch }); }, logEvent(e) { calls.log.push(e); } };
}

test('provisionFromGroups: merges live grant roles, keeps name/site/active in the update, logs kept_by_grant', async () => {
  const r = fakeRdb();
  const user = { id: 7, username: 'u7', full_name: 'User Seven', site_id: 3, active: 1, role: 'viewer' };
  const out = await provisionFromGroups(r, user, { groups: ['g-site'] }, { groupMap: MAP, liveGrantRoles: async () => ['finance-viewer'] });
  assert.equal(out.applied, true);
  const p = r.calls.update[0].patch;
  assert.deepEqual([...p.roles].sort(), ['editor', 'finance-viewer']);
  assert.equal(p.full_name, 'User Seven'); assert.equal(p.site_id, 3); assert.equal(p.active, 1);
  assert.deepEqual(r.calls.log[0].details.kept_by_grant, ['finance-viewer']);
});

test('provisionFromGroups: grants unreadable → no provisioning this login (never strip an approved access)', async () => {
  const r = fakeRdb();
  const out = await provisionFromGroups(r, { id: 7, username: 'u7', full_name: 'x', role: 'viewer' }, { groups: ['g-site'] }, { groupMap: MAP, liveGrantRoles: async () => { throw new Error('db down'); } });
  assert.equal(out.applied, false); assert.equal(out.grants_unreadable, true); assert.equal(r.calls.update.length, 0);
});

test('provisionFromGroups on PostgreSQL: a live grant read from access_grants survives the group map', async () => {
  const H = rdb.pgHandle();
  await rdb.createUser({ username: 'sso_merge', full_name: 'SSO Merge', password: 'sso_merge_pw_000', roles: ['viewer'] });
  const u = await H.prepare('SELECT * FROM users WHERE username = ?').get('sso_merge');
  const d = new Date().toISOString().slice(0, 10);
  await H.prepare('INSERT INTO access_grants (user_id, role, request_id, valid_from, valid_to, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(u.id, 'finance-viewer', 1, d, '2099-12-31', d);
  const out = await provisionFromGroups(rdb, u, { groups: ['g-site'] }, { groupMap: prov.parseGroupMap([{ group: 'g-site', roles: ['editor'] }]) });
  assert.equal(out.applied, true);
  const after = (await rdb.listUsers()).find((x) => x.username === 'sso_merge');
  assert.deepEqual([...after.roles].sort(), ['editor', 'finance-viewer']);
  assert.equal(after.full_name, 'SSO Merge', 'name kept (a role-only patch used to null it)');
});
