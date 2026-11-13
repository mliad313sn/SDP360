'use strict';
// PPM parity W4 — per-project roles (PURE): the role × operation matrix, the most-restrictive rule, and the read grant.
const { test } = require('node:test');
const assert = require('node:assert');
const PR = require('../services/ppm/projectRoles');
const PA = require('../services/portfolioAccess');

const d = (o) => PR.decide(o);
const allow = (o) => assert.equal(d(o).allow, true, JSON.stringify(o));
const refuse = (o, code) => { const v = d(o); assert.equal(v.allow, false, JSON.stringify(o)); if (code) assert.equal(v.code, code); };

test('pm: every plan kind and step on the project', () => {
  for (const kind of ['task', 'milestone', 'deliverable', 'risk', 'benefit', 'team']) for (const op of ['write', 'delete', 'team', 'time', 'action']) allow({ role: 'pm', kind, op, isNew: op === 'write', body: { name: 'x' } });
  allow({ role: 'pm', kind: 'task', op: 'write', body: { project_id: 2 }, moves: true });
});

test('scheduler: tasks + milestones + time; not risks, benefits, team, RACI/CR', () => {
  allow({ role: 'scheduler', kind: 'task', op: 'write', isNew: true, body: { name: 'a' } });
  allow({ role: 'scheduler', kind: 'milestone', op: 'delete' });
  allow({ role: 'scheduler', kind: 'task', op: 'time' });
  for (const [kind, op] of [['risk', 'write'], ['benefit', 'write'], ['deliverable', 'write'], ['team', 'team'], ['task', 'action']]) refuse({ role: 'scheduler', kind, op, body: {} }, 'ROLE_SCOPE');
  refuse({ role: 'scheduler', kind: 'task', op: 'write', body: { project_id: 9 }, moves: true }, 'ROLE_SCOPE');
});

test('resource manager: team + time; on an EXISTING task only owner / allocation / effort', () => {
  allow({ role: 'resource_manager', kind: 'team', op: 'team' });
  allow({ role: 'resource_manager', kind: 'task', op: 'time' });
  allow({ role: 'resource_manager', kind: 'task', op: 'write', isNew: false, body: { id: 3, version: 2, owner: 'ana', allocation_pct: 50, effort_hours: 8 } });
  refuse({ role: 'resource_manager', kind: 'task', op: 'write', isNew: false, body: { id: 3, end_date: '2027-01-01' } }, 'FIELD_SCOPE');
  refuse({ role: 'resource_manager', kind: 'task', op: 'write', isNew: true, body: { name: 'new' } }, 'ROLE_SCOPE');
  refuse({ role: 'resource_manager', kind: 'task', op: 'delete' }, 'ROLE_SCOPE');
});

test('contributor: progress fields of a task they OWN, and time on it; nothing else', () => {
  allow({ role: 'contributor', kind: 'task', op: 'write', isNew: false, ownsTask: true, body: { id: 1, version: 4, progress_pct: 50, status: 'in_progress' } });
  allow({ role: 'contributor', kind: 'task', op: 'time', ownsTask: true });
  refuse({ role: 'contributor', kind: 'task', op: 'write', isNew: false, ownsTask: false, body: { id: 1, progress_pct: 50 } }, 'OWN_TASK_ONLY');
  refuse({ role: 'contributor', kind: 'task', op: 'write', isNew: false, ownsTask: true, body: { id: 1, name: 'renamed' } }, 'FIELD_SCOPE');
  refuse({ role: 'contributor', kind: 'task', op: 'delete', ownsTask: true }, 'OWN_TASK_ONLY');
  refuse({ role: 'contributor', kind: 'task', op: 'time', ownsTask: false }, 'OWN_TASK_ONLY');
  refuse({ role: 'contributor', kind: 'milestone', op: 'write', ownsTask: true, body: {} }, 'OWN_TASK_ONLY');
});

test('client: read-only — every write step refused', () => {
  for (const op of ['write', 'delete', 'team', 'time', 'action']) refuse({ role: 'client', kind: 'task', op, ownsTask: true, body: { progress_pct: 1 } }, 'CLIENT_READ_ONLY');
});

test('effectiveRole: the most restrictive row wins (never widen by accident); unknown roles ignored', () => {
  assert.equal(PR.effectiveRole(['pm', 'client']), 'client');
  assert.equal(PR.effectiveRole(['pm', 'contributor']), 'contributor');
  assert.equal(PR.effectiveRole(['bogus']), null);
  assert.equal(PR.effectiveRole([]), null);
  assert.equal(PR.normaliseRole(''), null);
  assert.equal(PR.normaliseRole('PM'), 'pm');
  assert.throws(() => PR.normaliseRole('owner'), (e) => e.reason === 'BAD_ROLE' && e.status === 400);
});

test('read grant: a role member reads the project under the site scope and when sensitive — only with the switch on', () => {
  const u = { id: 5, username: 'ext', site_id: 9, site_ids: [9] };
  const p = { id: 7, site_id: 1, owner: 'someone' };
  const base = { scopeOn: true, extraSites: [] };
  assert.equal(PA.canReadProject(u, p, base), false, 'outside the site');
  assert.equal(PA.canReadProject(u, p, { ...base, rolesOn: false, roleMemberProjectIds: [7] }), false, 'switch off: the role means nothing');
  assert.equal(PA.canReadProject(u, p, { ...base, rolesOn: true, roleMemberProjectIds: [7] }), true);
  assert.equal(PA.canReadProject(u, p, { ...base, rolesOn: true, roleMemberProjectIds: [8] }), false, 'another project');
  const sens = { ...p, sensitive: 1 };
  assert.equal(PA.canReadProject(u, sens, { sensitiveOn: true, rolesOn: true, roleMemberProjectIds: [7] }), true);
  assert.equal(PA.canReadProject(u, sens, { sensitiveOn: true, rolesOn: false, roleMemberProjectIds: [7] }), false);
});

test('capability registry names every project role, bilingual, and its ops agree with decide()', () => {
  const reg = require('../services/capabilityRegistry');
  assert.deepEqual(reg.PROJECT_ROLES.map((r) => r.role), PR.ROLES);
  for (const r of reg.PROJECT_ROLES) {
    assert.ok(r.en && r.fr && reg.RISKS.includes(r.risk) && r.switch === 'ppm_project_roles_enabled', r.id);
    for (const op of ['write', 'delete', 'team', 'time', 'action']) {
      const kind = op === 'team' ? 'team' : 'task';
      const any = [true, false].some((isNew) => [{ id: 1, progress_pct: 1 }, { id: 1, owner: 'x' }].some((body) => PR.decide({ role: r.role, kind, op, isNew, ownsTask: true, body }).allow));
      assert.equal(any, r.ops.includes(op), `${r.role} ${op}`);
    }
  }
  assert.ok(!reg.list().some((c) => c.id.startsWith('ppm.project_role.')), 'not account capabilities (no route guard)');
});
