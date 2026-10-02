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
