'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const rdb = require('../reports-db');

test('site-business / group-business are known feature roles', () => {
  assert.ok(rdb.FEATURE_ROLES_KNOWN.includes('site-business'));
  assert.ok(rdb.FEATURE_ROLES_KNOWN.includes('group-business'));
});

test('userHasRole recognises the new feature roles by exact match', () => {
  const u = { roles: ['site-business'], site_id: 1 };
  assert.equal(rdb.userHasRole(u, 'site-business'), true);
  assert.equal(rdb.userHasRole(u, 'group-business'), false);
  assert.equal(rdb.userHasRole(u, 'admin'), false, 'a feature role must NOT imply hierarchy roles');
});
