'use strict';
// G-12 bulk demotion (user request 2026-10-02: "without doing it one by one").
// planDemotion is PURE and reuses roleAudit.classifyAccount, so it touches EXACTLY the
// accounts audit-roles.js lists as over_privileged (admin WITH a site) — never a site-less
// admin (central IT, to confirm), never a super_admin or executive.
const test = require('node:test');
const assert = require('node:assert');
const { planDemotion } = require('../services/roleDemotion');

const U = (username, roles, site_id = 3, site_name = 'Hounde', id = username.length) => ({ id, username, roles, site_id, site_name });

test('an admin with a site becomes editor and keeps every feature role', () => {
  const [p] = planDemotion([U('hounde', ['admin', 'audit-viewer', 'report-author', 'tracker-editor'])]);
  assert.equal(p.username, 'hounde');
  assert.deepEqual(p.after, ['audit-viewer', 'editor', 'report-author', 'tracker-editor']);
});

test('addTrackerEditor adds tracker-editor when it is missing, once', () => {
  const [a] = planDemotion([U('ity', ['admin'])], { addTrackerEditor: true });
  assert.deepEqual(a.after, ['editor', 'tracker-editor']);
  const [b] = planDemotion([U('mana', ['admin', 'tracker-editor'])], { addTrackerEditor: true });
  assert.deepEqual(b.after, ['editor', 'tracker-editor']);
});

test('site-less admins, super_admins, executives and editors are never touched', () => {
  const plan = planDemotion([
    U('dgoro', ['admin'], null, null),
    U('boss', ['super_admin'], 3),
    U('exec', ['executive'], 3),
    U('already', ['editor', 'tracker-editor'], 3),
  ]);
  assert.deepEqual(plan, []);
});

test('except: named accounts are left out', () => {
  const plan = planDemotion([U('hounde', ['admin']), U('ity', ['admin'], 4, 'Ity')], { except: ['ITY'] });
  assert.deepEqual(plan.map(p => p.username), ['hounde']);
});

test('the plan carries the BEFORE roles (the restore file is built from them)', () => {
  const [p] = planDemotion([U('hounde', ['admin', 'tracker-editor'])]);
  assert.deepEqual(p.before, ['admin', 'tracker-editor']);
  assert.equal(p.site_name, 'Hounde');
});

// --drop= (user request 2026-10-02, after the demotion was applied): remove a FEATURE role
// from site-scoped accounts — e.g. audit-viewer, which reads every site's audit log while a
// coordinator keeps their own site's log through `editor`.
const { planDrop } = require('../services/roleDemotion');

test('planDrop removes the role from site-scoped non-admin accounts that hold it', () => {
  const plan = planDrop([
    U('hounde', ['audit-viewer', 'editor', 'report-author', 'tracker-editor']),
    U('jonas', ['editor', 'tracker-editor']),                       // does not hold it → untouched
  ], ['audit-viewer']);
  assert.deepEqual(plan.map(p => p.username), ['hounde']);
  assert.deepEqual(plan[0].after, ['editor', 'report-author', 'tracker-editor']);
  assert.deepEqual(plan[0].before, ['audit-viewer', 'editor', 'report-author', 'tracker-editor']);
});

test('planDrop never touches the admin tier or a site-less account', () => {
  const plan = planDrop([
    U('dgoro', ['admin', 'audit-viewer'], null, null),
    U('boss', ['super_admin', 'audit-viewer'], 3),
    U('auditor', ['viewer', 'audit-viewer'], null, null),          // a central auditor: no site
  ], ['audit-viewer']);
  assert.deepEqual(plan, []);
});

test('planDrop refuses to drop a hierarchical level (only feature roles)', () => {
  assert.throws(() => planDrop([U('hounde', ['editor'])], ['editor']), /feature role/);
});

// planRoles = what the CLI runs: demotion, then --drop, merged into ONE plan per account
// (one backup file, one transaction). BEFORE is always the account's original role set.
const { planRoles } = require('../services/roleDemotion');

test('planRoles: an already-demoted coordinator only loses the dropped role', () => {
  const plan = planRoles([U('hounde', ['audit-viewer', 'editor', 'tracker-editor'])], { drop: ['audit-viewer'] });
  assert.deepEqual(plan, [{ id: 'hounde'.length, username: 'hounde', site_name: 'Hounde',
    before: ['audit-viewer', 'editor', 'tracker-editor'], after: ['editor', 'tracker-editor'] }]);
});

test('planRoles: a still-admin coordinator is demoted AND loses the dropped role, in one entry', () => {
  const plan = planRoles([U('ity', ['admin', 'audit-viewer'])], { addTrackerEditor: true, drop: ['audit-viewer'] });
  assert.equal(plan.length, 1);
  assert.deepEqual(plan[0].before, ['admin', 'audit-viewer']);
  assert.deepEqual(plan[0].after, ['editor', 'tracker-editor']);
});

test('planRoles without drop is exactly planDemotion', () => {
  const users = [U('ity', ['admin']), U('hounde', ['editor', 'audit-viewer'])];
  assert.deepEqual(planRoles(users, {}), planDemotion(users, {}));
});
