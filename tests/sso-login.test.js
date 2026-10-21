'use strict';
// E2 / F5 — services/ssoLogin: the two callback decision steps, with a stub rdb.
// Proves (a) a link conflict is refused with the NEUTRAL code (same as "not provisioned"),
// (b) an unknown identity is refused the same way, (c) a groups overage logs a risk event
// and applies NO provisioning, (d) a normal login applies the group plan.

const { test } = require('node:test');
const assert = require('node:assert');
const ssoLogin = require('../services/ssoLogin');

function stubRdb({ user = null, linkThrows = null } = {}) {
  const calls = { find: [], link: [], log: [], update: [] };
  return {
    calls,
    async findUserByEntra(args) { calls.find.push(args); return user; },
    async linkUserEntra(id, oid, email) {
      calls.link.push({ id, oid, email });
      if (linkThrows) { const e = new Error('conflict'); e.code = linkThrows; throw e; }
      return true;
    },
    logEvent(ev) { calls.log.push(ev); },
    async updateUser(id, patch) { calls.update.push({ id, patch }); },
  };
}
const claims = { oid: 'oid-1', email: 'a@edv-ops.com', email_source: 'email', groups: ['g-admin'], groups_overage: false };
const settings = { breakglassUser: 'bg', groupMap: [{ group: 'g-admin', roles: ['admin'], site_id: null }] };

test('matchAndLink passes the claim source + break-glass name down and returns the user', async () => {
  const rdb = stubRdb({ user: { id: 7, username: 'ana' } });
  const r = await ssoLogin.matchAndLink(rdb, claims, settings);
  assert.equal(r.user.id, 7); assert.equal(r.deny, null);
  assert.deepEqual(rdb.calls.find[0], { oid: 'oid-1', email: 'a@edv-ops.com', email_source: 'email', breakglassUser: 'bg' });
  assert.deepEqual(rdb.calls.link[0], { id: 7, oid: 'oid-1', email: 'a@edv-ops.com' });
});

test('matchAndLink: unknown identity and link conflict are refused with the SAME neutral code', async () => {
  const none = await ssoLogin.matchAndLink(stubRdb({ user: null }), claims, settings);
  assert.equal(none.user, null); assert.equal(none.deny, 'not_provisioned');
  const conflict = await ssoLogin.matchAndLink(stubRdb({ user: { id: 7, username: 'ana' }, linkThrows: 'sso_link_conflict' }), claims, settings);
  assert.equal(conflict.user, null); assert.equal(conflict.deny, none.deny, 'nothing distinguishes a conflict from "not provisioned"');
  await assert.rejects(ssoLogin.matchAndLink(stubRdb({ user: { id: 7, username: 'ana' }, linkThrows: 'db_down' }), claims, settings),
    e => e.code === 'db_down', 'other errors still propagate');
});

test('provisionFromGroups: overage → sso_groups_overage risk event, NO update', async () => {
  const rdb = stubRdb();
  const r = await ssoLogin.provisionFromGroups(rdb, { id: 7, username: 'ana' }, { ...claims, groups: [], groups_overage: true }, settings, '10.0.0.1');
  assert.deepEqual(r, { applied: false, overage: true });
  assert.equal(rdb.calls.update.length, 0, 'roles untouched');
  assert.equal(rdb.calls.log.length, 1);
  assert.equal(rdb.calls.log[0].action, 'sso_groups_overage');
  assert.equal(rdb.calls.log[0].risk, 1);
  assert.equal(rdb.calls.log[0].target, 'ana');
});

test('provisionFromGroups: normal login applies the pure plan (one update + identity log)', async () => {
  const rdb = stubRdb();
  const r = await ssoLogin.provisionFromGroups(rdb, { id: 7, username: 'ana', roles: ['viewer'] }, claims, settings, null);
  assert.equal(r.overage, false);
  assert.equal(r.applied, true);
  assert.equal(rdb.calls.update.length, 1);
  assert.equal(rdb.calls.log[0].action, 'user_role_changed');
});
