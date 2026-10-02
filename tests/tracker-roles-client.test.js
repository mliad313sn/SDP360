'use strict';
// RBAC audit 2026-10-02, lot 2 — the tracker's client role model (App.jsx computeRoles).
//   B1  the site lock was read from __authUser.site_name, which the session user never
//       carries: a tracker-editor saw (and typed into) every site, and the save silently
//       dropped the other sites. The lock now comes from the scope /api/tracker/load returns.
//   A2  the Export PPTX button now follows the server gate (admin tier or tracker-admin).
// computeRoles is plain JS (no JSX), so it is sliced out of App.jsx and run with stubs.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { fnSource } = require('./_fn-source');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'activity-tracker', 'App.jsx'), 'utf8');

function rolesFor(userRoles, scope) {
  const HIER = ['super_admin', 'executive', 'admin', 'editor', 'viewer'];
  const has = (r) => {
    if (userRoles.includes(r)) return true;
    const want = HIER.indexOf(r);
    return want >= 0 && userRoles.some(x => { const i = HIER.indexOf(x); return i >= 0 && i <= want; });
  };
  const fn = new Function('hasRole', '_user', fnSource(SRC, 'computeRoles') + '\nreturn computeRoles;')(
    has, () => ({ id: 1, roles: userRoles, site_id: 3 }));
  return fn(scope);
}

test('B1 a tracker-editor is locked on the scope returned by the server', () => {
  const r = rolesFor(['editor', 'tracker-editor'], 'HGO');
  assert.equal(r.USER_SITE, 'HGO');
  assert.equal(r.CAN_SAVE, true);
});

test('B1 an unresolved scope ("") makes a tracker-editor read-only, like the server', () => {
  const r = rolesFor(['editor', 'tracker-editor'], '');
  assert.equal(r.CAN_SAVE, false);
  assert.equal(r.USER_SITE, null);
});

test('B1 an unrestricted account is never locked', () => {
  assert.equal(rolesFor(['super_admin'], null).USER_SITE, null);
  assert.equal(rolesFor(['admin', 'tracker-admin'], null).USER_SITE, null);
});

test('A2 Export PPTX follows the server gate: admin tier or tracker-admin', () => {
  assert.equal(rolesFor(['admin'], null).CAN_EXPORT, true);
  assert.equal(rolesFor(['viewer', 'tracker-admin'], null).CAN_EXPORT, true);
  assert.equal(rolesFor(['editor', 'tracker-editor'], 'HGO').CAN_EXPORT, false);
});
