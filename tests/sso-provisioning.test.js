'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const P = require('../services/ssoProvisioning');

test('parseGroupMap: tolerant JSON, lowercases group ids, drops super_admin and bad entries', () => {
  assert.deepEqual(P.parseGroupMap(''), []); assert.deepEqual(P.parseGroupMap('{bad'), []);
  const m = P.parseGroupMap('[{"group":"ABC-1","roles":["editor","super_admin","tracker-editor"],"site_id":"3"},{"roles":["admin"]},{"group":"g2","roles":["admin"],"site_id":"x"}]');
  assert.deepEqual(m, [{ group: 'abc-1', roles: ['editor', 'tracker-editor'], site_id: 3 }, { group: 'g2', roles: ['admin'], site_id: null }]);
});

test('planProvisioning: union of matched roles replaces the stored ones, first site wins, no match = no change', () => {
  const map = P.parseGroupMap([{ group: 'G-EDIT', roles: ['editor', 'tracker-editor'], site_id: 3 }, { group: 'G-AUD', roles: ['audit-viewer'] }]);
  const u = { id: 1, role: 'viewer', roles: ['viewer'], site_id: 9 };
  const plan = P.planProvisioning(u, ['g-edit', 'g-aud', 'other'], map);
  assert.equal(plan.changed, true);
  assert.deepEqual(plan.patch, { roles: ['editor', 'tracker-editor', 'audit-viewer'], role: 'editor', site_id: 3 });
  assert.equal(P.planProvisioning(u, ['nothing'], map).changed, false);
  assert.equal(P.planProvisioning(u, [], []).changed, false);
});

test('planProvisioning: identical roles → unchanged; super_admin never touched; empty role set never applied', () => {
  const map = P.parseGroupMap([{ group: 'g', roles: ['editor'] }, { group: 'h', roles: ['bogus-role'] }]);
  assert.equal(P.planProvisioning({ roles: ['editor'], site_id: 1 }, ['g'], map).changed, false);
  assert.equal(P.planProvisioning({ roles: ['super_admin'] }, ['g'], map).changed, false);
  assert.equal(P.planProvisioning({ roles: ['viewer'] }, ['h'], map).changed, false, 'unknown roles filtered → empty → untouched');
});
